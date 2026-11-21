import { describe, expect, it } from 'vitest';
import type { AudioSearchResult } from '../audio-sources/audio-search';
import { buildEmptyInstalledSongsRecord, type InstalledSong } from '../ownership/installed-songs';
import type { SongPlan } from '../planner/sync-plan-types';
import type { SyncOutcome } from '../session/run-sync';
import { MemorySongsFolder } from '../songs-folder/memory-songs-folder';
import type { ActivityEvent } from '../writing/sync-executor';
import { checkSongInstall } from './song-install-check';

const NIGHT_DRIVE_FOLDER = ['dancedance.studio', 'Night Drive'];
const NIGHT_DRIVE: InstalledSong = {
  vaultSongId: 'song_42', chartVersion: 'v1', installId: 'install-1', folderPath: NIGHT_DRIVE_FOLDER, chartHashesByFileName: { 'Night Drive.ssc': 'hash' },
  music: { fileName: 'music.ogg', videoFileName: 'video.mp4', shiftSeconds: 0 }, installedAt: '2026-11-21T10:00:00.000Z',
};

function buildOutcome({ installedSongs = [], songPlans = [], audioResultsBySongId = new Map(), events = [] }: { installedSongs?: InstalledSong[]; songPlans?: SongPlan[]; audioResultsBySongId?: Map<string, AudioSearchResult>; events?: ActivityEvent[] }): SyncOutcome {
  return { vaultSongs: [], partyLists: null, finalPlan: { songPlans, forgetActions: [] }, audioResultsBySongId, events, record: { ...buildEmptyInstalledSongsRecord(), installedSongs } };
}

function buildSongPlan(overrides: Partial<SongPlan>): SongPlan {
  return { vaultSongId: 'song_42', status: 'synced', actions: [], isWaitingForAddon: false, ...overrides };
}

async function buildSongsFolder(fileNames: readonly string[]): Promise<MemorySongsFolder> {
  const songsFolder = new MemorySongsFolder();
  for (const fileName of fileNames) await songsFolder.writeBytes({ path: [...NIGHT_DRIVE_FOLDER, fileName], bytes: new Uint8Array([1]) });
  return songsFolder;
}

describe('checkSongInstall', () => {
  it('counts a song as in the game only when its music, and the video its record names, are in its folder', async () => {
    const outcome = buildOutcome({ installedSongs: [NIGHT_DRIVE], songPlans: [buildSongPlan({})] });
    expect(await checkSongInstall({ songsFolder: await buildSongsFolder(['Night Drive.ssc', 'music.ogg', 'video.mp4']), outcome, vaultSongId: 'song_42' })).toEqual({ kind: 'installed' });
    expect((await checkSongInstall({ songsFolder: await buildSongsFolder(['Night Drive.ssc', 'music.ogg']), outcome, vaultSongId: 'song_42' })).kind).toBe('failed');
    expect((await checkSongInstall({ songsFolder: await buildSongsFolder(['Night Drive.ssc', 'video.mp4']), outcome, vaultSongId: 'song_42' })).kind).toBe('failed');
    const withoutVideo = buildOutcome({ installedSongs: [{ ...NIGHT_DRIVE, music: { fileName: 'music.ogg', videoFileName: null, shiftSeconds: 0 } }] });
    expect(await checkSongInstall({ songsFolder: await buildSongsFolder(['music.ogg']), outcome: withoutVideo, vaultSongId: 'song_42' })).toEqual({ kind: 'installed' });
  });

  it('says why when the music wasn’t found, in the addon’s message or Sync’s own words', async () => {
    const songsFolder = new MemorySongsFolder();
    const noMusic = buildOutcome({ songPlans: [buildSongPlan({ status: 'needs-audio' })] });
    expect(await checkSongInstall({ songsFolder, outcome: noMusic, vaultSongId: 'song_42' })).toEqual({ kind: 'failed', reason: 'Sync couldn’t find this song’s music in your music folders or through your addons.' });
    const addonMessage = buildOutcome({ songPlans: [buildSongPlan({ status: 'needs-audio' })], audioResultsBySongId: new Map([['song_42', { match: { kind: 'not-found', isWaitingForAddon: false }, addonMessages: ['Open Audio Links: This clip is private.'], pageLinks: [] }]]) });
    expect(await checkSongInstall({ songsFolder, outcome: addonMessage, vaultSongId: 'song_42' })).toEqual({ kind: 'failed', reason: 'Open Audio Links: This clip is private.' });
  });

  it('waits while an addon is still getting the music', async () => {
    const outcome = buildOutcome({ songPlans: [buildSongPlan({ status: 'needs-audio', isWaitingForAddon: true })] });
    expect(await checkSongInstall({ songsFolder: new MemorySongsFolder(), outcome, vaultSongId: 'song_42' })).toEqual({ kind: 'waiting-for-addon', reason: 'Your link addon is still getting the music. Try again in a few minutes.' });
  });

  it('says why for another version of the song, a write that failed, and a song not in the library list', async () => {
    const songsFolder = new MemorySongsFolder();
    expect(await checkSongInstall({ songsFolder, outcome: buildOutcome({ songPlans: [buildSongPlan({ status: 'different-edit' })] }), vaultSongId: 'song_42' })).toEqual({ kind: 'failed', reason: 'The music Sync found is a different version of this song, so the steps wouldn’t line up.' });
    const failedWrite: ActivityEvent = { vaultSongId: 'song_42', kind: 'failed', at: '2026-11-21T10:00:00.000Z', folderPath: NIGHT_DRIVE_FOLDER, message: 'Windows refused to write in your Songs folder.\nCheck that your game isn’t open.' };
    expect(await checkSongInstall({ songsFolder, outcome: buildOutcome({ songPlans: [buildSongPlan({ status: 'syncing' })], events: [failedWrite] }), vaultSongId: 'song_42' })).toEqual({ kind: 'failed', reason: 'Windows refused to write in your Songs folder. Check that your game isn’t open.' });
    expect(await checkSongInstall({ songsFolder, outcome: buildOutcome({}), vaultSongId: 'song_42' })).toEqual({ kind: 'failed', reason: 'Sync didn’t find this song in your library list. Try again in a minute.' });
  });

  it('keeps a reason plain and at most 140 characters', async () => {
    const longMessage = `Open Audio Links: ${'x'.repeat(300)}`;
    const outcome = buildOutcome({ songPlans: [buildSongPlan({ status: 'needs-audio' })], audioResultsBySongId: new Map([['song_42', { match: { kind: 'not-found', isWaitingForAddon: false }, addonMessages: [longMessage], pageLinks: [] }]]) });
    const check = await checkSongInstall({ songsFolder: new MemorySongsFolder(), outcome, vaultSongId: 'song_42' });
    expect(check.kind === 'failed' ? check.reason.length : 0).toBe(140);
  });
});
