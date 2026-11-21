import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import {
  buildLinkFindResults,
  buildNotFoundAnswer,
  buildSyncPresence,
  findLinkAddon,
  getLinkAddonDeclarations,
  HttpRequestError,
  isLinkJobExpired,
  SignedOutError,
  StepsVaultApiError,
  withLinkSongSource,
  type FindLinkJob,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type InstalledAddon,
  type LinkJob,
  type LinkJobAnswer,
  type LinkJobDelivery,
  type LinkJobsApi,
  type LinkSongSource,
  type MusicLinkJob,
  type SongMusicSource,
} from '@stepsvault/sync-core';
import { SiteMusicLimitError, type FoundSongChoices, type MakeSongMusic } from './make-song-music';

const PRESENCE_EVERY_MILLISECONDS = 30_000;
/** The site gives up on a find 20 s after Sync took it; Sync stops waiting for the addon 2 s before that. */
const FIND_WAIT_MILLISECONDS = 18_000;
/** After a failed ask for a job: 1 s, 2 s, 5 s, then every 30 s, so a site that is down isn't hammered. */
const RETRY_WAITS_MILLISECONDS: readonly number[] = [1_000, 2_000, 5_000, 30_000];
/** A site that answers "no job" at once, instead of holding the request, is still asked at most once a second. */
const MIN_ASK_EVERY_MILLISECONDS = 1_000;
const MAX_RUNNING_JOBS_BY_KIND: Readonly<Record<LinkJob['kind'], number>> = { find: 1, music: 2 };
/** Taken jobs waiting their turn; past this, Sync takes no more until one ends. */
const MAX_WAITING_JOBS = 10;
/** A player's recent finds, so a song found a while ago can still be picked, or tried again. */
const MAX_REMEMBERED_FINDS = 20;

export interface SiteLinkJobsDependencies {
  /** The site's link-job API with this computer's device token; null while the account isn't linked. */
  buildApi(): LinkJobsApi | null;
  /** The addons as the player has them now. */
  getAddons(): readonly InstalledAddon[];
  /** The link tab's own way to find a song and get its music (design v3.122). */
  songs: Pick<MakeSongMusic, 'findSongChoices' | 'prepareMusicForSite' | 'forgetMusic'>;
  /** The addons' network: it starts an addon on this computer that has a start command. */
  addonHttpClient: HttpClient;
  /** One folder per music job in the app's own data folder; removing it also forgets the files in it. */
  jobFiles: { getJobFolder(jobKey: string): string; removeJobFiles(jobKey: string): Promise<void> };
  sourceStore: { load(): Promise<LinkSongSource[]>; save(sources: LinkSongSource[]): Promise<void> };
  computerName: string;
  appVersion: string;
  getNowMilliseconds(): number;
  waitMilliseconds(milliseconds: number): Promise<void>;
  /** One line for the support log: job ids and statuses only, never a link. */
  log(line: string): void;
  /** The site said this computer is signed out. */
  onSignedOut(): void;
}

interface TakenJob {
  job: LinkJob;
  takenAtMilliseconds: number;
}

/** A find whose songs can still be picked: the music job names one by its ref. */
interface RememberedFind {
  source: SongMusicSource;
  musicIdsByRef: ReadonlyMap<string, string>;
}

/** Why a link song has no music, as one short sentence for the player; never an error's own text, which can hold an address. */
class LinkMusicFailure extends Error {}

/**
 * Link jobs from the website (design v3.124), while the app runs and the account is linked: the website relays a link
 * the player pasted, the addon finds the song on this computer, and Sync uploads only its audio. Presence keeps the
 * site's link option in step with the link addons that are on. Finding and getting the music go the link tab's way;
 * the local bridge isn't used, since a phone on another computer can't reach it.
 */
export class SiteLinkJobs {
  private readonly dependencies: SiteLinkJobsDependencies;
  private isRunning = false;
  /** Every start and stop counts up, so the loops of an earlier start end even when the app starts again at once. */
  private runNumber = 0;
  private lastSentDeclarationsText: string | null = null;
  private readonly waitingJobs: TakenJob[] = [];
  private readonly runningCountsByKind: Record<LinkJob['kind'], number> = { find: 0, music: 0 };
  private readonly findsById = new Map<string, RememberedFind>();
  private jobEndListeners: (() => void)[] = [];
  private sources: LinkSongSource[] | null = null;
  private savingSources: Promise<void> = Promise.resolve();

  constructor(dependencies: SiteLinkJobsDependencies) {
    this.dependencies = dependencies;
  }

  /** On start and after linking: presence now and every 30 s, and asking the site for jobs. */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runNumber += 1;
    void this.sendPresence({ isLeaving: false });
    void this.keepSendingPresence(this.runNumber);
    void this.keepTakingJobs(this.runNumber);
  }

  /** On quit, leaving, so the site shows this computer offline at once; or when the account is unlinked. */
  async stop({ isLeaving }: { isLeaving: boolean }): Promise<void> {
    if (!this.isRunning) return;
    this.stopRunning();
    if (isLeaving) await this.sendPresence({ isLeaving: true });
  }

  /** After a link addon was turned on or off, installed or removed: the site's link option follows at once. */
  handleAddonsChange(): void {
    if (!this.isRunning) return;
    if (JSON.stringify(getLinkAddonDeclarations(this.dependencies.getAddons())) === this.lastSentDeclarationsText) return;
    void this.sendPresence({ isLeaving: false });
  }

  private stopRunning(): void {
    this.isRunning = false;
    this.runNumber += 1;
    // Jobs taken but not started stay unanswered; the site times them out.
    this.waitingJobs.length = 0;
    this.notifyJobEnded();
  }

  private handleSignedOut(): void {
    if (!this.isRunning) return;
    this.stopRunning();
    this.dependencies.onSignedOut();
  }

  private async keepSendingPresence(runNumber: number): Promise<void> {
    for (;;) {
      await this.dependencies.waitMilliseconds(PRESENCE_EVERY_MILLISECONDS);
      if (runNumber !== this.runNumber) return;
      await this.sendPresence({ isLeaving: false });
    }
  }

  private async sendPresence({ isLeaving }: { isLeaving: boolean }): Promise<void> {
    const api = this.dependencies.buildApi();
    if (!api) return;
    const presence = buildSyncPresence({ computerName: this.dependencies.computerName, appVersion: this.dependencies.appVersion, addons: this.dependencies.getAddons(), isLeaving });
    this.lastSentDeclarationsText = JSON.stringify(presence.linkAddons);
    try {
      await api.reportPresence(presence);
    } catch (error) {
      // Anything else is tried again with the next presence, at most 30 s later.
      if (error instanceof SignedOutError) this.handleSignedOut();
    }
  }

  private async keepTakingJobs(runNumber: number): Promise<void> {
    let failureCount = 0;
    while (runNumber === this.runNumber) {
      if (this.waitingJobs.length >= MAX_WAITING_JOBS) {
        await this.waitForJobToEnd();
        continue;
      }
      const api = this.dependencies.buildApi();
      if (!api) {
        // Unlinked: linking again starts everything afresh.
        this.stopRunning();
        return;
      }
      const askedAtMilliseconds = this.getNow();
      try {
        const job = await api.fetchNextLinkJob();
        failureCount = 0;
        if (runNumber !== this.runNumber) return;
        if (job) this.takeJob(job);
        else await this.waitBeforeAskingAgain(askedAtMilliseconds);
      } catch (error) {
        if (error instanceof SignedOutError) {
          this.handleSignedOut();
          return;
        }
        const retryMilliseconds = RETRY_WAITS_MILLISECONDS[Math.min(failureCount, RETRY_WAITS_MILLISECONDS.length - 1)] ?? MIN_ASK_EVERY_MILLISECONDS;
        failureCount += 1;
        this.dependencies.log(`[link-jobs] asking for a job failed (${describeFailure(error)}); asking again in ${String(retryMilliseconds / 1000)} s`);
        await this.dependencies.waitMilliseconds(retryMilliseconds);
      }
    }
  }

  private async waitBeforeAskingAgain(askedAtMilliseconds: number): Promise<void> {
    const remainingMilliseconds = askedAtMilliseconds + MIN_ASK_EVERY_MILLISECONDS - this.getNow();
    if (remainingMilliseconds > 0) await this.dependencies.waitMilliseconds(remainingMilliseconds);
  }

  private takeJob(job: LinkJob): void {
    this.waitingJobs.push({ job, takenAtMilliseconds: this.getNow() });
    this.logJob({ job, status: 'taken' });
    this.startWaitingJobs();
  }

  /** At most one find and two music jobs at a time; the others wait their turn in the order they came. */
  private startWaitingJobs(): void {
    for (const takenJob of [...this.waitingJobs]) {
      const { kind } = takenJob.job;
      if (this.runningCountsByKind[kind] >= MAX_RUNNING_JOBS_BY_KIND[kind]) continue;
      this.waitingJobs.splice(this.waitingJobs.indexOf(takenJob), 1);
      this.runningCountsByKind[kind] += 1;
      void this.runJob(takenJob).finally(() => {
        this.runningCountsByKind[kind] -= 1;
        this.notifyJobEnded();
        this.startWaitingJobs();
      });
    }
  }

  private waitForJobToEnd(): Promise<void> {
    return new Promise((resolve) => {
      this.jobEndListeners.push(resolve);
    });
  }

  private notifyJobEnded(): void {
    const listeners = this.jobEndListeners;
    this.jobEndListeners = [];
    for (const listener of listeners) listener();
  }

  /** Never throws: a job that goes wrong is logged, and the loop goes on with the next. */
  private async runJob({ job, takenAtMilliseconds }: TakenJob): Promise<void> {
    try {
      if (isLinkJobExpired({ job, nowMilliseconds: this.getNow() })) {
        this.logJob({ job, status: 'expired before it started' });
        return;
      }
      if (job.kind === 'find') await this.runFindJob({ job, takenAtMilliseconds });
      else await this.runMusicJob(job);
    } catch (error) {
      this.logJob({ job, status: `stopped (${describeFailure(error)})` });
    }
  }

  /**
   * The link tab's way to find a song: the link is checked against the addon's sites first, so a link from any other
   * site never reaches the addon. An addon still silent after 18 s gets no answer from Sync at all; the site's own
   * timeout then says it isn't answering, as the link tab does.
   */
  private async runFindJob({ job, takenAtMilliseconds }: { job: FindLinkJob; takenAtMilliseconds: number }): Promise<void> {
    const linkAddon = findLinkAddon({ addons: this.dependencies.getAddons(), addonId: job.addonId });
    if (!linkAddon) {
      await this.answerJob({ job, answer: { status: 'gone' } });
      return;
    }
    const deadlineMilliseconds = takenAtMilliseconds + FIND_WAIT_MILLISECONDS;
    const found = await this.dependencies.songs.findSongChoices({
      addon: linkAddon.addon,
      valuesByInputId: { [linkAddon.linkInput.id]: job.link },
      httpClient: this.buildAddonClientBefore(deadlineMilliseconds),
      waitSeconds: (seconds) => this.waitBefore({ deadlineMilliseconds, milliseconds: seconds * 1000 }),
      shouldStop: () => this.getNow() >= deadlineMilliseconds,
    });
    if (found.kind === 'found') {
      await this.answerFoundSongs({ job, found, sites: linkAddon.linkInput.sites });
      return;
    }
    const answer = getUnfoundAnswerOrNull(found);
    if (answer) await this.answerJob({ job, answer });
    else this.logJob({ job, status: 'no answer from the addon, nothing sent' });
  }

  private async answerFoundSongs({ job, found, sites }: { job: FindLinkJob; found: Extract<FoundSongChoices, { kind: 'found' }>; sites: readonly string[] }): Promise<void> {
    const results = buildLinkFindResults({ choices: found.choices, link: found.source.link ?? job.link, sites });
    this.rememberFind({ findId: job.id, find: { source: found.source, musicIdsByRef: new Map(results.map(({ choice, result }) => [result.ref, choice.musicId])) } });
    const delivery = await this.answerJob({ job, answer: { status: 'found', results: results.map(({ result }) => result) } });
    // No music job can come for a find the site never got.
    if (delivery !== 'delivered') this.forgetFind(job.id);
  }

  /** The found song the player picked: its music only, as the site takes it, uploaded only while the job is open. */
  private async runMusicJob(job: MusicLinkJob): Promise<void> {
    const jobKey = getLinkJobKey(job.id);
    try {
      this.logJob({ job, status: await this.sendMusic({ job, jobKey }) });
    } catch (error) {
      if (error instanceof SignedOutError) {
        this.handleSignedOut();
        return;
      }
      const reason = error instanceof LinkMusicFailure ? error.message : 'Sync couldn’t send the music. Try again.';
      await this.answerJob({ job, answer: { status: 'failed', reason } });
    } finally {
      // Only the temporary download and its conversion are in the job's folder.
      await this.dependencies.jobFiles.removeJobFiles(jobKey).catch(() => undefined);
    }
  }

  /** The status to log; throws LinkMusicFailure with the reason to send when there is no music. */
  private async sendMusic({ job, jobKey }: { job: MusicLinkJob; jobKey: string }): Promise<string> {
    const find = this.findsById.get(job.findId);
    const musicId = find?.musicIdsByRef.get(job.ref);
    if (!find || musicId === undefined) throw new LinkMusicFailure('Sync no longer has this song. Find it again.');
    const addonName = find.source.addonName;
    if (!findLinkAddon({ addons: this.dependencies.getAddons(), addonId: job.addonId })) throw new LinkMusicFailure(`${addonName} is turned off in Sync.`);
    const folder = this.dependencies.jobFiles.getJobFolder(jobKey);
    await mkdir(folder, { recursive: true });
    const audio = await this.dependencies.songs.prepareMusicForSite({ musicId, folder }).catch((error: unknown) => {
      throw new LinkMusicFailure(error instanceof SiteMusicLimitError ? error.message : `${addonName} couldn’t get the music.`);
    });
    const api = this.dependencies.buildApi();
    if (!api) return 'signed out, nothing sent';
    const state = await api.fetchLinkJobState(job.id);
    if (state !== 'open') return `${state}, nothing sent`;
    const delivery = await api.uploadLinkJobAudio({ jobId: job.id, audio }).catch((error: unknown) => {
      if (error instanceof SignedOutError) throw error;
      throw new LinkMusicFailure('The music couldn’t be sent to dancedance.studio. Try again.');
    });
    if (delivery === 'late') return 'too late, the site keeps nothing';
    await this.saveSource({ songId: job.songId, source: find.source });
    return 'audio uploaded';
  }

  private async answerJob({ job, answer }: { job: LinkJob; answer: LinkJobAnswer }): Promise<LinkJobDelivery | null> {
    const api = this.dependencies.buildApi();
    if (!api) return null;
    try {
      const delivery = await api.answerLinkJob({ jobId: job.id, answer });
      this.logJob({ job, status: delivery === 'late' ? `${answer.status}, too late` : answer.status });
      return delivery;
    } catch (error) {
      if (error instanceof SignedOutError) this.handleSignedOut();
      this.logJob({ job, status: `${answer.status} not delivered (${describeFailure(error)})` });
      return null;
    }
  }

  private rememberFind({ findId, find }: { findId: string; find: RememberedFind }): void {
    this.findsById.set(findId, find);
    // A Map keeps the order things were added in, so the oldest finds come first.
    for (const oldFindId of this.findsById.keys()) {
      if (this.findsById.size <= MAX_REMEMBERED_FINDS) return;
      this.forgetFind(oldFindId);
    }
  }

  private forgetFind(findId: string): void {
    for (const musicId of this.findsById.get(findId)?.musicIdsByRef.values() ?? []) this.dependencies.songs.forgetMusic(musicId);
    this.findsById.delete(findId);
  }

  /** One after another, so two music jobs that end together don't lose a record. */
  private saveSource({ songId, source }: { songId: string; source: SongMusicSource }): Promise<void> {
    this.savingSources = this.savingSources
      .then(async () => {
        const sources = withLinkSongSource({ sources: this.sources ?? (await this.dependencies.sourceStore.load()), songId, source });
        this.sources = sources;
        await this.dependencies.sourceStore.save(sources);
      })
      .catch(() => undefined);
    return this.savingSources;
  }

  /** The addon's network for one find: every request gives up at the find's deadline, starting a local addon included. */
  private buildAddonClientBefore(deadlineMilliseconds: number): HttpClient {
    const { addonHttpClient } = this.dependencies;
    return {
      requestJson: (request) => this.sendBefore({ request, deadlineMilliseconds, send: (limitedRequest) => addonHttpClient.requestJson(limitedRequest) }),
      requestText: (request) => this.sendBefore({ request, deadlineMilliseconds, send: (limitedRequest) => addonHttpClient.requestText(limitedRequest) }),
      requestBytes: (request) => this.sendBefore({ request, deadlineMilliseconds, send: (limitedRequest) => addonHttpClient.requestBytes(limitedRequest) }),
    };
  }

  private sendBefore<Body>({ request, deadlineMilliseconds, send }: { request: HttpRequest; deadlineMilliseconds: number; send: (request: HttpRequest) => Promise<HttpResponse<Body>> }): Promise<HttpResponse<Body>> {
    const remainingMilliseconds = deadlineMilliseconds - this.getNow();
    if (remainingMilliseconds <= 0) return Promise.reject(buildAddonTimeoutError());
    const deadlinePassed = this.dependencies.waitMilliseconds(remainingMilliseconds).then((): never => {
      throw buildAddonTimeoutError();
    });
    return Promise.race([send({ ...request, timeoutMilliseconds: Math.min(request.timeoutMilliseconds, remainingMilliseconds) }), deadlinePassed]);
  }

  private async waitBefore({ deadlineMilliseconds, milliseconds }: { deadlineMilliseconds: number; milliseconds: number }): Promise<void> {
    const waitMilliseconds = Math.min(milliseconds, deadlineMilliseconds - this.getNow());
    if (waitMilliseconds > 0) await this.dependencies.waitMilliseconds(waitMilliseconds);
  }

  private logJob({ job, status }: { job: LinkJob; status: string }): void {
    this.dependencies.log(`[link-jobs] ${job.kind} ${job.id}: ${status}`);
  }

  private getNow(): number {
    return this.dependencies.getNowMilliseconds();
  }
}

/** A find that found nothing: the addon's notfound, or notfound for a link the addon's sites don't take; null when the addon didn't answer. */
function getUnfoundAnswerOrNull(found: Exclude<FoundSongChoices, { kind: 'found' }>): LinkJobAnswer | null {
  // The site checks the link too; when its check let through a link the addon's sites don't take, the addon is never asked.
  if (found.kind === 'invalid-input') return { status: 'notfound' };
  if (found.kind === 'not-found') return buildNotFoundAnswer(found.message);
  return null;
}

/** A job's folder name: the site's job id could hold any character, so the folder is named by a hash of it. */
function getLinkJobKey(jobId: string): string {
  return `link-${createHash('sha256').update(jobId).digest('hex').slice(0, 32)}`;
}

function buildAddonTimeoutError(): HttpRequestError {
  return new HttpRequestError({ failure: 'timeout', message: 'The addon took too long to answer.' });
}

/** For the log: what kind of failure, never an error's own text, which can hold an address. */
function describeFailure(error: unknown): string {
  if (error instanceof StepsVaultApiError) return `the site answered ${String(error.status)}`;
  if (error instanceof HttpRequestError) return error.failure;
  return error instanceof Error ? error.name : 'unknown';
}
