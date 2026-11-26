import {
  buildNameFindSongFacts,
  fetchAudioLinks,
  getNameFindAddons,
  getPlainReasonOrNull,
  type AddonSongFacts,
  type AudioLink,
  type HttpClient,
  type InstalledAddon,
  type NameFindSongFacts,
} from '@dancedance/sync-core';
import type { AddonWait } from './site-video-checks';

/** What a name find needs from the app: the addons, their network, and the folder where Sync keeps addons' files. */
export interface SiteNameFindPorts {
  getAddons(): readonly InstalledAddon[];
  /** The addons' network: it starts an addon on this computer that has a start command. */
  addonHttpClient: HttpClient;
  /** Into the folder where Sync already keeps addons' files, as for a verify job. A sourceId. */
  downloadAddonFile(options: { url: string; fileName: string | null; addonName: string }): Promise<string>;
  /** The music file's length in seconds, as Sync decodes it. */
  measureLength(sourceId: string): Promise<number>;
}

/** The music an addon gave for a name find, kept on this computer until the player says "Yes, use it". */
export interface NameFoundMusic {
  addonId: string;
  addonName: string;
  sourceId: string;
  lengthSeconds: number;
}

export type NameFindOutcome =
  | { kind: 'found'; music: NameFoundMusic }
  /** An addon answered, but none gave a music file Sync could use. reason: the first addon's own sentence. */
  | { kind: 'not-found'; reason: string | null }
  /** No addon answered at all, or every one was still working when the time ran out. */
  | { kind: 'no-answer' }
  /** No addon that is on provides audio-links (or the one asked for is off). */
  | { kind: 'no-addon' };

type AddonLinksOrNull = { links: AudioLink[]; addonError: string | null } | null;

/**
 * A song picked on the website, found by its facts alone: each audio-links addon that is on is asked in the player's
 * order with the normal /audio-links request (no genre, no video), and the first one whose answer has a music file
 * Sync can download and read wins. Video links are ignored: the website keeps the song's own video. With addonId,
 * only that addon is asked: a music job whose kept file is gone asks the addon that found it again.
 */
export async function findMusicByName({ ports, song, wait, addonId }: { ports: SiteNameFindPorts; song: NameFindSongFacts; wait: AddonWait; addonId: string | null }): Promise<NameFindOutcome> {
  const addons = getNameFindAddons(ports.getAddons()).filter((addon) => addonId === null || addon.manifest.id === addonId);
  if (addons.length === 0) return { kind: 'no-addon' };
  const facts = buildNameFindSongFacts(song);
  let hasAnyAddonAnswered = false;
  let firstAddonError: string | null = null;
  for (const addon of addons) {
    if (wait.shouldStop()) break;
    const answer = await fetchLinksWhileAddonWorks({ ports, addon, facts, wait });
    if (answer === null) continue;
    hasAnyAddonAnswered = true;
    const music = await getUsableMusicOrNull({ ports, addon, links: answer.links });
    if (music) return { kind: 'found', music };
    firstAddonError ??= getPlainReasonOrNull(answer.addonError);
  }
  return hasAnyAddonAnswered ? { kind: 'not-found', reason: firstAddonError } : { kind: 'no-answer' };
}

/** Asks again as often as the addon says while it is still working; null when it isn't answering or time is up. */
async function fetchLinksWhileAddonWorks({ ports, addon, facts, wait }: { ports: SiteNameFindPorts; addon: InstalledAddon; facts: AddonSongFacts; wait: AddonWait }): Promise<AddonLinksOrNull> {
  for (;;) {
    const answer = await fetchAudioLinks({ httpClient: ports.addonHttpClient, addon, song: facts });
    if (answer.kind === 'links') return answer;
    if (answer.kind === 'not-answering' || wait.shouldStop()) return null;
    await wait.waitSeconds(answer.retryAfterSeconds);
    if (wait.shouldStop()) return null;
  }
}

/** The first music file of the answer that downloads and can be read; a file that can't is skipped, not trusted. */
async function getUsableMusicOrNull({ ports, addon, links }: { ports: SiteNameFindPorts; addon: InstalledAddon; links: readonly AudioLink[] }): Promise<NameFoundMusic | null> {
  const { id: addonId, name: addonName } = addon.manifest;
  for (const link of links) {
    if (link.kind !== 'file-url' || link.media !== 'audio') continue;
    const sourceId = await ports.downloadAddonFile({ url: link.url, fileName: link.fileName, addonName }).catch(() => null);
    if (sourceId === null) continue;
    const lengthSeconds = await ports.measureLength(sourceId).catch(() => null);
    if (lengthSeconds !== null && Number.isFinite(lengthSeconds) && lengthSeconds > 0) return { addonId, addonName, sourceId, lengthSeconds };
  }
  return null;
}
