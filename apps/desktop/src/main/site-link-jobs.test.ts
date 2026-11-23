import { readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildInstalledAddon,
  HttpRequestError,
  DancedanceClient,
  type AddonManifest,
  type FileUploadHttpClient,
  type FileUploadHttpRequest,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type InstalledAddon,
  type LinkSongSource,
  type VideoAudioComparison,
} from '@dancedance/sync-core';
import { GeneratorJobFiles } from './generator-job-files';
import { MakeSongMusic, type MakeSongMusicPorts } from './make-song-music';
import { MusicSourceRegistry } from './music-source-registry';
import { SiteLinkJobs } from './site-link-jobs';
import type { SiteSongInstallResult } from './site-song-installs';
import { checkVideoForSite } from './site-video-checks';

const API_URL = 'https://dancedance.studio/api/sync';
const ADDON_URL = 'http://127.0.0.1:7802';
const NIGHT_DRIVE_LINK = 'https://clips.example/v/night-drive';
const OPEN_AUDIO_LINKS: AddonManifest = {
  protocol: 1, kind: 'addon', id: 'open-audio-links', name: 'Open Audio Links', version: '1.4.0', author: '@noa', description: '', provides: ['audio-links', 'video-links', 'song-source'], options: [],
  inputs: [{ id: 'link', kind: 'link', label: 'Audio link', placeholder: 'https://clips.example/v/…', sites: ['clips.example', 'media.example.org'] }],
};
const FOUND_NIGHT_DRIVE = {
  song: { title: 'Night Drive', artist: 'Lumen Park', lengthSeconds: 221, youtubeId: 'Vid3o1d-x_Z' },
  links: [{ kind: 'file-url', url: `${ADDON_URL}/files/night-drive.ogg`, label: 'Music', fileName: 'night-drive.ogg' }, { kind: 'file-url', media: 'video', url: `${ADDON_URL}/files/night-drive.mp4`, label: 'Video', fileName: 'night-drive.mp4' }],
};
const FIND_JOB = { id: 'lj_1', kind: 'find', addonId: 'open-audio-links', link: NIGHT_DRIVE_LINK, expiresAt: '2026-11-21T12:00:20.000Z' };
const MUSIC_JOB = { id: 'lj_2', kind: 'music', addonId: 'open-audio-links', findId: 'lj_1', ref: 'r1', songId: 'ls_9', expiresAt: '2026-11-21T12:10:00.000Z' };
/** "Into my game" for a song already in the player's library list; songId is its vaultSongId. */
const INSTALL_JOB = { id: 'lj_9', kind: 'install', addonId: 'open-audio-links', songId: 'song_42', expiresAt: '2026-11-21T12:10:00.000Z' };
/** Is this video's music the song? The song's facts come as the vault list gives them; it has no video link yet. */
const VERIFY_JOB = {
  id: 'lj_12', kind: 'verify', addonId: 'open-audio-links', songId: 'song_42', videoId: 'Vid3o1d-x_Z', expiresAt: '2026-11-21T12:03:00.000Z',
  song: { vaultSongId: 'song_42', slug: 'night-drive', title: 'Night Drive', artist: 'Lumen Park', album: null, genre: 'Synthwave', lengthSeconds: 221, youtubeId: null, chartVersion: 'v1' },
};
const VIDEO_AUDIO_LINKS = { status: 200, body: { links: [{ kind: 'file-url', url: `${ADDON_URL}/files/night-drive-video.ogg`, label: 'Music', fileName: 'night-drive-video.ogg' }] } };

let workFolder: string;

beforeEach(async () => {
  workFolder = await mkdtemp(path.join(os.tmpdir(), 'dancedance-link-jobs-test-'));
});

afterEach(async () => {
  // A music job may still be removing its own folder; Windows refuses two removals of one folder at once.
  await rm(workFolder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Time moves only when a test moves it, so waits of 18 s or 30 s take no real time. */
class FakeClock {
  nowMilliseconds = Date.parse('2026-11-21T12:00:00.000Z');
  private timers: { dueMilliseconds: number; resolve: () => void }[] = [];

  readonly waitMilliseconds = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
      this.timers.push({ dueMilliseconds: this.nowMilliseconds + milliseconds, resolve });
    });

  async advance(milliseconds: number): Promise<void> {
    this.nowMilliseconds += milliseconds;
    const dueTimers = this.timers.filter((timer) => timer.dueMilliseconds <= this.nowMilliseconds);
    this.timers = this.timers.filter((timer) => timer.dueMilliseconds > this.nowMilliseconds);
    for (const timer of dueTimers) timer.resolve();
    await settle();
  }
}

type PollOutcome = 'fail' | 'no-job' | 'signed-out' | Record<string, unknown>;

/**
 * The website's side of link jobs: it hands out the jobs a test queues (holding the long poll until there is one) and
 * keeps every presence, answer and upload. It is the injected network: nothing here leaves the test.
 */
class FakeSite implements HttpClient, FileUploadHttpClient {
  readonly presences: unknown[] = [];
  readonly answers: { jobId: string; answer: unknown }[] = [];
  readonly uploads: { jobId: string; contentType: string; text: string }[] = [];
  readonly stateChecks: string[] = [];
  readonly requests: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  readonly statesByJobId = new Map<string, string>();
  /** Jobs the player stopped: the site answers 410 to anything Sync sends for them. */
  readonly endedJobIds = new Set<string>();
  readonly pollOutcomes: PollOutcome[] = [];
  pollCount = 0;
  private heldPoll: ((outcome: PollOutcome) => void) | null = null;

  constructor(private readonly getSourceFilePath: (sourceId: string) => string | null) {}

  queueJob(job: Record<string, unknown>): void {
    const heldPoll = this.heldPoll;
    this.heldPoll = null;
    if (heldPoll) heldPoll(job);
    else this.pollOutcomes.push(job);
  }

  requestJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const route = this.findRoute(request);
    if (route === '/link-jobs/next?waitMs=25000') return this.answerPoll();
    const jobId = decodeURIComponent(/^\/link-jobs\/([^/?]+)$/.exec(route)?.[1] ?? '');
    this.stateChecks.push(jobId);
    return Promise.resolve({ status: 200, body: { status: this.statesByJobId.get(jobId) ?? 'open' } });
  }

  requestText(request: HttpRequest): Promise<HttpResponse<string>> {
    const route = this.findRoute(request);
    if (route === '/presence') {
      this.presences.push(request.jsonBody);
      return Promise.resolve({ status: 200, body: '{}' });
    }
    const jobId = decodeURIComponent(/^\/link-jobs\/([^/?]+)\/answer$/.exec(route)?.[1] ?? '');
    this.answers.push({ jobId, answer: request.jsonBody });
    if (this.endedJobIds.has(jobId)) return Promise.resolve({ status: 410, body: '{"error":"This find has ended."}' });
    return Promise.resolve({ status: request.jsonBody !== null && typeof request.jsonBody === 'object' && 'status' in request.jsonBody && request.jsonBody.status === 'working' ? 204 : 200, body: '' });
  }

  requestBytes(): Promise<HttpResponse<Uint8Array>> {
    return Promise.reject(new Error('The site sends Sync no files here.'));
  }

  async requestTextWithFileBody(request: FileUploadHttpRequest): Promise<HttpResponse<string>> {
    const jobId = decodeURIComponent(/^\/link-jobs\/([^/?]+)\/audio$/.exec(this.findRoute(request))?.[1] ?? '');
    this.uploads.push({ jobId, contentType: request.contentType, text: await readFile(this.getSourceFilePath(request.sourceId) ?? '', 'utf8') });
    return { status: 200, body: 'Stored.' };
  }

  private findRoute(request: HttpRequest | FileUploadHttpRequest): string {
    this.requests.push({ url: request.url, headers: request.headers ?? {} });
    if (!request.url.startsWith(`${API_URL}/`)) throw new Error(`Sync called ${request.url}, which isn't the site's API.`);
    return request.url.slice(API_URL.length);
  }

  private answerPoll(): Promise<HttpResponse<unknown>> {
    this.pollCount += 1;
    const outcome = this.pollOutcomes.shift();
    if (outcome !== undefined) return toPollResponse(outcome);
    return new Promise((resolve, reject) => {
      this.heldPoll = (heldOutcome) => { toPollResponse(heldOutcome).then(resolve, reject); };
    });
  }
}

function toPollResponse(outcome: PollOutcome): Promise<HttpResponse<unknown>> {
  if (outcome === 'fail') return Promise.reject(new HttpRequestError({ failure: 'network', message: 'The site could not be reached.' }));
  if (outcome === 'no-job') return Promise.resolve({ status: 204, body: null });
  if (outcome === 'signed-out') return Promise.resolve({ status: 401, body: { error: 'Sign in again.' } });
  return Promise.resolve({ status: 200, body: outcome });
}

/** Open Audio Links, running on this computer: it answers /song-source as each test says and keeps what it was asked. */
class FakeAddon implements HttpClient {
  readonly requests: HttpRequest[] = [];
  answer: () => Promise<HttpResponse<unknown>> = () => Promise.resolve({ status: 200, body: FOUND_NIGHT_DRIVE });
  /** Its /audio-links: the music of the video it is asked about. */
  answerAudioLinks: () => Promise<HttpResponse<unknown>> = () => Promise.resolve(VIDEO_AUDIO_LINKS);

  get songSourceBodies(): unknown[] {
    return this.requests.map((request) => request.jsonBody);
  }

  requestJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    this.requests.push(request);
    if (request.url === `${ADDON_URL}/audio-links`) return this.answerAudioLinks();
    if (request.url !== `${ADDON_URL}/song-source`) return Promise.reject(new Error(`The addon has no ${request.url}.`));
    return this.answer();
  }

  requestText(): Promise<HttpResponse<string>> {
    return Promise.reject(new Error('Not used.'));
  }

  requestBytes(): Promise<HttpResponse<Uint8Array>> {
    return Promise.reject(new Error('Not used.'));
  }
}

/** Sync's side, with the link tab's own MakeSongMusic, a fake site, a fake addon and a fake clock. */
class LinkJobsHarness {
  readonly clock = new FakeClock();
  readonly musicSources = new MusicSourceRegistry();
  readonly site = new FakeSite((sourceId) => this.musicSources.getSource(sourceId)?.filePath ?? null);
  readonly addon = new FakeAddon();
  readonly downloads: string[] = [];
  readonly logs: string[] = [];
  readonly savedSources: LinkSongSource[][] = [];
  addons: InstalledAddon[] = [buildInstalledAddon({ baseUrl: ADDON_URL, manifest: OPEN_AUDIO_LINKS, consentedAt: '2026-11-21T10:00:00.000Z' })];
  signOutCount = 0;
  /** The library songs install jobs asked for, in order. */
  readonly installedSongIds: string[] = [];
  /** Stands for the app's sync and its check of the game folder: installed unless a test says otherwise. */
  installSong: (vaultSongId: string) => Promise<SiteSongInstallResult> = () => Promise.resolve({ kind: 'installed' });
  /** The songs whose fingerprint a verify job fetched, and the addon files it downloaded. */
  readonly fingerprintSongIds: string[] = [];
  readonly addonFileUrls: string[] = [];
  /** Stands for the audio window's comparison: the same music, 221 s long, unless a test says otherwise. */
  videoComparison: VideoAudioComparison = { videoLengthSeconds: 221, fingerprintLengthSeconds: 221, middle: { isSameMusic: true, correlation: 0.92, shiftSeconds: 1.234 } };
  readonly linkJobs: SiteLinkJobs;
  private isLinked = true;

  constructor({ downloadFile }: { downloadFile?: MakeSongMusicPorts['downloadFile'] } = {}) {
    const songs = new MakeSongMusic({
      httpClient: this.addon,
      musicSources: this.musicSources,
      measureLength: () => Promise.resolve(221),
      convertToWav: () => Promise.resolve(new TextEncoder().encode('RIFF')),
      convertToMonoWav: () => Promise.resolve(new TextEncoder().encode('RIFF')),
      downloadFile: downloadFile ?? (async ({ url, filePath }) => { this.downloads.push(url); await writeFile(filePath, 'OggS-night-drive'); }),
      waitMilliseconds: this.clock.waitMilliseconds,
    });
    this.linkJobs = new SiteLinkJobs({
      buildApi: () => (this.isLinked ? new DancedanceClient({ httpClient: this.site, fileUploadClient: this.site, siteUrl: 'https://dancedance.studio', deviceToken: 'device-token-1' }) : null),
      getAddons: () => this.addons,
      songs,
      addonHttpClient: this.addon,
      jobFiles: new GeneratorJobFiles({ jobsFolder: path.join(workFolder, 'link-jobs'), musicSources: this.musicSources, appVersion: '0.2.0' }),
      sourceStore: { load: () => Promise.resolve([]), save: (sources) => { this.savedSources.push(sources); return Promise.resolve(); } },
      computerName: 'LIVING-ROOM',
      appVersion: '0.2.0',
      getNowMilliseconds: () => this.clock.nowMilliseconds,
      waitMilliseconds: this.clock.waitMilliseconds,
      log: (line) => { this.logs.push(line); },
      onSignedOut: () => {
        this.signOutCount += 1;
        this.isLinked = false;
      },
      installSong: ({ vaultSongId }) => {
        this.installedSongIds.push(vaultSongId);
        return this.installSong(vaultSongId);
      },
      checkVideo: ({ job, wait }) => checkVideoForSite({
        job,
        wait,
        ports: {
          getAddons: () => this.addons,
          addonHttpClient: this.addon,
          downloadAddonFile: ({ url }) => {
            this.addonFileUrls.push(url);
            return Promise.resolve(`addon:${url}`);
          },
          fetchFingerprint: (vaultSongId) => {
            this.fingerprintSongIds.push(vaultSongId);
            return Promise.resolve({ envelope: [0.1, 0.5, 0.2], rateHertz: 100 });
          },
          compareVideoAudio: () => Promise.resolve(this.videoComparison),
        },
      }),
    });
  }

  /** Starts, runs a find for Night Drive, and waits for its answer. */
  async startAndFindNightDrive(): Promise<void> {
    this.linkJobs.start();
    this.site.queueJob(FIND_JOB);
    await waitUntil(() => this.site.answers.length === 1);
  }

  hasLog(line: string): boolean {
    return this.logs.includes(line);
  }

  /** The player signed in again with a new code. */
  linkAgain(): void {
    this.isLinked = true;
  }
}

// setImmediate, not setTimeout(0): Windows timers tick every 16 ms or so, which would make these tests crawl.
function waitForTurn(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve); });
}

/** Lets everything that is already running go as far as it can without the clock moving. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await waitForTurn();
}

async function waitUntil(isDone: () => boolean): Promise<void> {
  const startedAt = performance.now();
  while (!isDone() && performance.now() - startedAt < 3_000) await waitForTurn();
  expect(isDone()).toBe(true);
}

/** The status of every answer the site got, keepalives included, in order. */
function getAnswerStatuses(harness: LinkJobsHarness): string[] {
  return harness.site.answers.map(({ answer }) => (typeof answer === 'object' && answer !== null && 'status' in answer && typeof answer.status === 'string' ? answer.status : ''));
}

/** Every music job removes its temporary folder when it ends, whatever happened. */
async function waitForMusicJobFoldersToGo(): Promise<void> {
  await waitUntil(() => readdirSync(path.join(workFolder, 'link-jobs')).length === 0);
}

/** Real time for files to be written, before checking that something did not happen. */
function waitBriefly(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('presence', () => {
  it('goes out on start and every 30 s, from the link addons that are on, and again at once when one is turned off', async () => {
    const harness = new LinkJobsHarness();
    harness.linkJobs.start();
    await waitUntil(() => harness.site.presences.length === 1);
    expect(harness.site.presences[0]).toStrictEqual({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', linkJobs: 1, installJobs: 1, verifyJobs: 1, linkAddons: [{ id: 'open-audio-links', name: 'Open Audio Links', label: 'Audio link', placeholder: 'https://clips.example/v/…', sites: ['clips.example', 'media.example.org'] }] });
    await harness.clock.advance(30_000);
    await waitUntil(() => harness.site.presences.length === 2);
    harness.addons = harness.addons.map((addon) => ({ ...addon, isEnabled: false }));
    harness.linkJobs.handleAddonsChange();
    await waitUntil(() => harness.site.presences.length === 3);
    expect(harness.site.presences[2]).toMatchObject({ linkJobs: 1, installJobs: 1, verifyJobs: 1, linkAddons: [] });
    harness.linkJobs.handleAddonsChange();
    await waitBriefly();
    expect(harness.site.presences).toHaveLength(3);
    await harness.linkJobs.stop({ isLeaving: false });
  });

  it('says leaving on quit, and then stops: no more presence and no more asking for jobs', async () => {
    const harness = new LinkJobsHarness();
    harness.linkJobs.start();
    await waitUntil(() => harness.site.presences.length === 1 && harness.site.pollCount === 1);
    await harness.linkJobs.stop({ isLeaving: true });
    expect(harness.site.presences[1]).toMatchObject({ computerName: 'LIVING-ROOM', leaving: true });
    await harness.clock.advance(60_000);
    expect(harness.site.presences).toHaveLength(2);
    expect(harness.site.pollCount).toBe(1);
  });
});

describe('find jobs', () => {
  it('answer with what the link addon found: the facts, the addon’s site and the video id, after asking it once with only the link', async () => {
    const harness = new LinkJobsHarness();
    await harness.startAndFindNightDrive();
    expect(harness.addon.songSourceBodies).toEqual([{ protocol: 1, inputs: { link: NIGHT_DRIVE_LINK } }]);
    expect(harness.site.answers).toEqual([{ jobId: 'lj_1', answer: { status: 'found', results: [{ ref: 'r1', title: 'Night Drive', artist: 'Lumen Park', source: 'clips.example', lengthSec: 221, video: { videoId: 'Vid3o1d-x_Z', title: 'Night Drive', channel: 'Lumen Park', lengthSec: 221 } }] } }]);
    expect(harness.downloads).toEqual([]);
  });

  it('answer notfound with the addon’s own reason', async () => {
    const harness = new LinkJobsHarness();
    harness.addon.answer = () => Promise.resolve({ status: 200, body: { error: 'This clip is private.' } });
    await harness.startAndFindNightDrive();
    expect(harness.site.answers).toEqual([{ jobId: 'lj_1', answer: { status: 'notfound', reason: 'This clip is private.' } }]);
  });

  it('answer gone when the link addon is turned off or removed, without asking it', async () => {
    const harness = new LinkJobsHarness();
    harness.addons = harness.addons.map((addon) => ({ ...addon, isEnabled: false }));
    await harness.startAndFindNightDrive();
    harness.addons = [];
    harness.site.queueJob({ ...FIND_JOB, id: 'lj_3' });
    await waitUntil(() => harness.site.answers.length === 2);
    expect(harness.site.answers).toEqual([{ jobId: 'lj_1', answer: { status: 'gone' } }, { jobId: 'lj_3', answer: { status: 'gone' } }]);
    expect(harness.addon.requests).toEqual([]);
  });

  it('check the link against the addon’s sites first: a link from another site is notfound, and the addon is never asked', async () => {
    const harness = new LinkJobsHarness();
    harness.linkJobs.start();
    const links = ['https://other.example.net/v/night-drive', 'https://clips.example.other.example/v/night-drive', 'http://clips.example/v/night-drive', 'clips.example/v/night-drive'];
    for (const [index, link] of links.entries()) harness.site.queueJob({ ...FIND_JOB, id: `lj_${String(index + 10)}`, link });
    await waitUntil(() => harness.site.answers.length === links.length);
    expect(harness.site.answers.map(({ answer }) => answer)).toEqual(links.map(() => ({ status: 'notfound' })));
    expect(harness.addon.requests).toEqual([]);
  });

  it('send nothing when the addon stays silent for 18 s, so the site says it isn’t answering', async () => {
    const harness = new LinkJobsHarness();
    harness.addon.answer = () => new Promise(() => undefined);
    harness.linkJobs.start();
    harness.site.queueJob(FIND_JOB);
    await waitUntil(() => harness.addon.requests.length === 1);
    expect(harness.addon.requests[0]?.timeoutMilliseconds).toBeLessThanOrEqual(18_000);
    await harness.clock.advance(17_000);
    expect(harness.hasLog('[link-jobs] find lj_1: no answer from the addon, nothing sent')).toBe(false);
    await harness.clock.advance(1_000);
    await waitUntil(() => harness.hasLog('[link-jobs] find lj_1: no answer from the addon, nothing sent'));
    expect(harness.site.answers).toEqual([]);
  });

  it('stay open while the addon is still working: "working" every 5 s, then the songs it found, even after 18 s', async () => {
    const harness = new LinkJobsHarness();
    const stillWorking: HttpResponse<unknown> = { status: 202, body: { retryAfterSeconds: 5 } };
    const addonAnswers: HttpResponse<unknown>[] = [stillWorking, stillWorking, stillWorking, stillWorking, { status: 200, body: FOUND_NIGHT_DRIVE }];
    harness.addon.answer = () => Promise.resolve(addonAnswers.shift() ?? { status: 500, body: {} });
    harness.linkJobs.start();
    harness.site.queueJob(FIND_JOB);
    await waitUntil(() => harness.site.answers.length === 1);
    expect(harness.site.answers[0]).toEqual({ jobId: 'lj_1', answer: { status: 'working' } });
    for (let second = 0; second < 20; second += 5) await harness.clock.advance(5_000);
    await waitUntil(() => getAnswerStatuses(harness).includes('found'));
    const statuses = getAnswerStatuses(harness);
    expect(statuses.at(-1)).toBe('found');
    expect(statuses.slice(0, -1).every((status) => status === 'working')).toBe(true);
    expect(statuses.length).toBeGreaterThanOrEqual(5);
    expect(harness.addon.requests).toHaveLength(5);
    expect(harness.hasLog('[link-jobs] find lj_1: the addon is still working, keeping the find open')).toBe(true);
    await harness.clock.advance(30_000);
    expect(getAnswerStatuses(harness)).toEqual(statuses);
  });

  it('give up on an addon still working after 3 minutes, and send nothing but the keepalives', async () => {
    const harness = new LinkJobsHarness();
    harness.addon.answer = () => Promise.resolve({ status: 202, body: { retryAfterSeconds: 5 } });
    harness.linkJobs.start();
    harness.site.queueJob(FIND_JOB);
    await waitUntil(() => harness.addon.requests.length === 1);
    for (let second = 0; second < 175; second += 5) await harness.clock.advance(5_000);
    expect(harness.hasLog('[link-jobs] find lj_1: no answer from the addon, nothing sent')).toBe(false);
    await harness.clock.advance(5_000);
    await waitUntil(() => harness.hasLog('[link-jobs] find lj_1: no answer from the addon, nothing sent'));
    const askCount = harness.addon.requests.length;
    const statuses = getAnswerStatuses(harness);
    expect(askCount).toBeGreaterThanOrEqual(36);
    expect(statuses.every((status) => status === 'working')).toBe(true);
    await harness.clock.advance(60_000);
    expect(harness.addon.requests).toHaveLength(askCount);
    expect(getAnswerStatuses(harness)).toEqual(statuses);
  });

  it('stop asking the addon when the site answers 410 to a keepalive, because the player stopped the find', async () => {
    const harness = new LinkJobsHarness();
    harness.addon.answer = () => Promise.resolve({ status: 202, body: { retryAfterSeconds: 5 } });
    harness.linkJobs.start();
    harness.site.queueJob(FIND_JOB);
    await waitUntil(() => harness.site.answers.length === 1);
    harness.site.endedJobIds.add('lj_1');
    await harness.clock.advance(5_000);
    await waitUntil(() => harness.hasLog('[link-jobs] find lj_1: stopped on the site, nothing sent'));
    const askCount = harness.addon.requests.length;
    expect(askCount).toBeLessThanOrEqual(2);
    await harness.clock.advance(60_000);
    expect(harness.addon.requests).toHaveLength(askCount);
    expect(getAnswerStatuses(harness).every((status) => status === 'working')).toBe(true);
  });

  it('give up 18 s into an ask that gets no answer, even after the addon said it was still working', async () => {
    const harness = new LinkJobsHarness();
    const addonAnswers: Promise<HttpResponse<unknown>>[] = [Promise.resolve({ status: 202, body: { retryAfterSeconds: 5 } })];
    harness.addon.answer = () => addonAnswers.shift() ?? new Promise(() => undefined);
    harness.linkJobs.start();
    harness.site.queueJob(FIND_JOB);
    await waitUntil(() => harness.addon.requests.length === 1);
    await harness.clock.advance(5_000);
    await waitUntil(() => harness.addon.requests.length === 2);
    await harness.clock.advance(17_000);
    expect(harness.hasLog('[link-jobs] find lj_1: no answer from the addon, nothing sent')).toBe(false);
    await harness.clock.advance(1_000);
    await waitUntil(() => harness.hasLog('[link-jobs] find lj_1: no answer from the addon, nothing sent'));
    const statuses = getAnswerStatuses(harness);
    expect(statuses.every((status) => status === 'working')).toBe(true);
    await harness.clock.advance(30_000);
    expect(getAnswerStatuses(harness)).toEqual(statuses);
  });
});

describe('music jobs', () => {
  it('get the picked song’s music, check the job is still open, upload only the audio, and keep its source by the site’s song id', async () => {
    const harness = new LinkJobsHarness();
    await harness.startAndFindNightDrive();
    harness.site.queueJob(MUSIC_JOB);
    await waitUntil(() => harness.hasLog('[link-jobs] music lj_2: audio uploaded'));
    expect(harness.downloads).toEqual([`${ADDON_URL}/files/night-drive.ogg`]);
    expect(harness.site.stateChecks).toEqual(['lj_2']);
    expect(harness.site.uploads).toEqual([{ jobId: 'lj_2', contentType: 'audio/ogg', text: 'OggS-night-drive' }]);
    expect(harness.site.answers).toHaveLength(1);
    expect(harness.savedSources.at(-1)).toEqual([{ songId: 'ls_9', source: { addonId: 'open-audio-links', addonName: 'Open Audio Links', link: NIGHT_DRIVE_LINK } }]);
    await waitForMusicJobFoldersToGo();
  });

  it('send the device token only to the site’s API address, and nothing about the account to the addon', async () => {
    const harness = new LinkJobsHarness();
    await harness.startAndFindNightDrive();
    harness.site.queueJob(MUSIC_JOB);
    await waitUntil(() => harness.site.uploads.length === 1);
    expect(harness.site.requests.every((request) => request.url.startsWith(`${API_URL}/`) && request.headers.Authorization === 'Bearer device-token-1')).toBe(true);
    expect(harness.addon.requests.every((request) => request.headers === undefined)).toBe(true);
    await waitForMusicJobFoldersToGo();
  });

  it('upload nothing for a job the player cancelled, and send no answer', async () => {
    const harness = new LinkJobsHarness();
    await harness.startAndFindNightDrive();
    harness.site.statesByJobId.set('lj_2', 'cancelled');
    harness.site.queueJob(MUSIC_JOB);
    await waitUntil(() => harness.hasLog('[link-jobs] music lj_2: cancelled, nothing sent'));
    expect(harness.site.uploads).toEqual([]);
    expect(harness.site.answers).toHaveLength(1);
    await waitForMusicJobFoldersToGo();
  });

  it('answer failed with a short reason when the music can’t be got, and upload nothing', async () => {
    const harness = new LinkJobsHarness({ downloadFile: ({ url }) => Promise.reject(new HttpRequestError({ failure: 'network', message: `${url} answered 500.` })) });
    await harness.startAndFindNightDrive();
    harness.site.queueJob(MUSIC_JOB);
    harness.site.queueJob({ ...MUSIC_JOB, id: 'lj_4', findId: 'lj_unknown' });
    await waitUntil(() => harness.site.answers.length === 3);
    // The two music jobs run side by side, so their answers can come in either order.
    expect(harness.site.answers.slice(1).sort((first, second) => first.jobId.localeCompare(second.jobId))).toEqual([
      { jobId: 'lj_2', answer: { status: 'failed', reason: 'Open Audio Links couldn’t get the music.' } },
      { jobId: 'lj_4', answer: { status: 'failed', reason: 'Sync no longer has this song. Find it again.' } },
    ]);
    expect(harness.site.uploads).toEqual([]);
    await waitForMusicJobFoldersToGo();
  });

  it('answer failed for music over 8 minutes, and when the link addon was turned off since the find', async () => {
    const harness = new LinkJobsHarness();
    harness.addon.answer = () => Promise.resolve({ status: 200, body: { ...FOUND_NIGHT_DRIVE, song: { ...FOUND_NIGHT_DRIVE.song, lengthSeconds: 481 } } });
    await harness.startAndFindNightDrive();
    harness.site.queueJob(MUSIC_JOB);
    await waitUntil(() => harness.site.answers.length === 2);
    harness.addons = harness.addons.map((addon) => ({ ...addon, isEnabled: false }));
    harness.site.queueJob({ ...MUSIC_JOB, id: 'lj_4' });
    await waitUntil(() => harness.site.answers.length === 3);
    expect(harness.site.answers.slice(1).map(({ answer }) => answer)).toEqual([{ status: 'failed', reason: 'It’s longer than 8 minutes.' }, { status: 'failed', reason: 'Open Audio Links is turned off in Sync.' }]);
    expect(harness.site.uploads).toEqual([]);
    await waitForMusicJobFoldersToGo();
  });
});

describe('install jobs', () => {
  it('install the library song with a sync and answer installed', async () => {
    const harness = new LinkJobsHarness();
    harness.linkJobs.start();
    harness.site.queueJob(INSTALL_JOB);
    await waitUntil(() => harness.site.answers.length === 1);
    expect(harness.installedSongIds).toEqual(['song_42']);
    expect(harness.site.answers).toEqual([{ jobId: 'lj_9', answer: { status: 'installed' } }]);
    expect(harness.hasLog('[link-jobs] install lj_9: installed')).toBe(true);
  });

  it('answer failed with Sync’s own reason when the song didn’t reach the game, or when the install broke', async () => {
    const harness = new LinkJobsHarness();
    const results: Promise<SiteSongInstallResult>[] = [Promise.resolve({ kind: 'failed', reason: 'Sync couldn’t find this song’s music in your music folders or through your addons.' }), Promise.reject(new Error('C:\\Users\\Noa\\Songs is gone.'))];
    harness.installSong = () => results.shift() ?? Promise.resolve({ kind: 'installed' });
    harness.linkJobs.start();
    harness.site.queueJob(INSTALL_JOB);
    harness.site.queueJob({ ...INSTALL_JOB, id: 'lj_10' });
    await waitUntil(() => harness.site.answers.length === 2);
    expect(harness.site.answers).toEqual([
      { jobId: 'lj_9', answer: { status: 'failed', reason: 'Sync couldn’t find this song’s music in your music folders or through your addons.' } },
      { jobId: 'lj_10', answer: { status: 'failed', reason: 'Sync couldn’t put the song in your game. Try again.' } },
    ]);
  });

  it('answer different when the music the addon got isn’t the song, so the site can drop an unchecked link', async () => {
    const harness = new LinkJobsHarness();
    harness.installSong = () => Promise.resolve({ kind: 'different', reason: 'The music your link addon got is another version of this song, or another song.' });
    harness.linkJobs.start();
    harness.site.queueJob(INSTALL_JOB);
    await waitUntil(() => harness.site.answers.length === 1);
    expect(harness.site.answers).toEqual([{ jobId: 'lj_9', answer: { status: 'different', reason: 'The music your link addon got is another version of this song, or another song.' } }]);
  });

  it('drop the answer when the site says the job is over (410)', async () => {
    const harness = new LinkJobsHarness();
    harness.site.endedJobIds.add('lj_9');
    harness.linkJobs.start();
    harness.site.queueJob(INSTALL_JOB);
    await waitUntil(() => harness.hasLog('[link-jobs] install lj_9: installed, too late'));
    await waitBriefly();
    expect(harness.site.answers).toEqual([{ jobId: 'lj_9', answer: { status: 'installed' } }]);
    expect(harness.installedSongIds).toEqual(['song_42']);
  });

  it('still take and answer link jobs while an install runs', async () => {
    const harness = new LinkJobsHarness();
    let finishInstall: (result: SiteSongInstallResult) => void = () => undefined;
    harness.installSong = () => new Promise((resolve) => { finishInstall = resolve; });
    harness.linkJobs.start();
    harness.site.queueJob(INSTALL_JOB);
    await waitUntil(() => harness.installedSongIds.length === 1);
    harness.site.queueJob(FIND_JOB);
    await waitUntil(() => harness.site.answers.length === 1);
    expect(harness.site.answers[0]).toMatchObject({ jobId: 'lj_1', answer: { status: 'found' } });
    finishInstall({ kind: 'installed' });
    await waitUntil(() => harness.site.answers.length === 2);
    expect(harness.site.answers[1]).toEqual({ jobId: 'lj_9', answer: { status: 'installed' } });
  });

  it('run one install at a time, as each one is a whole sync', async () => {
    const harness = new LinkJobsHarness();
    const finishInstalls: (() => void)[] = [];
    harness.installSong = () => new Promise((resolve) => { finishInstalls.push(() => { resolve({ kind: 'installed' }); }); });
    harness.linkJobs.start();
    harness.site.queueJob(INSTALL_JOB);
    harness.site.queueJob({ ...INSTALL_JOB, id: 'lj_10', songId: 'song_43' });
    await waitUntil(() => finishInstalls.length === 1);
    await waitBriefly();
    expect(harness.installedSongIds).toEqual(['song_42']);
    finishInstalls[0]?.();
    await waitUntil(() => finishInstalls.length === 2);
    finishInstalls[1]?.();
    await waitUntil(() => harness.site.answers.length === 2);
    expect(harness.installedSongIds).toEqual(['song_42', 'song_43']);
  });
});

describe('verify jobs', () => {
  it('ask the link addon for the video’s music with the song’s facts and the video id, compare it, and answer matched', async () => {
    const harness = new LinkJobsHarness();
    harness.linkJobs.start();
    harness.site.queueJob(VERIFY_JOB);
    await waitUntil(() => getAnswerStatuses(harness).includes('matched'));
    expect(harness.addon.requests.map((request) => request.url)).toEqual([`${ADDON_URL}/audio-links`]);
    expect(harness.addon.requests[0]?.jsonBody).toMatchObject({ song: { title: 'Night Drive', artist: 'Lumen Park', genre: 'Synthwave', lengthSeconds: 221, youtubeId: 'Vid3o1d-x_Z' } });
    expect(harness.addonFileUrls).toEqual([`${ADDON_URL}/files/night-drive-video.ogg`]);
    expect(harness.fingerprintSongIds).toEqual(['song_42']);
    expect(harness.site.answers.at(-1)).toEqual({ jobId: 'lj_12', answer: { status: 'matched', lengthSec: 221, offsetSec: 1.23 } });
  });

  it('never install or upload anything for a verify job', async () => {
    const harness = new LinkJobsHarness();
    harness.linkJobs.start();
    harness.site.queueJob(VERIFY_JOB);
    await waitUntil(() => getAnswerStatuses(harness).includes('matched'));
    expect(harness.installedSongIds).toEqual([]);
    expect(harness.site.uploads).toEqual([]);
    expect(harness.downloads).toEqual([]);
    expect(harness.savedSources).toEqual([]);
  });

  it('answer different for other music, and for a length more than 10 s off, with both lengths', async () => {
    const harness = new LinkJobsHarness();
    harness.videoComparison = { ...harness.videoComparison, middle: { isSameMusic: false, correlation: 0.11, shiftSeconds: 0 } };
    harness.linkJobs.start();
    harness.site.queueJob(VERIFY_JOB);
    await waitUntil(() => getAnswerStatuses(harness).includes('different'));
    expect(harness.site.answers.at(-1)).toEqual({ jobId: 'lj_12', answer: { status: 'different', reason: 'The music in that video isn’t this song.' } });
    harness.videoComparison = { ...harness.videoComparison, videoLengthSeconds: 312, middle: { isSameMusic: true, correlation: 0.9, shiftSeconds: 0 } };
    harness.site.queueJob({ ...VERIFY_JOB, id: 'lj_13' });
    await waitUntil(() => harness.site.answers.some(({ jobId, answer }) => jobId === 'lj_13' && (answer as { status: string }).status === 'different'));
    expect(harness.site.answers.at(-1)).toEqual({ jobId: 'lj_13', answer: { status: 'different', reason: 'That video is 5:12 long; this song is 3:41.' } });
  });

  it('answer failed when the link addon can’t get the music, isn’t answering, or is off', async () => {
    const harness = new LinkJobsHarness();
    const addonAnswers: HttpResponse<unknown>[] = [{ status: 200, body: { links: [], error: 'This video is private.' } }, { status: 500, body: {} }];
    harness.addon.answerAudioLinks = () => Promise.resolve(addonAnswers.shift() ?? VIDEO_AUDIO_LINKS);
    harness.linkJobs.start();
    harness.site.queueJob(VERIFY_JOB);
    harness.site.queueJob({ ...VERIFY_JOB, id: 'lj_13' });
    await waitUntil(() => getAnswerStatuses(harness).filter((status) => status === 'failed').length === 2);
    harness.addons = harness.addons.map((addon) => ({ ...addon, isEnabled: false }));
    harness.site.queueJob({ ...VERIFY_JOB, id: 'lj_14' });
    await waitUntil(() => getAnswerStatuses(harness).filter((status) => status === 'failed').length === 3);
    expect(harness.site.answers.filter(({ answer }) => (answer as { status: string }).status === 'failed')).toEqual([
      { jobId: 'lj_12', answer: { status: 'failed', reason: 'This video is private.' } },
      { jobId: 'lj_13', answer: { status: 'failed', reason: 'Your link addon isn’t answering. Check that it is running, then try again.' } },
      { jobId: 'lj_14', answer: { status: 'failed', reason: 'Your link addon is off in Sync, so it can’t get that video’s music.' } },
    ]);
    expect(harness.addonFileUrls).toEqual([]);
  });

  it('keep the check open with "working" every 5 s while the addon is still getting the music, then answer', async () => {
    const harness = new LinkJobsHarness();
    const stillWorking: HttpResponse<unknown> = { status: 202, body: { retryAfterSeconds: 5 } };
    const addonAnswers = [stillWorking, stillWorking, VIDEO_AUDIO_LINKS];
    harness.addon.answerAudioLinks = () => Promise.resolve(addonAnswers.shift() ?? VIDEO_AUDIO_LINKS);
    harness.linkJobs.start();
    harness.site.queueJob(VERIFY_JOB);
    await waitUntil(() => harness.addon.requests.length === 1 && harness.site.answers.length === 1);
    expect(harness.site.answers[0]).toEqual({ jobId: 'lj_12', answer: { status: 'working' } });
    await harness.clock.advance(5_000);
    await harness.clock.advance(5_000);
    await waitUntil(() => getAnswerStatuses(harness).includes('matched'));
    const statuses = getAnswerStatuses(harness);
    expect(statuses.at(-1)).toBe('matched');
    expect(statuses.slice(0, -1).every((status) => status === 'working')).toBe(true);
    expect(statuses.length).toBeGreaterThanOrEqual(3);
    expect(harness.addon.requests).toHaveLength(3);
  });

  it('give up on an addon still working after 2.5 minutes, answering failed inside the site’s 3', async () => {
    const harness = new LinkJobsHarness();
    harness.addon.answerAudioLinks = () => Promise.resolve({ status: 202, body: { retryAfterSeconds: 5 } });
    harness.linkJobs.start();
    harness.site.queueJob(VERIFY_JOB);
    await waitUntil(() => harness.addon.requests.length === 1);
    for (let second = 0; second < 150; second += 5) await harness.clock.advance(5_000);
    await waitUntil(() => getAnswerStatuses(harness).includes('failed'));
    expect(harness.site.answers.at(-1)).toEqual({ jobId: 'lj_12', answer: { status: 'failed', reason: 'Your link addon is still getting that video’s music. Try again in a few minutes.' } });
    expect(harness.addonFileUrls).toEqual([]);
  });

  it('drop the check when the site answers 410 because the player stopped it, and send nothing more', async () => {
    const harness = new LinkJobsHarness();
    harness.addon.answerAudioLinks = () => Promise.resolve({ status: 202, body: { retryAfterSeconds: 5 } });
    harness.site.endedJobIds.add('lj_12');
    harness.linkJobs.start();
    harness.site.queueJob(VERIFY_JOB);
    await waitUntil(() => harness.hasLog('[link-jobs] verify lj_12: stopped on the site, nothing sent'));
    const askCount = harness.addon.requests.length;
    await harness.clock.advance(60_000);
    expect(harness.addon.requests).toHaveLength(askCount);
    expect(getAnswerStatuses(harness)).toEqual(['working']);
    expect(harness.fingerprintSongIds).toEqual([]);
  });
});

describe('the job loop', () => {
  it('backs off after failed asks, 1 s, 2 s, 5 s, then 30 s, starts over after a good one, and stops when the site says signed out', async () => {
    const harness = new LinkJobsHarness();
    harness.site.pollOutcomes.push('fail', 'fail', 'fail', 'fail', 'fail', 'no-job', 'fail', 'signed-out');
    const getRetryWaits = (): string[] => harness.logs.flatMap((line) => /asking again in (\d+) s$/.exec(line)?.[1] ?? []);
    harness.linkJobs.start();
    for (const [index, seconds] of [1, 2, 5, 30, 30].entries()) {
      await waitUntil(() => getRetryWaits().length === index + 1);
      await harness.clock.advance(seconds * 1000);
    }
    await waitUntil(() => harness.site.pollCount === 6);
    await harness.clock.advance(1_000);
    await waitUntil(() => getRetryWaits().length === 6);
    await harness.clock.advance(1_000);
    await waitUntil(() => harness.signOutCount === 1);
    expect(getRetryWaits()).toEqual(['1', '2', '5', '30', '30', '1']);
    await harness.clock.advance(60_000);
    expect(harness.site.pollCount).toBe(8);
    expect(harness.signOutCount).toBe(1);
  });

  it('starts afresh when the computer is linked again after the site signed it out', async () => {
    const harness = new LinkJobsHarness();
    harness.site.pollOutcomes.push('signed-out');
    harness.linkJobs.start();
    await waitUntil(() => harness.signOutCount === 1);
    harness.linkAgain();
    harness.linkJobs.start();
    await waitUntil(() => harness.site.pollCount === 2 && harness.site.presences.length === 2);
    harness.site.queueJob(FIND_JOB);
    await waitUntil(() => harness.site.answers.length === 1);
  });

  it('runs one find at a time and two music jobs at a time; the others wait their turn', async () => {
    const releaseDownloads: (() => void)[] = [];
    const harness = new LinkJobsHarness({ downloadFile: ({ filePath }) => new Promise((resolve) => { releaseDownloads.push(() => { void writeFile(filePath, 'OggS-night-drive').then(resolve); }); }) });
    const releaseFinds: (() => void)[] = [];
    harness.addon.answer = () => new Promise((resolve) => { releaseFinds.push(() => { resolve({ status: 200, body: FOUND_NIGHT_DRIVE }); }); });
    harness.linkJobs.start();
    harness.site.queueJob(FIND_JOB);
    harness.site.queueJob({ ...FIND_JOB, id: 'lj_3' });
    await waitUntil(() => releaseFinds.length === 1);
    await waitBriefly();
    expect(releaseFinds).toHaveLength(1);
    releaseFinds[0]?.();
    await waitUntil(() => releaseFinds.length === 2);
    releaseFinds[1]?.();
    await waitUntil(() => harness.site.answers.length === 2);
    for (const id of ['lj_4', 'lj_5', 'lj_6']) harness.site.queueJob({ ...MUSIC_JOB, id, songId: `ls_${id}` });
    await waitUntil(() => releaseDownloads.length === 2);
    await waitBriefly();
    expect(releaseDownloads).toHaveLength(2);
    releaseDownloads[0]?.();
    await waitUntil(() => releaseDownloads.length === 3);
    releaseDownloads[1]?.();
    releaseDownloads[2]?.();
    await waitUntil(() => harness.site.uploads.length === 3);
    expect(harness.site.uploads.map((upload) => upload.jobId).sort()).toEqual(['lj_4', 'lj_5', 'lj_6']);
    await waitForMusicJobFoldersToGo();
  });

  it('logs job ids and statuses, never a link', async () => {
    const harness = new LinkJobsHarness();
    await harness.startAndFindNightDrive();
    harness.site.queueJob({ ...FIND_JOB, id: 'lj_3', link: 'https://other.example.net/v/night-drive' });
    harness.site.queueJob(MUSIC_JOB);
    harness.site.queueJob({ ...MUSIC_JOB, id: 'lj_5', expiresAt: '2026-11-21T11:00:00.000Z' });
    await waitUntil(() => harness.hasLog('[link-jobs] music lj_2: audio uploaded') && harness.hasLog('[link-jobs] music lj_5: expired before it started') && harness.hasLog('[link-jobs] find lj_3: notfound'));
    expect(harness.logs).toEqual(expect.arrayContaining(['[link-jobs] find lj_1: taken', '[link-jobs] find lj_1: found', '[link-jobs] find lj_3: notfound', '[link-jobs] music lj_2: taken']));
    expect(harness.logs.filter((line) => /https?:|clips\.example|media\.example\.org|other\.example\.net|127\.0\.0\.1/.test(line))).toEqual([]);
    await waitForMusicJobFoldersToGo();
  });
});
