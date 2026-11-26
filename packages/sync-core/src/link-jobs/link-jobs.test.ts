import { describe, expect, it } from 'vitest';
import { buildInstalledAddon, type InstalledAddon } from '../addons/addon-client';
import type { AddonManifest } from '../addons/addon-protocol';
import type { SongSourceFileLink, SongSourceSong } from '../addons/song-source-protocol';
import type { FileUploadHttpClient, FileUploadHttpRequest, HttpClient, HttpRequest, HttpResponse } from '../network/http-client';
import { SignedOutError, DancedanceApiError } from '../dancedance-api/dancedance-api-types';
import { DancedanceClient } from '../dancedance-api/dancedance-client';
import { getLinkAudioContentTypeOrNull } from './link-audio-files';
import { buildLinkFindResults, buildNameFindResult, buildNameFindSongFacts, buildNotFoundAnswer, buildSongSearchFacts, buildSongSearchFoundChoices, buildSongSearchMusicFacts, buildSongSearchNotFoundAnswer, buildSyncPresence, findLinkAddon, getNameFindAddons, getPresenceAddonsKey, getSongSearchAddons, isLinkJobExpired, parseLinkJobOrNull, parseLinkJobState, type SyncPresence } from './link-job-protocol';
import { loadLinkSongSources, withLinkSongSource } from './link-song-sources';

const SITE_URL = 'https://dancedance.studio';
const API_URL = 'https://dancedance.studio/api/sync';
const OPEN_AUDIO_LINKS: AddonManifest = {
  protocol: 1, kind: 'addon', id: 'open-audio-links', name: 'Open Audio Links', version: '1.4.0', author: '@noa', description: 'Finds the song behind a clip link.', provides: ['audio-links', 'video-links', 'song-source'],
  options: [{ id: 'media', label: 'What to get', kind: 'choice', choices: [{ value: 'audio', label: 'Music only' }, { value: 'audio-and-video', label: 'Music and video' }], default: 'audio-and-video' }],
  inputs: [{ id: 'link', kind: 'link', label: 'Audio link', placeholder: 'https://clips.example/v/…', sites: ['clips.example', 'media.example.org'] }, { id: 'note', kind: 'search', label: 'Note', placeholder: null }],
};
const NIGHT_DRIVE: SongSourceSong = { title: 'Night Drive', artist: 'Lumen Park', album: null, genre: null, lengthSeconds: 220.6, videoId: 'Vid3o1d-x_Z' };
const MUSIC_LINK: SongSourceFileLink = { kind: 'file-url', media: 'audio', url: 'http://127.0.0.1:7802/files/night-drive.ogg', label: 'Music', fileName: 'night-drive.ogg' };
const VIDEO_LINK: SongSourceFileLink = { kind: 'file-url', media: 'video', url: 'http://127.0.0.1:7802/files/night-drive.mp4', label: 'Video', fileName: 'night-drive.mp4' };

function buildAddon({ manifest, isEnabled = true }: { manifest: AddonManifest; isEnabled?: boolean }): InstalledAddon {
  return { ...buildInstalledAddon({ baseUrl: `http://127.0.0.1:7802/${manifest.id}`, manifest, consentedAt: '2026-11-21T10:00:00.000Z' }), isEnabled };
}

describe('presence', () => {
  const linkAddonWithoutPlaceholder: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'media-links', name: 'Media Links', inputs: [{ id: 'clip', kind: 'link', label: 'Clip link', placeholder: null, sites: ['media.example.org'] }] };
  const searchOnly: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'song-scout', name: 'Song Scout', inputs: [{ id: 'title', kind: 'search', label: 'Title', placeholder: null }] };
  const audioLinksOnly: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'tune-bridge', name: 'Tune Bridge', provides: ['audio-links'], inputs: [] };
  const turnedOff: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'off-links', name: 'Off Links' };
  const addons = [buildAddon({ manifest: OPEN_AUDIO_LINKS }), buildAddon({ manifest: searchOnly }), buildAddon({ manifest: audioLinksOnly }), buildAddon({ manifest: turnedOff, isEnabled: false }), buildAddon({ manifest: linkAddonWithoutPlaceholder })];

  it('lists only the link addons that are on, straight from their declarations, and nothing else about them or the computer', () => {
    const presence: SyncPresence = buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons, isLeaving: false });
    expect(presence).toStrictEqual({
      computerName: 'LIVING-ROOM',
      appVersion: '0.2.0',
      linkJobs: 1,
      installJobs: 1,
      verifyJobs: 1,
      nameFinds: 1,
      songSearches: 0,
      linkAddons: [
        { id: 'open-audio-links', name: 'Open Audio Links', label: 'Audio link', placeholder: 'https://clips.example/v/…', sites: ['clips.example', 'media.example.org'] },
        { id: 'media-links', name: 'Media Links', label: 'Clip link', placeholder: '', sites: ['media.example.org'] },
      ],
    });
  });

  it('still says it takes link jobs with no link addon on, and says leaving only on quit', () => {
    expect(buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons: [buildAddon({ manifest: searchOnly })], isLeaving: false })).toStrictEqual({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', linkJobs: 1, installJobs: 1, verifyJobs: 1, nameFinds: 1, songSearches: 0, linkAddons: [] });
    expect(buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons, isLeaving: true }).leaving).toBe(true);
  });

  it('says nameFinds 1 only while an addon that is on provides audio-links, and its key changes with it', () => {
    const songSourceOnly: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'clip-finder', name: 'Clip Finder', provides: ['song-source'] };
    const audioLinksOff = buildAddon({ manifest: audioLinksOnly, isEnabled: false });
    expect(buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons: [buildAddon({ manifest: songSourceOnly }), audioLinksOff], isLeaving: false }).nameFinds).toBe(0);
    expect(buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons: [], isLeaving: false }).nameFinds).toBe(0);
    expect(buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons: [buildAddon({ manifest: audioLinksOnly })], isLeaving: false })).toMatchObject({ nameFinds: 1, linkAddons: [] });
    expect(getNameFindAddons(addons).map((addon) => addon.manifest.id)).toEqual(['open-audio-links', 'song-scout', 'tune-bridge', 'media-links']);
    expect(getPresenceAddonsKey([audioLinksOff])).not.toBe(getPresenceAddonsKey([buildAddon({ manifest: audioLinksOnly })]));
  });

  it('says songSearches 1 only while an addon that is on provides song-search with audio-links, and its key changes with it', () => {
    const songSearch: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'song-finder', name: 'Song Finder', provides: ['audio-links', 'song-search'], inputs: [] };
    const songSearchWithoutAudio: AddonManifest = { ...OPEN_AUDIO_LINKS, id: 'clip-finder', name: 'Clip Finder', provides: ['song-source', 'song-search'] };
    const songSearchOff = buildAddon({ manifest: songSearch, isEnabled: false });
    const getSongSearches = (presenceAddons: InstalledAddon[]): number => buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons: presenceAddons, isLeaving: false }).songSearches;
    expect(getSongSearches([buildAddon({ manifest: songSearch })])).toBe(1);
    expect(getSongSearches([songSearchOff, buildAddon({ manifest: songSearchWithoutAudio }), ...addons])).toBe(0);
    expect(getSongSearches([])).toBe(0);
    expect(getSongSearchAddons([buildAddon({ manifest: songSearchWithoutAudio }), songSearchOff, ...addons, buildAddon({ manifest: songSearch })]).map((addon) => addon.manifest.id)).toEqual(['song-finder']);
    expect(getPresenceAddonsKey([songSearchOff])).not.toBe(getPresenceAddonsKey([buildAddon({ manifest: songSearch })]));
  });

  it('finds the link addon a job names only while it is on and has a link field', () => {
    expect(findLinkAddon({ addons, addonId: 'open-audio-links' })?.linkInput.id).toBe('link');
    expect(findLinkAddon({ addons, addonId: 'off-links' })).toBeNull();
    expect(findLinkAddon({ addons, addonId: 'song-scout' })).toBeNull();
    expect(findLinkAddon({ addons, addonId: 'removed-links' })).toBeNull();
  });
});

describe('reading link jobs', () => {
  it('reads find, music, install and verify jobs as the site sends them', () => {
    expect(parseLinkJobOrNull({ id: 'lj_1', kind: 'find', addonId: 'open-audio-links', link: 'https://clips.example/v/night-drive', expiresAt: '2026-11-21T12:00:20.000Z' })).toEqual({ id: 'lj_1', kind: 'find', addonId: 'open-audio-links', link: 'https://clips.example/v/night-drive', expiresAt: '2026-11-21T12:00:20.000Z' });
    expect(parseLinkJobOrNull({ id: 'lj_2', kind: 'music', addonId: 'open-audio-links', findId: 'lj_1', ref: 'r1', songId: 'ls_9', expiresAt: '2026-11-21T12:10:00.000Z' })).toEqual({ id: 'lj_2', kind: 'music', addonId: 'open-audio-links', findId: 'lj_1', ref: 'r1', songId: 'ls_9', expiresAt: '2026-11-21T12:10:00.000Z' });
    expect(parseLinkJobOrNull({ id: 'lj_9', kind: 'install', addonId: 'open-audio-links', songId: 'song_42', expiresAt: '2026-11-21T12:10:00.000Z' })).toEqual({ id: 'lj_9', kind: 'install', addonId: 'open-audio-links', songId: 'song_42', expiresAt: '2026-11-21T12:10:00.000Z' });
    const librarySong = { librarySongId: 'song_42', slug: 'night-drive', title: 'Night Drive', artist: 'Lumen Park', album: null, genre: 'Synthwave', lengthSeconds: 221, videoId: null, chartVersion: 'v1' };
    expect(parseLinkJobOrNull({ id: 'lj_12', kind: 'verify', addonId: 'open-audio-links', songId: 'song_42', videoId: 'Vid3o1d-x_Z', expiresAt: '2026-11-21T12:03:00.000Z', song: librarySong })).toEqual({
      id: 'lj_12', kind: 'verify', addonId: 'open-audio-links', songId: 'song_42', videoId: 'Vid3o1d-x_Z', videoUrl: null, expiresAt: '2026-11-21T12:03:00.000Z',
      song: { librarySongId: 'song_42', title: 'Night Drive', artist: 'Lumen Park', album: null, genre: 'Synthwave', lengthSeconds: 221 },
    });
  });

  it('reads a name find with only the song’s facts, and a music job for it with no addon', () => {
    const song = { title: 'Spotlight', artist: 'Mira Vale', album: 'Neon Hours', lengthSeconds: 204 };
    expect(parseLinkJobOrNull({ id: 'lj_20', kind: 'name-find', song, expiresAt: '2026-11-21T12:03:00.000Z' })).toEqual({ id: 'lj_20', kind: 'name-find', song, expiresAt: '2026-11-21T12:03:00.000Z' });
    expect(parseLinkJobOrNull({ id: 'lj_21', kind: 'name-find', addonId: '', song: { title: 'Spotlight', artist: 'Mira Vale', lengthSeconds: 0, videoId: 'Vid3o1d-x_Z' }, expiresAt: null })).toEqual({ id: 'lj_21', kind: 'name-find', song: { title: 'Spotlight', artist: 'Mira Vale', album: null, lengthSeconds: null }, expiresAt: null });
    for (const addonId of ['', undefined, null]) {
      expect(parseLinkJobOrNull({ id: 'lj_22', kind: 'music', addonId, findId: 'lj_20', ref: 'r1', songId: 'ls_9', expiresAt: null })).toEqual({ id: 'lj_22', kind: 'music', addonId: '', findId: 'lj_20', ref: 'r1', songId: 'ls_9', expiresAt: null });
    }
  });

  it('reads a song search with only the song’s facts, and a music job for one of its versions with the song and the video', () => {
    const song = { title: 'Pulse Garden', artist: 'Kairo Lights', album: null, lengthSeconds: 201 };
    expect(parseLinkJobOrNull({ id: 'lj_40', kind: 'song-search', song, expiresAt: '2026-11-26T12:03:00.000Z' })).toEqual({ id: 'lj_40', kind: 'song-search', song, expiresAt: '2026-11-26T12:03:00.000Z' });
    expect(parseLinkJobOrNull({ id: 'lj_40', kind: 'song-search', addonId: 'x', song: { ...song, album: 7, lengthSeconds: -1, videoId: 'abc123DEF45' }, expiresAt: null })).toEqual({ id: 'lj_40', kind: 'song-search', song: { ...song, lengthSeconds: null }, expiresAt: null });
    const video = { id: 'abc123DEF45', pageUrl: 'https://clips.example/watch?v=abc123DEF45' };
    const musicJob = { id: 'lj_41', kind: 'music', addonId: '', findId: 'lj_40', ref: 'c2', songId: 'ls_20', song, video, expiresAt: null };
    expect(parseLinkJobOrNull(musicJob)).toStrictEqual(musicJob);
    for (const brokenVideo of [{ ...video, id: 'short' }, { ...video, pageUrl: 'http://clips.example/watch' }, { id: video.id }, 'abc123DEF45']) {
      expect(parseLinkJobOrNull({ ...musicJob, video: brokenVideo })).toStrictEqual({ id: 'lj_41', kind: 'music', addonId: '', findId: 'lj_40', ref: 'c2', songId: 'ls_20', song, expiresAt: null });
    }
    expect(parseLinkJobOrNull({ ...musicJob, song: { title: 'Pulse Garden' } })).toStrictEqual({ id: 'lj_41', kind: 'music', addonId: '', findId: 'lj_40', ref: 'c2', songId: 'ls_20', video, expiresAt: null });
  });

  it.each([
    [{ id: 'lj_42', kind: 'song-search', song: { title: 'Pulse Garden', artist: '' } }],
    [{ id: 'lj_43', kind: 'song-search' }],
    [{ id: 'lj_23', kind: 'name-find', song: { title: 'Spotlight', artist: ' ' } }],
    [{ id: 'lj_24', kind: 'name-find', song: { artist: 'Mira Vale' } }],
    [{ id: 'lj_25', kind: 'name-find' }],
    [{ id: 'lj_26', kind: 'music', addonId: 'a\nb', findId: 'lj_20', ref: 'r1', songId: 'ls_9' }],
    [{ id: 'lj_3', kind: 'video', addonId: 'open-audio-links' }],
    [{ kind: 'find', addonId: 'open-audio-links', link: 'https://clips.example/v/a' }],
    [{ id: 'lj_4', kind: 'find', addonId: 'open-audio-links' }],
    [{ id: 'lj_5', kind: 'music', addonId: 'open-audio-links', findId: 'lj_1' }],
    [{ id: 'lj_8', kind: 'install', addonId: 'open-audio-links' }],
    [{ id: 'lj_13', kind: 'verify', addonId: 'open-audio-links', songId: 'song_42', song: { title: 'Night Drive', artist: 'Lumen Park' } }],
    [{ id: 'lj_14', kind: 'verify', addonId: 'open-audio-links', songId: 'song_42', videoId: 'Vid3o1d-x_Z', song: { title: 'Night Drive' } }],
    [{ id: 'lj\n6', kind: 'find', addonId: 'open-audio-links', link: 'https://clips.example/v/a' }],
    [{ id: 'x'.repeat(201), kind: 'find', addonId: 'open-audio-links', link: 'https://clips.example/v/a' }],
    ['lj_7'],
    [null],
  ])('ignores a job it can’t read: %j', (value) => {
    expect(parseLinkJobOrNull(value)).toBeNull();
  });

  it('counts only an open or a cancelled job as such, and a job past its time as expired', () => {
    expect([{ status: 'open' }, { status: 'cancelled' }, { status: 'expired' }, { status: 'done' }, null].map(parseLinkJobState)).toEqual(['open', 'cancelled', 'expired', 'expired', 'expired']);
    const nowMilliseconds = Date.parse('2026-11-21T12:00:00.000Z');
    expect(isLinkJobExpired({ job: { expiresAt: '2026-11-21T11:59:59.000Z' }, nowMilliseconds })).toBe(true);
    expect(isLinkJobExpired({ job: { expiresAt: '2026-11-21T12:00:20.000Z' }, nowMilliseconds })).toBe(false);
    expect(isLinkJobExpired({ job: { expiresAt: null }, nowMilliseconds })).toBe(false);
    expect(isLinkJobExpired({ job: { expiresAt: 'soon' }, nowMilliseconds })).toBe(false);
  });
});

describe('find answers', () => {
  it('gives each found song a ref, its facts in whole seconds, the addon’s site the link is on, and the video whenever the addon gives its id, with or without its file yet', () => {
    const choices = [
      { song: NIGHT_DRIVE, musicLink: MUSIC_LINK, videoLink: VIDEO_LINK },
      { song: { ...NIGHT_DRIVE, title: 'Night Drive (Live)' }, musicLink: MUSIC_LINK, videoLink: null },
      { song: { ...NIGHT_DRIVE, title: 'Night Drive (Edit)', videoId: null }, musicLink: MUSIC_LINK, videoLink: VIDEO_LINK },
      { song: { ...NIGHT_DRIVE, title: 'Night Drive (Demo)', lengthSeconds: null }, musicLink: MUSIC_LINK, videoLink: VIDEO_LINK },
    ];
    const results = buildLinkFindResults({ choices, link: 'https://www.clips.example/v/night-drive', sites: ['clips.example', 'media.example.org'] });
    expect(results.map(({ result }) => result)).toEqual([
      { ref: 'r1', title: 'Night Drive', artist: 'Lumen Park', source: 'clips.example', lengthSec: 221, video: { videoId: 'Vid3o1d-x_Z', title: 'Night Drive', channel: 'Lumen Park', lengthSec: 221 } },
      { ref: 'r2', title: 'Night Drive (Live)', artist: 'Lumen Park', source: 'clips.example', lengthSec: 221, video: { videoId: 'Vid3o1d-x_Z', title: 'Night Drive (Live)', channel: 'Lumen Park', lengthSec: 221 } },
      { ref: 'r3', title: 'Night Drive (Edit)', artist: 'Lumen Park', source: 'clips.example', lengthSec: 221, video: null },
      { ref: 'r4', title: 'Night Drive (Demo)', artist: 'Lumen Park', source: 'clips.example', lengthSec: null, video: { videoId: 'Vid3o1d-x_Z', title: 'Night Drive (Demo)', channel: 'Lumen Park', lengthSec: null } },
    ]);
    expect(results[1]?.choice).toBe(choices[1]);
  });

  it('answers a name find with one song: the job’s title and artist, the measured length in whole seconds, no site and no video', () => {
    const song = { title: 'Spotlight', artist: 'Mira Vale', album: null, lengthSeconds: 204 };
    expect(buildNameFindResult({ song, measuredLengthSeconds: 211.6 })).toEqual({ ref: 'r1', title: 'Spotlight', artist: 'Mira Vale', source: '', lengthSec: 212, video: null });
  });

  it('asks addons for a name find with the song’s facts only: no genre, no video id, no video link', () => {
    expect(buildNameFindSongFacts({ title: 'Spotlight', artist: 'Mira Vale', album: 'Neon Hours', lengthSeconds: 204 })).toStrictEqual({ title: 'Spotlight', artist: 'Mira Vale', album: 'Neon Hours', genre: null, lengthSeconds: 204, videoId: null, videoUrl: null });
  });

  it('sends at most 10 songs, and names the most specific site the link is on', () => {
    const choice = { song: NIGHT_DRIVE, musicLink: MUSIC_LINK, videoLink: null };
    const choices = Array.from({ length: 12 }, () => choice);
    expect(buildLinkFindResults({ choices, link: 'https://clips.example/v/a', sites: ['clips.example'] }).map(({ result }) => result.ref)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10']);
    expect(buildLinkFindResults({ choices: [choice], link: 'https://m.media.clips.example/v/a', sites: ['clips.example', 'media.clips.example'] })[0]?.result.source).toBe('media.clips.example');
  });

  it('passes on the addon’s reason as plain text of at most 140 characters, or none', () => {
    expect(buildNotFoundAnswer('This clip is private.')).toEqual({ status: 'notfound', reason: 'This clip is private.' });
    expect(buildNotFoundAnswer(null)).toEqual({ status: 'notfound' });
    expect(buildNotFoundAnswer(' \n ')).toEqual({ status: 'notfound' });
    expect(buildNotFoundAnswer('This clip\nis‮ private.\t')).toEqual({ status: 'notfound', reason: 'This clip is private.' });
    const answer = buildNotFoundAnswer('a'.repeat(300));
    expect(answer.status === 'notfound' ? answer.reason?.length : 0).toBe(140);
  });
});

describe('song search answers', () => {
  const version = { title: 'Kairo Lights - Pulse Garden (Official Video)', channel: 'Kairo Lights', lengthSeconds: 203, videoId: 'abc123DEF45', pageUrl: 'https://clips.example/watch?v=abc123DEF45', thumbnailUrl: 'https://img.clips.example/abc123DEF45.jpg', isOfficial: true };

  it('gives the versions refs c1 to c5 in order, with the addon’s own fields and nothing else', () => {
    const versions = Array.from({ length: 7 }, (_, index) => ({ ...version, videoId: `video${String(index).padStart(6, '0')}` }));
    const choices = buildSongSearchFoundChoices(versions);
    expect(choices.map((choice) => choice.ref)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(choices[0]).toStrictEqual({ ref: 'c1', ...version, videoId: 'video000000' });
  });

  it('says notfound with the first addon’s sentence as plain text of at most 140 characters, or reason null', () => {
    expect(buildSongSearchNotFoundAnswer('Found nothing with the same length as the song.')).toStrictEqual({ status: 'notfound', reason: 'Found nothing with the same length as the song.' });
    expect(buildSongSearchNotFoundAnswer(null)).toStrictEqual({ status: 'notfound', reason: null });
    expect(buildSongSearchNotFoundAnswer(' a\n‮b ')).toStrictEqual({ status: 'notfound', reason: 'a b' });
    const answer = buildSongSearchNotFoundAnswer('a'.repeat(300));
    expect(answer.status === 'notfound' ? answer.reason?.length : 0).toBe(140);
  });

  it('asks an addon with the song’s facts only, and for a version’s music with its own video id and page, and no genre', () => {
    const song = { title: 'Pulse Garden', artist: 'Kairo Lights', album: 'Afterimage', lengthSeconds: 201 };
    expect(buildSongSearchFacts(song)).toStrictEqual(song);
    expect(buildSongSearchMusicFacts({ song, video: { id: 'abc123DEF45', pageUrl: 'https://clips.example/watch?v=abc123DEF45' } })).toStrictEqual({ ...song, genre: null, videoId: 'abc123DEF45', videoUrl: 'https://clips.example/watch?v=abc123DEF45' });
  });
});

type RecordedAnswer = HttpResponse<unknown> | ((request: HttpRequest | FileUploadHttpRequest) => HttpResponse<unknown>);

/** The site's link-job routes, recorded: each "METHOD url" answers from its route, and every request is remembered. */
class RecordedSite implements HttpClient, FileUploadHttpClient {
  readonly requests: (HttpRequest | FileUploadHttpRequest)[] = [];

  constructor(private readonly answersByKey: Record<string, RecordedAnswer>) {}

  requestJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    return Promise.resolve(this.answer(request));
  }

  requestText(request: HttpRequest): Promise<HttpResponse<string>> {
    return Promise.resolve(this.answerAsText(request));
  }

  requestBytes(): Promise<HttpResponse<Uint8Array>> {
    return Promise.reject(new Error('Not used.'));
  }

  requestTextWithFileBody(request: FileUploadHttpRequest): Promise<HttpResponse<string>> {
    return Promise.resolve(this.answerAsText(request));
  }

  private answerAsText(request: HttpRequest | FileUploadHttpRequest): HttpResponse<string> {
    const { status, body } = this.answer(request);
    return { status, body: typeof body === 'string' ? body : JSON.stringify(body) };
  }

  private answer(request: HttpRequest | FileUploadHttpRequest): HttpResponse<unknown> {
    this.requests.push(request);
    const answer = this.answersByKey[`${request.method} ${request.url}`];
    if (!answer) throw new Error(`No recorded answer for ${request.method} ${request.url}`);
    return typeof answer === 'function' ? answer(request) : answer;
  }
}

describe('DancedanceClient link jobs', () => {
  const presence = buildSyncPresence({ computerName: 'LIVING-ROOM', appVersion: '0.2.0', addons: [buildAddon({ manifest: OPEN_AUDIO_LINKS })], isLeaving: false });
  const job = { id: 'lj_2', kind: 'music', addonId: 'open-audio-links', findId: 'lj_1', ref: 'r1', songId: 'ls_9', expiresAt: '2026-11-21T12:10:00.000Z' };

  it('reports presence, waits for the next job and answers it, each with the device token and only at the site’s API address', async () => {
    const site = new RecordedSite({
      [`POST ${API_URL}/presence`]: { status: 200, body: { isOnline: true } },
      [`GET ${API_URL}/link-jobs/next?waitMs=25000`]: { status: 200, body: job },
      [`GET ${API_URL}/link-jobs/lj_2`]: { status: 200, body: { status: 'open' } },
      [`POST ${API_URL}/link-jobs/lj_2/answer`]: { status: 204, body: '' },
      [`PUT ${API_URL}/link-jobs/lj_2/audio`]: { status: 200, body: 'Stored.' },
    });
    const client = new DancedanceClient({ httpClient: site, fileUploadClient: site, siteUrl: `${SITE_URL}/`, deviceToken: 'device-token-1' });
    await client.reportPresence(presence);
    expect(await client.fetchNextLinkJob()).toEqual(job);
    expect(await client.fetchLinkJobState('lj_2')).toBe('open');
    expect(await client.answerLinkJob({ jobId: 'lj_2', answer: { status: 'failed', reason: 'Open Audio Links couldn’t get the music.' } })).toBe('delivered');
    expect(await client.uploadLinkJobAudio({ jobId: 'lj_2', audio: { sourceId: 'file:abc', contentType: 'audio/ogg' } })).toBe('delivered');
    expect(site.requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', `${API_URL}/presence`],
      ['GET', `${API_URL}/link-jobs/next?waitMs=25000`],
      ['GET', `${API_URL}/link-jobs/lj_2`],
      ['POST', `${API_URL}/link-jobs/lj_2/answer`],
      ['PUT', `${API_URL}/link-jobs/lj_2/audio`],
    ]);
    expect(site.requests.every((request) => request.headers?.Authorization === 'Bearer device-token-1')).toBe(true);
    expect(site.requests[0]).toMatchObject({ jsonBody: presence });
    expect(site.requests[1]?.timeoutMilliseconds).toBe(35_000);
    expect(site.requests[3]).toMatchObject({ jsonBody: { status: 'failed', reason: 'Open Audio Links couldn’t get the music.' } });
    expect(site.requests[4]).toMatchObject({ sourceId: 'file:abc', contentType: 'audio/ogg' });
  });

  it('reads no job when the wait ran out, a job the site no longer knows as ended, and a late answer or upload as late', async () => {
    const site = new RecordedSite({
      [`GET ${API_URL}/link-jobs/next?waitMs=25000`]: { status: 204, body: null },
      [`GET ${API_URL}/link-jobs/lj_2`]: { status: 410, body: { error: 'This job ended.' } },
      [`GET ${API_URL}/link-jobs/lj_3`]: { status: 200, body: { status: 'cancelled' } },
      [`POST ${API_URL}/link-jobs/lj_2/answer`]: { status: 410, body: { error: 'This job ended.' } },
      [`PUT ${API_URL}/link-jobs/lj_2/audio`]: { status: 410, body: { error: 'This job ended.' } },
    });
    const client = new DancedanceClient({ httpClient: site, fileUploadClient: site, siteUrl: SITE_URL, deviceToken: 'device-token-1' });
    expect(await client.fetchNextLinkJob()).toBeNull();
    expect(await client.fetchLinkJobState('lj_2')).toBe('expired');
    expect(await client.fetchLinkJobState('lj_3')).toBe('cancelled');
    expect(await client.answerLinkJob({ jobId: 'lj_2', answer: { status: 'gone' } })).toBe('late');
    expect(await client.uploadLinkJobAudio({ jobId: 'lj_2', audio: { sourceId: 'file:abc', contentType: 'audio/ogg' } })).toBe('late');
  });

  it('stops on a signed-out computer, passes on the site’s sentence for a refused upload, and puts job ids in the address safely', async () => {
    const site = new RecordedSite({
      [`GET ${API_URL}/link-jobs/next?waitMs=25000`]: { status: 401, body: { error: 'Sign in again.' } },
      [`POST ${API_URL}/presence`]: { status: 401, body: '' },
      [`PUT ${API_URL}/link-jobs/lj_2/audio`]: { status: 413, body: { error: 'This file is bigger than 30 MB.' } },
      [`GET ${API_URL}/link-jobs/lj%2F..%2Fme`]: { status: 200, body: { status: 'open' } },
    });
    const client = new DancedanceClient({ httpClient: site, fileUploadClient: site, siteUrl: SITE_URL, deviceToken: 'device-token-1' });
    await expect(client.fetchNextLinkJob()).rejects.toBeInstanceOf(SignedOutError);
    await expect(client.reportPresence(presence)).rejects.toBeInstanceOf(SignedOutError);
    await expect(client.uploadLinkJobAudio({ jobId: 'lj_2', audio: { sourceId: 'file:abc', contentType: 'audio/ogg' } })).rejects.toThrow(new DancedanceApiError({ status: 413, message: 'This file is bigger than 30 MB.' }));
    expect(await client.fetchLinkJobState('lj/../me')).toBe('open');
  });

  it('sends no file without an upload client: only the app uploads', async () => {
    const client = new DancedanceClient({ httpClient: new RecordedSite({}), siteUrl: SITE_URL, deviceToken: null });
    await expect(client.uploadLinkJobAudio({ jobId: 'lj_2', audio: { sourceId: 'file:abc', contentType: 'audio/ogg' } })).rejects.toThrow('can’t send files');
  });
});

describe('link audio files', () => {
  const bytesOf = (...parts: (string | number[])[]): Uint8Array => new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? Array.from(part, (character) => character.charCodeAt(0)) : part)));

  it('knows ogg, wav, m4a and mp3 by their first bytes, whatever the file is called', () => {
    expect(getLinkAudioContentTypeOrNull(bytesOf('OggS', [0, 2]))).toBe('audio/ogg');
    expect(getLinkAudioContentTypeOrNull(bytesOf('RIFF', [36, 0, 0, 0], 'WAVEfmt '))).toBe('audio/wav');
    expect(getLinkAudioContentTypeOrNull(bytesOf([0, 0, 0, 32], 'ftypM4A '))).toBe('audio/mp4');
    expect(getLinkAudioContentTypeOrNull(bytesOf('ID3', [4, 0]))).toBe('audio/mpeg');
    expect(getLinkAudioContentTypeOrNull(bytesOf([0xff, 0xfb, 0x90, 0x64]))).toBe('audio/mpeg');
  });

  it('leaves every other file to be converted first: raw AAC, flac, webm, a video, nothing', () => {
    for (const bytes of [bytesOf([0xff, 0xf1, 0x50, 0x80]), bytesOf('fLaC'), bytesOf([0x1a, 0x45, 0xdf, 0xa3]), bytesOf('RIFF', [0, 0, 0, 0], 'AVI '), new Uint8Array()]) {
      expect(getLinkAudioContentTypeOrNull(bytes)).toBeNull();
    }
  });
});

describe('link song sources', () => {
  const source = { addonId: 'open-audio-links', addonName: 'Open Audio Links', link: 'https://clips.example/v/night-drive' };

  it('keeps one record per site song, newest last, and at most 500', () => {
    const sources = withLinkSongSource({ sources: withLinkSongSource({ sources: [], songId: 'ls_9', source }), songId: 'ls_10', source });
    expect(withLinkSongSource({ sources, songId: 'ls_9', source: { ...source, link: 'https://media.example.org/v/night-drive' } })).toEqual([{ songId: 'ls_10', source }, { songId: 'ls_9', source: { ...source, link: 'https://media.example.org/v/night-drive' } }]);
    const many = Array.from({ length: 501 }, (_, index) => ({ songId: `ls_${String(index)}`, source }));
    expect(withLinkSongSource({ sources: many, songId: 'ls_new', source })).toHaveLength(500);
  });

  it('reads back only complete records', () => {
    expect(loadLinkSongSources([{ songId: 'ls_9', source }, { songId: 'ls_10' }, { source }, 'ls_11', { songId: 'ls_12', source: { addonId: 'open-audio-links', addonName: 'Open Audio Links', link: null } }])).toEqual([{ songId: 'ls_9', source }, { songId: 'ls_12', source: { addonId: 'open-audio-links', addonName: 'Open Audio Links', link: null } }]);
    expect(loadLinkSongSources(null)).toEqual([]);
  });
});
