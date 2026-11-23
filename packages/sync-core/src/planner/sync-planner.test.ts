import { describe, expect, it } from 'vitest';
import type { FolderLayout } from '../layout/folder-layout';
import { getPlayerGroupNames } from '../layout/player-groups';
import { getChartHash } from '../ownership/chart-hash';
import { checkInstalledSongs } from '../ownership/installed-song-check';
import { buildEmptyInstalledSongsRecord, findInstalledSong, withInstalledSong, withOwnedGroup, withoutInstalledSong, type InstalledSongsRecord } from '../ownership/installed-songs';
import { buildSongFolderMarkerText, SONG_FOLDER_MARKER_FILE_NAME } from '../ownership/song-folder-marker';
import { MemorySongsFolder } from '../songs-folder/memory-songs-folder';
import type { SongsPath } from '../songs-folder/songs-path';
import { buildSyncPlan, type SyncPlanInput } from './sync-planner';
import type { AudioMatch, PlayerChoices, SyncAction, SyncPlan, LibrarySong } from './sync-plan-types';

const CHEAP_THRILLS: LibrarySong = { librarySongId: 'a', title: 'Cheap Thrills', artist: 'Sia', genre: 'Pop', chartVersion: 'v1' };
const WATCH_ME: LibrarySong = { librarySongId: 'b', title: 'Watch Me', artist: 'Silentó', genre: 'Hip-Hop', chartVersion: 'v1' };
const MATCHED: AudioMatch = { kind: 'matched', sourceId: 'music-folder:cheap-thrills.mp3', shiftSeconds: 0.18 };
const NO_CHOICES: PlayerChoices = { replaceEditedSongIds: new Set(), removeFromGameSongIds: new Set(), updateSongIds: new Set() };

/** A game folder and the record, as a real sync would leave them; `carryOut` is a pretend executor for the plan. */
class TestGame {
  readonly songsFolder = new MemorySongsFolder();
  record: InstalledSongsRecord = buildEmptyInstalledSongsRecord();
  private installCount = 0;

  async plan(overrides: Partial<SyncPlanInput> & { librarySongs: LibrarySong[]; layout?: FolderLayout }): Promise<SyncPlan> {
    return buildSyncPlan({
      record: this.record,
      checks: await checkInstalledSongs({ songsFolder: this.songsFolder, record: this.record }),
      audioMatchesBySongId: new Map(overrides.librarySongs.map((song) => [song.librarySongId, MATCHED])),
      layout: 'one-group',
      playerGroupNames: await getPlayerGroupNames({ songsFolder: this.songsFolder, record: this.record }),
      choices: NO_CHOICES,
      shouldUpdateAutomatically: true,
      ...overrides,
    });
  }

  async carryOut(plan: SyncPlan): Promise<void> {
    for (const action of [...plan.forgetActions, ...plan.songPlans.flatMap((songPlan) => songPlan.actions)]) await this.carryOutAction(action);
  }

  async editChart(librarySongId: string): Promise<void> {
    const folderPath = this.getFolderPath(librarySongId);
    await this.songsFolder.writeText({ path: [...folderPath, 'song.ssc'], text: 'the player changed the steps' });
  }

  getFolderPath(librarySongId: string): SongsPath {
    const installedSong = findInstalledSong({ record: this.record, librarySongId });
    if (!installedSong) throw new Error(`${librarySongId} is not installed`);
    return installedSong.folderPath;
  }

  private async carryOutAction(action: SyncAction): Promise<void> {
    if (action.kind === 'add') await this.writeSong({ librarySongId: action.librarySongId, folderPath: action.to, chartVersion: action.chartVersion });
    if (action.kind === 'update') await this.writeSong({ librarySongId: action.librarySongId, folderPath: action.at, chartVersion: action.chartVersion });
    if (action.kind === 'move') await this.moveSong(action);
    if (action.kind === 'remove') await this.songsFolder.removeFolder(action.at);
    if (action.kind === 'remove' || action.kind === 'forget') this.record = withoutInstalledSong({ record: this.record, librarySongId: action.librarySongId });
  }

  private async writeSong({ librarySongId, folderPath, chartVersion }: { librarySongId: string; folderPath: SongsPath; chartVersion: string }): Promise<void> {
    this.installCount += 1;
    const chartText = `#VERSION:${chartVersion};`;
    const installedSong = { librarySongId, chartVersion, folderPath, installId: `install-${this.installCount}`, chartHashesByFileName: { 'song.ssc': getChartHash(chartText) }, music: { fileName: 'song.ogg', shiftSeconds: 0.18 }, installedAt: '2026-10-24T10:00:00Z' };
    await this.songsFolder.writeText({ path: [...folderPath, 'song.ssc'], text: chartText });
    await this.songsFolder.writeText({ path: [...folderPath, SONG_FOLDER_MARKER_FILE_NAME], text: buildSongFolderMarkerText(installedSong) });
    this.record = withOwnedGroup({ record: withInstalledSong({ record: this.record, installedSong }), groupName: folderPath[0] ?? '' });
  }

  private async moveSong(action: Extract<SyncAction, { kind: 'move' }>): Promise<void> {
    await this.songsFolder.rename({ from: action.from, to: action.to });
    const installedSong = findInstalledSong({ record: this.record, librarySongId: action.librarySongId });
    if (!installedSong) return;
    this.record = withOwnedGroup({ record: withInstalledSong({ record: this.record, installedSong: { ...installedSong, folderPath: action.to } }), groupName: action.to[0] ?? '' });
  }
}

function getSongPlan({ plan, librarySongId }: { plan: SyncPlan; librarySongId: string }) {
  return plan.songPlans.find((songPlan) => songPlan.librarySongId === librarySongId);
}

async function buildSyncedGame(librarySongs: LibrarySong[]): Promise<TestGame> {
  const game = new TestGame();
  await game.carryOut(await game.plan({ librarySongs }));
  return game;
}

describe('a song not in the game yet', () => {
  it('is added when its audio matched', async () => {
    const plan = await new TestGame().plan({ librarySongs: [CHEAP_THRILLS] });
    expect(getSongPlan({ plan, librarySongId: 'a' })).toMatchObject({ status: 'syncing', actions: [{ kind: 'add', to: ['dancedance.studio', 'Cheap Thrills'], audio: { shiftSeconds: 0.18 } }] });
  });

  it('needs audio when none was found, and says when it waits for an addon', async () => {
    const plan = await new TestGame().plan({ librarySongs: [CHEAP_THRILLS], audioMatchesBySongId: new Map([['a', { kind: 'not-found', isWaitingForAddon: true }]]) });
    expect(getSongPlan({ plan, librarySongId: 'a' })).toMatchObject({ status: 'needs-audio', actions: [], isWaitingForAddon: true });
  });

  it('is a different edit when the only audio found is another version', async () => {
    const plan = await new TestGame().plan({ librarySongs: [CHEAP_THRILLS], audioMatchesBySongId: new Map([['a', { kind: 'different-edit', sourceId: 'radio-edit.mp3' }]]) });
    expect(getSongPlan({ plan, librarySongId: 'a' })).toMatchObject({ status: 'different-edit', actions: [] });
  });
});

describe('an installed song', () => {
  it('is synced when nothing changed', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    expect(getSongPlan({ plan: await game.plan({ librarySongs: [CHEAP_THRILLS] }), librarySongId: 'a' })).toMatchObject({ status: 'synced', actions: [] });
  });

  it('updates by itself when its steps changed, or waits for the player when automatic updates are off', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    const newSteps = { ...CHEAP_THRILLS, chartVersion: 'v2' };
    expect(getSongPlan({ plan: await game.plan({ librarySongs: [newSteps] }), librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'update', chartVersion: 'v2' }]);
    expect(getSongPlan({ plan: await game.plan({ librarySongs: [newSteps], shouldUpdateAutomatically: false }), librarySongId: 'a' })).toMatchObject({ status: 'update-available', actions: [] });
    const chosen = await game.plan({ librarySongs: [newSteps], shouldUpdateAutomatically: false, choices: { ...NO_CHOICES, updateSongIds: new Set(['a']) } });
    expect(getSongPlan({ plan: chosen, librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'update' }]);
  });

  it('keeps the player edits, even when new steps arrive, until they choose to replace them', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    await game.editChart('a');
    const newSteps = { ...CHEAP_THRILLS, chartVersion: 'v2' };
    expect(getSongPlan({ plan: await game.plan({ librarySongs: [newSteps] }), librarySongId: 'a' })).toMatchObject({ status: 'you-edited-this', actions: [] });
    const replacing = await game.plan({ librarySongs: [CHEAP_THRILLS], choices: { ...NO_CHOICES, replaceEditedSongIds: new Set(['a']) } });
    expect(getSongPlan({ plan: replacing, librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'update', chartVersion: 'v1' }]);
  });

  it('stays in the game when it leaves the library, until the player chooses to remove it', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    expect(getSongPlan({ plan: await game.plan({ librarySongs: [] }), librarySongId: 'a' })).toMatchObject({ status: 'removed-from-library', actions: [] });
    const removing = await game.plan({ librarySongs: [], choices: { ...NO_CHOICES, removeFromGameSongIds: new Set(['a']) } });
    expect(getSongPlan({ plan: removing, librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'remove', at: ['dancedance.studio', 'Cheap Thrills'] }]);
  });

  it('is added again when the player deleted its folder', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    await game.songsFolder.removeFolder(game.getFolderPath('a'));
    expect(getSongPlan({ plan: await game.plan({ librarySongs: [CHEAP_THRILLS] }), librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'forget' }, { kind: 'add', to: ['dancedance.studio', 'Cheap Thrills'] }]);
  });

  it('never touches a folder the player replaced, and installs again next to it', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    const folderPath = game.getFolderPath('a');
    await game.songsFolder.removeFolder(folderPath);
    await game.songsFolder.writeText({ path: [...folderPath, 'their.ssc'], text: 'the player own song' });
    const plan = await game.plan({ librarySongs: [CHEAP_THRILLS] });
    expect(getSongPlan({ plan, librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'forget' }, { kind: 'add', to: ['dancedance.studio', 'Cheap Thrills (Sia)'] }]);
    await game.carryOut(plan);
    expect(await game.songsFolder.readText([...folderPath, 'their.ssc'])).toBe('the player own song');
  });

  it('is forgotten without a row when it left the library and its folder is gone', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    await game.songsFolder.removeFolder(game.getFolderPath('a'));
    const plan = await game.plan({ librarySongs: [] });
    expect(plan.songPlans).toEqual([]);
    expect(plan.forgetActions).toEqual([{ kind: 'forget', librarySongId: 'a' }]);
  });

  it('moves with a layout change; an edited song moves too but never updates', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS, WATCH_ME]);
    await game.editChart('b');
    const plan = await game.plan({ librarySongs: [CHEAP_THRILLS, { ...WATCH_ME, chartVersion: 'v2' }], layout: 'by-genre' });
    expect(getSongPlan({ plan, librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'move', to: ['Pop', 'Cheap Thrills'] }]);
    expect(getSongPlan({ plan, librarySongId: 'b' })?.actions).toMatchObject([{ kind: 'move', to: ['Hip-Hop', 'Watch Me'] }]);
  });

  it('moves a song to its new group on the next sync after the player regroups it on the site', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS]);
    const warmUpOptions = { librarySongs: [{ ...CHEAP_THRILLS, groupFolderName: 'Warm-up' }], layout: 'my-groups' as const };
    await game.carryOut(await game.plan(warmUpOptions));
    expect(game.getFolderPath('a')).toEqual(['dancedance.studio - Warm-up', 'Cheap Thrills']);
    const plan = await game.plan({ librarySongs: [{ ...CHEAP_THRILLS, groupFolderName: null }], layout: 'my-groups' });
    expect(getSongPlan({ plan, librarySongId: 'a' })?.actions).toMatchObject([{ kind: 'move', from: ['dancedance.studio - Warm-up', 'Cheap Thrills'], to: ['dancedance.studio - Ungrouped', 'Cheap Thrills'] }]);
  });
});

describe('carrying out a plan', () => {
  it('leaves nothing to do the second time', async () => {
    const game = await buildSyncedGame([CHEAP_THRILLS, WATCH_ME]);
    const librarySongs = [{ ...CHEAP_THRILLS, chartVersion: 'v2' }, { librarySongId: 'c', title: 'Sorry', artist: 'Justin Bieber', genre: 'Pop', chartVersion: 'v1' }];
    const options = { librarySongs, layout: 'by-artist' as const, choices: { ...NO_CHOICES, removeFromGameSongIds: new Set(['b']) } };
    await game.carryOut(await game.plan(options));
    const secondPlan = await game.plan(options);
    expect(secondPlan.songPlans.flatMap((songPlan) => songPlan.actions)).toEqual([]);
    expect(secondPlan.forgetActions).toEqual([]);
    expect(secondPlan.songPlans.map((songPlan) => songPlan.status)).toEqual(['synced', 'synced']);
  });
});

describe('party list folders', () => {
  const partyList = { partyListId: 'party_maya', name: 'Maya bday', gameFolderName: 'Party - Maya bday', songs: [CHEAP_THRILLS, WATCH_ME] };

  it('plans copies in the list’s own folder, whatever the layout, besides the layout’s own folders', async () => {
    for (const layout of ['one-group', 'by-genre', 'by-artist', 'my-groups'] as const) {
      const plan = await new TestGame().plan({ librarySongs: [CHEAP_THRILLS], partyLists: [partyList], layout, audioMatchesBySongId: new Map([['a', MATCHED], ['b', MATCHED]]) });
      expect(plan.songPlans.map((songPlan) => songPlan.librarySongId)).toEqual(['a']);
      expect(plan.partyFolderPlans?.map((folderPlan) => ({ ...folderPlan, songPlans: folderPlan.songPlans.map((songPlan) => songPlan.actions) }))).toMatchObject([{
        partyListId: 'party_maya',
        groupName: 'Party - Maya bday',
        isSynced: true,
        songPlans: [[{ kind: 'add', librarySongId: 'a', to: ['Party - Maya bday', 'Cheap Thrills'] }], [{ kind: 'add', librarySongId: 'b', to: ['Party - Maya bday', 'Watch Me'] }]],
      }]);
    }
  });

  it('plans no party folders when the site didn’t say which lists the player syncs', async () => {
    const plan = await new TestGame().plan({ librarySongs: [CHEAP_THRILLS], partyLists: null });
    expect(plan.partyFolderPlans).toBeUndefined();
  });
});
