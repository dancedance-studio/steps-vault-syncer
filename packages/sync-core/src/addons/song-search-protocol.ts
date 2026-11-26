import { getRetryAfterSeconds } from '../network/retry-after';
import { isAllowedPageUrl } from '../network/service-address';
import type { AddonOptionValues } from './addon-options';
import { ADDON_PROTOCOL_VERSION, getAddonErrorOrNull, InvalidAddonAnswerError } from './addon-protocol';

/** An addon may send up to 10 versions; Sync looks at no more than that. */
const MAX_ADDON_CHOICES = 10;
/** Enough for the player to pick from on the website. */
export const MAX_SONG_SEARCH_CHOICES = 5;
const MAX_TITLE_LENGTH = 200;
const MAX_CHANNEL_LENGTH = 100;
const MAX_PAGE_URL_LENGTH = 2000;
const MIN_LENGTH_SECONDS = 1;
// No real song is longer; a bigger number is a broken answer, not a song.
const MAX_LENGTH_SECONDS = 60 * 60;
/** The shape of the website's song video ids. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
// Text that reorders or hides other text could make a title read as something it isn't.
const HIDDEN_CHARACTERS_PATTERN = /[\p{Cc}‪-‮⁦-⁩]+/gu;

/** The facts of a song picked on the website, as a song search sends them: nothing else about the song or the player. */
export interface SongSearchFacts {
  title: string;
  artist: string;
  album: string | null;
  lengthSeconds: number | null;
}

/** One version of the song an addon found, after Sync's checks. The player picks one on the website. */
export interface SongSearchChoice {
  title: string;
  /** Who uploaded it; null when the addon doesn't say. */
  channel: string | null;
  /** Whole seconds, 1 to 3600. */
  lengthSeconds: number;
  /** 11 letters, digits, - and _: the shape of the website's song video ids. */
  videoId: string;
  /** An https page where the player can watch it. */
  pageUrl: string;
  thumbnailUrl: string | null;
  /** True when the artist or their label uploaded it. */
  isOfficial: boolean;
}

export type SongSearchAnswer =
  /** At least one usable version, best first, at most 5. */
  | { kind: 'found'; choices: SongSearchChoice[] }
  /** Nothing Sync can use; addonError is the addon's own sentence, when it gave one. */
  | { kind: 'not-found'; addonError: string | null }
  /** 202: the addon is still searching; ask again after this many seconds. */
  | { kind: 'working'; retryAfterSeconds: number };

export interface SongSearchRequestBody {
  protocol: number;
  song: SongSearchFacts;
  /** Only for an addon that declares options, as for /audio-links. */
  options?: AddonOptionValues;
}

/**
 * Builds the request body from exactly the allowed facts, so nothing else can slip in. The option values must already
 * be checked against the manifest.
 */
export function buildSongSearchRequestBody({ song, optionValues }: { song: SongSearchFacts; optionValues: AddonOptionValues }): SongSearchRequestBody {
  const { title, artist, album, lengthSeconds } = song;
  const body: SongSearchRequestBody = { protocol: ADDON_PROTOCOL_VERSION, song: { title, artist, album, lengthSeconds } };
  return Object.keys(optionValues).length === 0 ? body : { ...body, options: { ...optionValues } };
}

/**
 * Throws InvalidAddonAnswerError for an answer Sync can't use: another status, or neither choices nor an error. Choices
 * that break a rule are dropped; when none is left, it is "nothing found", with the addon's sentence if it sent one.
 */
export function parseSongSearchAnswer({ status, body }: { status: number; body: unknown }): SongSearchAnswer {
  if (status === 202) return { kind: 'working', retryAfterSeconds: getRetryAfterSeconds(body) };
  if (status !== 200 || !isRecord(body)) throw new InvalidAddonAnswerError(`The addon answered with an error (${String(status)}).`);
  const addonError = getAddonErrorOrNull(body.error);
  if (!Array.isArray(body.choices) && addonError === null) throw new InvalidAddonAnswerError('The addon answered with neither choices nor a reason.');
  const choices = Array.isArray(body.choices) ? getUsableChoices(body.choices as unknown[]) : [];
  return choices.length === 0 ? { kind: 'not-found', addonError } : { kind: 'found', choices };
}

/** The first 5 usable versions among the first 10, each video once. */
function getUsableChoices(values: readonly unknown[]): SongSearchChoice[] {
  const choices: SongSearchChoice[] = [];
  for (const value of values.slice(0, MAX_ADDON_CHOICES)) {
    const choice = parseChoiceOrNull(value);
    if (choice === null || choices.some((kept) => kept.videoId === choice.videoId)) continue;
    choices.push(choice);
    if (choices.length === MAX_SONG_SEARCH_CHOICES) break;
  }
  return choices;
}

function parseChoiceOrNull(value: unknown): SongSearchChoice | null {
  if (!isRecord(value)) return null;
  const title = getPlainTextOrNull({ value: value.title, maxLength: MAX_TITLE_LENGTH });
  const channel = value.channel === null || value.channel === undefined ? null : getPlainTextOrNull({ value: value.channel, maxLength: MAX_CHANNEL_LENGTH });
  const lengthSeconds = getLengthSecondsOrNull(value.lengthSeconds);
  const videoId = isWebsiteVideoId(value.videoId) ? value.videoId : null;
  const pageUrl = getSongSearchPageUrlOrNull(value.pageUrl);
  const thumbnailUrl = value.thumbnailUrl === null || value.thumbnailUrl === undefined ? null : getSongSearchPageUrlOrNull(value.thumbnailUrl);
  const hasBrokenChannel = channel === null && value.channel !== null && value.channel !== undefined;
  const hasBrokenThumbnail = thumbnailUrl === null && value.thumbnailUrl !== null && value.thumbnailUrl !== undefined;
  if (title === null || lengthSeconds === null || videoId === null || pageUrl === null || hasBrokenChannel || hasBrokenThumbnail) return null;
  return { title, channel, lengthSeconds, videoId, pageUrl, thumbnailUrl, isOfficial: value.isOfficial === true };
}

/** Plain text on one line; null when it is empty or longer than allowed. */
function getPlainTextOrNull({ value, maxLength }: { value: unknown; maxLength: number }): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(HIDDEN_CHARACTERS_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return text === '' || Array.from(text).length > maxLength ? null : text;
}

function getLengthSecondsOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_LENGTH_SECONDS || value > MAX_LENGTH_SECONDS) return null;
  return Math.round(value);
}

/** 11 letters, digits, - and _: the shape of the website's song video ids. */
export function isWebsiteVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID_PATTERN.test(value);
}

/** An https page of at most 2000 characters; null for anything else. */
export function getSongSearchPageUrlOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_PAGE_URL_LENGTH && isAllowedPageUrl(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
