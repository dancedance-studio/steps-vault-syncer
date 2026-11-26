import {
  buildSongSearchFacts,
  buildSongSearchMusicFacts,
  fetchSongSearch,
  getPlainReasonOrNull,
  getSongSearchAddons,
  type InstalledAddon,
  type NameFindSongFacts,
  type SongSearchCallResult,
  type SongSearchChoice,
  type SongSearchFacts,
  type SongSearchVideo,
} from '@dancedance/sync-core';
import { findMusicWithAddons, type NameFindOutcome, type SiteNameFindPorts } from './site-name-finds';
import type { AddonWait } from './site-video-checks';

/** The addon whose search found the versions: the music job for one of them asks it again. */
export interface SongSearchAddon {
  addonId: string;
  addonName: string;
}

export type SongSearchOutcome =
  | { kind: 'found'; addon: SongSearchAddon; choices: SongSearchChoice[] }
  /** An addon answered, but none had a usable version. reason: the first addon's own sentence. */
  | { kind: 'not-found'; reason: string | null }
  /** No addon answered at all, or every one was still working when the time ran out. */
  | { kind: 'no-answer' }
  /** No addon that is on provides song-search with audio-links. */
  | { kind: 'no-addon' };

type SongSearchAnswerOrNull = Exclude<SongSearchCallResult, { kind: 'working' | 'not-answering' }> | null;

/**
 * A song picked on the website, searched for by its facts: each song-search addon that is on is asked in the player's
 * order, and the first one with at least one usable version wins. Nothing is downloaded.
 */
export async function searchSongWithAddons({ ports, song, wait }: { ports: Pick<SiteNameFindPorts, 'getAddons' | 'addonHttpClient'>; song: NameFindSongFacts; wait: AddonWait }): Promise<SongSearchOutcome> {
  const addons = getSongSearchAddons(ports.getAddons());
  if (addons.length === 0) return { kind: 'no-addon' };
  const facts = buildSongSearchFacts(song);
  let hasAnyAddonAnswered = false;
  let firstAddonError: string | null = null;
  for (const addon of addons) {
    if (wait.shouldStop()) break;
    const answer = await fetchSearchWhileAddonWorks({ ports, addon, facts, wait });
    if (answer === null) continue;
    hasAnyAddonAnswered = true;
    if (answer.kind === 'found') return { kind: 'found', addon: { addonId: addon.manifest.id, addonName: addon.manifest.name }, choices: answer.choices };
    firstAddonError ??= getPlainReasonOrNull(answer.addonError);
  }
  return hasAnyAddonAnswered ? { kind: 'not-found', reason: firstAddonError } : { kind: 'no-answer' };
}

/**
 * The music of the version the player chose: the normal /audio-links request with the song's facts and the version's
 * own video id and page, and the first music file Sync can download and read. With addonId, only the addon that found
 * the version is asked; without it (Sync restarted since), each song-search addon that is on, in the player's order.
 */
export function findSongSearchMusic({ ports, song, video, wait, addonId }: { ports: SiteNameFindPorts; song: NameFindSongFacts; video: SongSearchVideo; wait: AddonWait; addonId: string | null }): Promise<NameFindOutcome> {
  const addons = getSongSearchAddons(ports.getAddons()).filter((addon) => addonId === null || addon.manifest.id === addonId);
  return findMusicWithAddons({ ports, addons, facts: buildSongSearchMusicFacts({ song, video }), wait });
}

/** Asks again as often as the addon says while it is still working; null when it isn't answering or time is up. */
async function fetchSearchWhileAddonWorks({ ports, addon, facts, wait }: { ports: Pick<SiteNameFindPorts, 'addonHttpClient'>; addon: InstalledAddon; facts: SongSearchFacts; wait: AddonWait }): Promise<SongSearchAnswerOrNull> {
  for (;;) {
    const answer = await fetchSongSearch({ httpClient: ports.addonHttpClient, addon, song: facts });
    if (answer.kind === 'found' || answer.kind === 'not-found') return answer;
    if (answer.kind === 'not-answering' || wait.shouldStop()) return null;
    await wait.waitSeconds(answer.retryAfterSeconds);
    if (wait.shouldStop()) return null;
  }
}
