import { checkSongInstall, getPlainReasonOrNull, type SongInstallCheck, type SongsFolder, type SyncOutcome } from '@stepsvault/sync-core';

/** Between two syncs while an addon is still getting the music (it answered 202). */
const ADDON_RETRY_MILLISECONDS = 15_000;
/** The site ends an install job 10 minutes after it made it; Sync answers well before that. */
const MAX_INSTALL_MILLISECONDS = 8 * 60_000;
const NO_GAME_REASON = 'Sync has no game folder yet. Open dancedance.studio Sync and choose your game.';
const GAME_RUNNING_REASON = 'StepMania is running. Close it so Sync can add the song, then try again.';
const SYNC_STOPPED_REASON = 'Sync couldn’t finish a sync. Try again in a minute.';

/** How an install job from the website ends: the song is in the game, or why not ("different": the addon's music isn't it). */
export type SiteSongInstallResult = Exclude<SongInstallCheck, { kind: 'waiting-for-addon' }>;

/** What an install needs from the app: its syncs, its game folder and the time. */
export interface SiteSongInstallPorts {
  hasGame(): boolean;
  isGameRunning(): Promise<boolean>;
  /** Waits for a sync that is running: that sync's outcome, or null when none was running. */
  waitForRunningSync(): Promise<SyncOutcome | null>;
  /** Runs a sync now, after any sync already running: its outcome, or null when it couldn't run or stopped. */
  syncNow(): Promise<SyncOutcome | null>;
  /** Why the last sync stopped, as a sentence for the player; null when it didn't. */
  getProblem(): string | null;
  getSongsFolder(): SongsFolder;
  /** True for a file Sync downloaded from an addon, so another version of the song in it is the addon's ("different"). */
  isAddonFile: (sourceId: string) => boolean;
  getNowMilliseconds(): number;
  waitMilliseconds(milliseconds: number): Promise<void>;
}

/**
 * "Into my game": the song is already in the player's library list, so a normal sync installs it, getting its music
 * and video through the player's addons. A sync that is running counts. While an addon is still getting the music,
 * Sync syncs again until the music comes, for up to 8 minutes. It answers installed only once the music is really in
 * the song's folder.
 */
export async function installSongForSite({ ports, vaultSongId }: { ports: SiteSongInstallPorts; vaultSongId: string }): Promise<SiteSongInstallResult> {
  if (!ports.hasGame()) return { kind: 'failed', reason: NO_GAME_REASON };
  const untilMilliseconds = ports.getNowMilliseconds() + MAX_INSTALL_MILLISECONDS;
  const runningOutcome = await ports.waitForRunningSync();
  if (runningOutcome && (await checkSongInstall({ songsFolder: ports.getSongsFolder(), outcome: runningOutcome, vaultSongId, isAddonFile: ports.isAddonFile })).kind === 'installed') return { kind: 'installed' };
  for (;;) {
    if (await ports.isGameRunning()) return { kind: 'failed', reason: GAME_RUNNING_REASON };
    const outcome = await ports.syncNow();
    if (!outcome) return { kind: 'failed', reason: getPlainReasonOrNull(ports.getProblem()) ?? SYNC_STOPPED_REASON };
    const check = await checkSongInstall({ songsFolder: ports.getSongsFolder(), outcome, vaultSongId, isAddonFile: ports.isAddonFile });
    if (check.kind !== 'waiting-for-addon') return check;
    if (ports.getNowMilliseconds() + ADDON_RETRY_MILLISECONDS > untilMilliseconds) return { kind: 'failed', reason: check.reason };
    await ports.waitMilliseconds(ADDON_RETRY_MILLISECONDS);
  }
}
