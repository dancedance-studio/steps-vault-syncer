import type { InstalledSong } from '../ownership/installed-songs';
import type { SyncOutcome } from '../session/run-sync';
import type { SongsFolder } from '../songs-folder/songs-folder';
import { getPlainReasonOrNull } from './link-job-protocol';

const NOT_IN_LIBRARY_REASON = 'Sync didn’t find this song in your library list. Try again in a minute.';
const NO_MUSIC_REASON = 'Sync couldn’t find this song’s music in your music folders or through your addons.';
const STILL_GETTING_MUSIC_REASON = 'Your link addon is still getting the music. Try again in a few minutes.';
const DIFFERENT_EDIT_REASON = 'The music Sync found is a different version of this song, so the steps wouldn’t line up.';
const NOT_WRITTEN_REASON = 'Sync couldn’t write the song into your game folder. Try again.';

/** Where a library song stands after a sync, for an install job from the website ("Into my game"). */
export type SongInstallCheck =
  /** Its steps and its music are in its folder in the game, and its video when its source gave one. */
  | { kind: 'installed' }
  /** An addon is still getting the music, or isn't answering yet: another sync may bring it. */
  | { kind: 'waiting-for-addon'; reason: string }
  /** reason: why not, in Sync's own words, plain and at most 140 characters. */
  | { kind: 'failed'; reason: string };

/**
 * Checks the game folder itself, not only Sync's record: the song counts as in the game only when the music file (and
 * the video the record names) is really in its folder.
 */
export async function checkSongInstall({ songsFolder, outcome, vaultSongId }: { songsFolder: SongsFolder; outcome: SyncOutcome; vaultSongId: string }): Promise<SongInstallCheck> {
  const installedSong = outcome.record.installedSongs.find((song) => song.vaultSongId === vaultSongId);
  if (installedSong && (await hasSongFiles({ songsFolder, installedSong }))) return { kind: 'installed' };
  const songPlan = outcome.finalPlan.songPlans.find((plan) => plan.vaultSongId === vaultSongId);
  if (!songPlan) return buildFailedCheck(NOT_IN_LIBRARY_REASON);
  const addonMessage = outcome.audioResultsBySongId.get(vaultSongId)?.addonMessages[0] ?? null;
  if (songPlan.status === 'needs-audio' && songPlan.isWaitingForAddon) return { kind: 'waiting-for-addon', reason: getPlainReasonOrNull(addonMessage) ?? STILL_GETTING_MUSIC_REASON };
  if (songPlan.status === 'needs-audio') return buildFailedCheck(addonMessage ?? NO_MUSIC_REASON);
  if (songPlan.status === 'different-edit') return buildFailedCheck(DIFFERENT_EDIT_REASON);
  const writeFailure = outcome.events.find((event) => event.vaultSongId === vaultSongId && event.kind === 'failed' && event.partyListId === undefined);
  return buildFailedCheck(writeFailure?.message ?? NOT_WRITTEN_REASON);
}

async function hasSongFiles({ songsFolder, installedSong }: { songsFolder: SongsFolder; installedSong: InstalledSong }): Promise<boolean> {
  const fileNames = new Set((await songsFolder.listEntries(installedSong.folderPath)).filter((entry) => !entry.isFolder).map((entry) => entry.name));
  const videoFileName = installedSong.music.videoFileName ?? null;
  return fileNames.has(installedSong.music.fileName) && (videoFileName === null || fileNames.has(videoFileName));
}

function buildFailedCheck(reason: string): SongInstallCheck {
  return { kind: 'failed', reason: getPlainReasonOrNull(reason) ?? NOT_WRITTEN_REASON };
}
