import type { InstalledAddon } from '../addons/addon-client';
import { isAddonProviding } from '../addons/addon-protocol';
import { isHostOnSites, type SongSourceInput } from '../addons/song-source-inputs';
import type { SongSourceChoice } from '../addons/song-source-protocol';
import { parseUrlOrNull } from '../network/service-address';

/** The website takes a link song's audio as it takes a dropped file: one of these types, at most 30 MB and 8 minutes. */
export const LINK_AUDIO_CONTENT_TYPES = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'] as const;
// "30 MB" can be counted in two ways; Sync stays under the smaller one, so the site never refuses a file it sends for size.
export const MAX_LINK_AUDIO_BYTES = 30_000_000;
export const MAX_LINK_AUDIO_SECONDS = 8 * 60;
/** How long the site holds Sync's request for the next job before it answers that there is none. */
export const LINK_JOB_WAIT_MILLISECONDS = 25_000;
const LINK_JOBS_VERSION = 1;
const INSTALL_JOBS_VERSION = 1;
const VERIFY_JOBS_VERSION = 1;
const MAX_FIND_RESULTS = 10;
const MAX_REASON_LENGTH = 140;
const MAX_JOB_ID_LENGTH = 200;
// Text that reorders or hides other text could make the addon's reason read as something it isn't.
const HIDDEN_CHARACTERS_PATTERN = /[\p{Cc}‪-‮⁦-⁩]+/gu;

export type LinkAudioContentType = (typeof LINK_AUDIO_CONTENT_TYPES)[number];

export type LinkInput = Extract<SongSourceInput, { kind: 'link' }>;

/** A link addon that is on, with the link field the website draws for it. */
export interface LinkAddon {
  addon: InstalledAddon;
  linkInput: LinkInput;
}

/** A link addon as presence describes it: straight from its declaration, and nothing else about it. */
export interface LinkAddonDeclaration {
  id: string;
  name: string;
  label: string;
  /** "" when the addon declares none. */
  placeholder: string;
  sites: string[];
}

/** POST /api/sync/presence. Nothing about the computer but its name. */
export interface SyncPresence {
  computerName: string;
  appVersion: string;
  /** This Sync takes link jobs. A Sync from before them doesn't say so, and the site offers it no link option. */
  linkJobs: typeof LINK_JOBS_VERSION;
  /** This Sync takes install jobs too ("Into my game"); the site sends none to a Sync that doesn't say so. */
  installJobs: typeof INSTALL_JOBS_VERSION;
  /** This Sync checks a video link against a song's music (verify jobs); the site sends none to a Sync that doesn't say so. */
  verifyJobs: typeof VERIFY_JOBS_VERSION;
  /** Empty means no link option on the website. */
  linkAddons: LinkAddonDeclaration[];
  /** Only on quit, so the site shows the computer offline at once instead of after 75 s. */
  leaving?: true;
}

/** A job the website gives this computer: find the song behind a link, or get the music of the found song the player picked. */
export type LinkJob =
  | { id: string; kind: 'find'; addonId: string; link: string; expiresAt: string | null }
  /** findId and ref name the found song the player picked; songId is the site's song, the key of its source record. */
  | { id: string; kind: 'music'; addonId: string; findId: string; ref: string; songId: string; expiresAt: string | null }
  /**
   * "Into my game": a song already in the player's library list, to install now instead of at the next background sync.
   * songId is its librarySongId; addonId is the link addon whose sites take its video link.
   */
  | { id: string; kind: 'install'; addonId: string; songId: string; expiresAt: string | null }
  /**
   * Is this video's music the song? songId is its librarySongId; song its facts as the library list gives them (it is often
   * not in the player's library); videoId the video to ask the addon about, and videoUrl its web address when the site
   * sends one. Nothing is installed or uploaded for it.
   */
  | { id: string; kind: 'verify'; addonId: string; songId: string; videoId: string; videoUrl: string | null; song: VerifySongFacts; expiresAt: string | null };

/** The facts of a verify job's song that the addon is asked with, as the library list gives them. */
export interface VerifySongFacts {
  librarySongId: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  /** 0 when the site sent none, as for a library song. */
  lengthSeconds: number;
}

export type FindLinkJob = Extract<LinkJob, { kind: 'find' }>;
export type MusicLinkJob = Extract<LinkJob, { kind: 'music' }>;
export type InstallLinkJob = Extract<LinkJob, { kind: 'install' }>;
export type VerifyLinkJob = Extract<LinkJob, { kind: 'verify' }>;

/** GET /api/sync/link-jobs/:id. Sync uploads only while it is open. */
export type LinkJobState = 'open' | 'cancelled' | 'expired';

/** A found song's video: the site links it, and the game gets it as a file later, when Sync installs the song. */
export interface LinkVideoFacts {
  videoId: string;
  title: string;
  channel: string;
  lengthSec: number | null;
}

export interface LinkFindResult {
  /** The music job names the picked song by this. */
  ref: string;
  title: string;
  artist: string;
  /** The addon's site the link is on. */
  source: string;
  /** Whole seconds; null when the addon didn't say, and the site then checks the length when the audio arrives. */
  lengthSec: number | null;
  /** null when the addon can't give the video. */
  video: LinkVideoFacts | null;
}

/** POST /api/sync/link-jobs/:id/answer. */
export type LinkJobAnswer =
  | { status: 'found'; results: LinkFindResult[] }
  /** reason: the addon's own sentence, when it gave one. */
  | { status: 'notfound'; reason?: string }
  /** The addon is no longer on. */
  | { status: 'gone' }
  /**
   * Not an answer yet: the addon is still getting the song (it answers 202), so the site keeps the find open. Sync sends
   * it every 5 s while that lasts; a 410 means the player stopped the find, and Sync stops asking the addon.
   */
  | { status: 'working' }
  /** Sent instead of the audio, or for an install that didn't reach the game, with why. */
  | { status: 'failed'; reason: string }
  /** An install job's song is in the game: its steps and its music, and its video when the addon gave one. */
  | { status: 'installed' }
  /** A verify job's video has the song's music: its length, and how much later its music starts (negative: earlier). */
  | { status: 'matched'; lengthSec: number; offsetSec: number }
  /** The music the addon got isn't the song (a verify job, or an install job whose addon file is another version). */
  | { status: 'different'; reason: string };

/** What the site did with an answer or an upload: took it, or the job had already ended (410). */
export type LinkJobDelivery = 'delivered' | 'late';

/** A link song's audio, read by the platform by its sourceId. The only file that ever goes to the site. */
export interface LinkJobAudio {
  sourceId: string;
  contentType: LinkAudioContentType;
}

/** The site's side of link jobs, as Sync uses it. DancedanceClient implements it with the device token. */
export interface LinkJobsApi {
  reportPresence(presence: SyncPresence): Promise<void>;
  /** Waits on the site up to LINK_JOB_WAIT_MILLISECONDS; null when no job came. */
  fetchNextLinkJob(): Promise<LinkJob | null>;
  fetchLinkJobState(jobId: string): Promise<LinkJobState>;
  answerLinkJob(options: { jobId: string; answer: LinkJobAnswer }): Promise<LinkJobDelivery>;
  uploadLinkJobAudio(options: { jobId: string; audio: LinkJobAudio }): Promise<LinkJobDelivery>;
}

/** The link addons that are on, in the order the player added them: addons that bring new songs from a link field. */
export function getLinkAddons(addons: readonly InstalledAddon[]): LinkAddon[] {
  return addons.flatMap((addon) => {
    if (!addon.isEnabled || !isAddonProviding({ manifest: addon.manifest, ability: 'song-source' })) return [];
    const linkInput = addon.manifest.inputs.find((input): input is LinkInput => input.kind === 'link');
    return linkInput ? [{ addon, linkInput }] : [];
  });
}

/** The link addon a job names; null when it is off, removed, or has no link field any more. */
export function findLinkAddon({ addons, addonId }: { addons: readonly InstalledAddon[]; addonId: string }): LinkAddon | null {
  return getLinkAddons(addons).find((linkAddon) => linkAddon.addon.manifest.id === addonId) ?? null;
}

/** Each link addon's first link field, as the website draws it; the website relays links to that field only. */
export function getLinkAddonDeclarations(addons: readonly InstalledAddon[]): LinkAddonDeclaration[] {
  return getLinkAddons(addons).map(({ addon, linkInput }) => ({ id: addon.manifest.id, name: addon.manifest.name, label: linkInput.label, placeholder: linkInput.placeholder ?? '', sites: [...linkInput.sites] }));
}

export function buildSyncPresence({ computerName, appVersion, addons, isLeaving }: { computerName: string; appVersion: string; addons: readonly InstalledAddon[]; isLeaving: boolean }): SyncPresence {
  const presence: SyncPresence = { computerName, appVersion, linkJobs: LINK_JOBS_VERSION, installJobs: INSTALL_JOBS_VERSION, verifyJobs: VERIFY_JOBS_VERSION, linkAddons: getLinkAddonDeclarations(addons) };
  return isLeaving ? { ...presence, leaving: true } : presence;
}

/** A job of a kind this Sync doesn't know, or one that is broken, is null: Sync leaves it, and the site times it out. */
export function parseLinkJobOrNull(value: unknown): LinkJob | null {
  if (!isRecord(value)) return null;
  const id = getJobIdOrNull(value.id);
  const addonId = getJobIdOrNull(value.addonId);
  if (id === null || addonId === null) return null;
  const expiresAt = typeof value.expiresAt === 'string' ? value.expiresAt : null;
  if (value.kind === 'find') return typeof value.link === 'string' ? { id, kind: 'find', addonId, link: value.link, expiresAt } : null;
  if (value.kind === 'install') return parseInstallJobOrNull({ value, id, addonId, expiresAt });
  if (value.kind === 'verify') return parseVerifyJobOrNull({ value, id, addonId, expiresAt });
  if (value.kind !== 'music') return null;
  const findId = getJobIdOrNull(value.findId);
  const ref = getJobIdOrNull(value.ref);
  const songId = getJobIdOrNull(value.songId);
  if (findId === null || ref === null || songId === null) return null;
  return { id, kind: 'music', addonId, findId, ref, songId, expiresAt };
}

function parseInstallJobOrNull({ value, id, addonId, expiresAt }: { value: Record<string, unknown>; id: string; addonId: string; expiresAt: string | null }): InstallLinkJob | null {
  const songId = getJobIdOrNull(value.songId);
  return songId === null ? null : { id, kind: 'install', addonId, songId, expiresAt };
}

function parseVerifyJobOrNull({ value, id, addonId, expiresAt }: { value: Record<string, unknown>; id: string; addonId: string; expiresAt: string | null }): VerifyLinkJob | null {
  const songId = getJobIdOrNull(value.songId);
  const videoId = getJobIdOrNull(value.videoId);
  const song = parseVerifySongFactsOrNull(value.song);
  if (songId === null || videoId === null || song === null) return null;
  const videoUrl = typeof value.videoUrl === 'string' ? value.videoUrl : null;
  return { id, kind: 'verify', addonId, songId, videoId, videoUrl, song: { ...song, librarySongId: songId }, expiresAt };
}

/** A song without a title and an artist can't be asked about; its id is the job's songId. */
function parseVerifySongFactsOrNull(value: unknown): Omit<VerifySongFacts, 'librarySongId'> | null {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.artist !== 'string' || value.title.trim() === '' || value.artist.trim() === '') return null;
  return {
    title: value.title,
    artist: value.artist,
    album: typeof value.album === 'string' ? value.album : null,
    genre: typeof value.genre === 'string' ? value.genre : null,
    lengthSeconds: typeof value.lengthSeconds === 'number' && Number.isFinite(value.lengthSeconds) && value.lengthSeconds > 0 ? value.lengthSeconds : 0,
  };
}

/** Anything but open or cancelled means the job ended, so nothing is uploaded for it. */
export function parseLinkJobState(value: unknown): LinkJobState {
  const status = isRecord(value) ? value.status : undefined;
  return status === 'open' || status === 'cancelled' ? status : 'expired';
}

export function isLinkJobExpired({ job, nowMilliseconds }: { job: Pick<LinkJob, 'expiresAt'>; nowMilliseconds: number }): boolean {
  const expiresAtMilliseconds = job.expiresAt === null ? Number.NaN : Date.parse(job.expiresAt);
  return Number.isFinite(expiresAtMilliseconds) && expiresAtMilliseconds <= nowMilliseconds;
}

/**
 * The found songs as the site shows them, best first, at most 10, each with the ref its music job will name. The link
 * must be the one Sync checked against the sites.
 */
export function buildLinkFindResults<Choice extends Pick<SongSourceChoice, 'song' | 'videoLink'>>({ choices, link, sites }: { choices: readonly Choice[]; link: string; sites: readonly string[] }): { choice: Choice; result: LinkFindResult }[] {
  const source = getLinkSourceSite({ link, sites });
  return choices.slice(0, MAX_FIND_RESULTS).map((choice, index) => {
    const { song } = choice;
    const lengthSec = song.lengthSeconds === null ? null : Math.round(song.lengthSeconds);
    return { choice, result: { ref: `r${String(index + 1)}`, title: song.title, artist: song.artist, source, lengthSec, video: buildVideoFactsOrNull({ choice, lengthSec }) } };
  });
}

/** The addon's site a link is on: clips.example for https://www.clips.example/…, the most specific one when several match. */
export function getLinkSourceSite({ link, sites }: { link: string; sites: readonly string[] }): string {
  const hostName = parseUrlOrNull(link)?.hostname ?? '';
  const matchingSites = sites.filter((site) => isHostOnSites({ hostName, sites: [site] }));
  const mostSpecificSite = matchingSites.reduce<string | null>((best, site) => (best === null || site.length > best.length ? site : best), null);
  return mostSpecificSite ?? hostName;
}

/** notfound, with the addon's own sentence when it gave one: plain text, at most 140 characters. */
export function buildNotFoundAnswer(addonError: string | null): LinkJobAnswer {
  const reason = getPlainReasonOrNull(addonError);
  return reason === null ? { status: 'notfound' } : { status: 'notfound', reason };
}

/**
 * The video whenever the addon gives its id: the site links the id, and the game gets the file later through
 * video-links when the song is installed. An addon may answer before the video file is downloaded, so its file is not
 * required here. The song-source answer has no facts of its own for the video, which comes from the same upload as the
 * music, so its title, channel and length are the song's.
 */
function buildVideoFactsOrNull({ choice, lengthSec }: { choice: Pick<SongSourceChoice, 'song' | 'videoLink'>; lengthSec: number | null }): LinkVideoFacts | null {
  const videoId = choice.song.videoId;
  if (videoId === null) return null;
  return { videoId, title: choice.song.title, channel: choice.song.artist, lengthSec };
}

/** A reason for the site to show: plain text, at most 140 characters; null when there is none. */
export function getPlainReasonOrNull(text: string | null): string | null {
  const plainText = (text ?? '').replace(HIDDEN_CHARACTERS_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return plainText === '' ? null : Array.from(plainText).slice(0, MAX_REASON_LENGTH).join('').trim();
}

/** Ids name addresses, folders and log lines, so they are short and have no control characters. */
function getJobIdOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || value.length > MAX_JOB_ID_LENGTH || /\p{Cc}/u.test(value)) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
