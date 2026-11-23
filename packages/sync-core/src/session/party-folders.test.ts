import { describe, expect, it } from 'vitest';
import type { AudioFingerprint } from '../audio-matching/audio-match';
import { scanMusicLibrary, type MusicFile } from '../audio-sources/music-library';
import type { FolderLayout } from '../layout/folder-layout';
import { getPartyFolderBaseName } from '../layout/party-folder-names';
import { buildEmptyInstalledSongsRecord, type InstalledSongsRecord } from '../ownership/installed-songs';
import { findPartyFolder, getPartyFolders } from '../ownership/party-folders';
import type { HttpClient } from '../network/http-client';
import { MemorySongsFolder } from '../songs-folder/memory-songs-folder';
import type { SongsPath } from '../songs-folder/songs-path';
import type { SyncPartyList, LibrarySongDetails } from '../dancedance-api/dancedance-api-types';
import type { SongFiles } from '../writing/song-writer';
import { runSync, type SyncPorts, type SyncSettings, type SyncLibrary } from './run-sync';

const CHEAP_THRILLS: LibrarySongDetails = { librarySongId: 'a', slug: 'cheap-thrills', title: 'Cheap Thrills', artist: 'Sia', album: null, genre: 'Pop', lengthSeconds: 224, levels: [2, 4, 6, 9, null], bpm: 90, videoId: null, chartVersion: 'v1', imageKinds: ['banner'], hasFingerprint: true };
const WATCH_ME: LibrarySongDetails = { ...CHEAP_THRILLS, librarySongId: 'b', slug: 'watch-me', title: 'Watch Me', artist: 'Silento', genre: 'Hip-Hop' };
/** In party lists only, never in the player's library. */
const LEVITATING: LibrarySongDetails = { ...CHEAP_THRILLS, librarySongId: 'd', slug: 'levitating', title: 'Levitating', artist: 'Dua Lipa' };
const MUSIC_FILES: MusicFile[] = [
  { sourceId: 'music-a', fileName: 'Sia - Cheap Thrills.mp3', folderNames: ['Music'], taggedTitle: null, taggedArtist: null },
  { sourceId: 'music-b', fileName: 'Silento - Watch Me.mp3', folderNames: ['Music'], taggedTitle: null, taggedArtist: null },
  { sourceId: 'music-d', fileName: 'Dua Lipa - Levitating.mp3', folderNames: ['Music'], taggedTitle: null, taggedArtist: null },
];
const MAYA_ID = 'party_maya';

function buildPartyList(overrides: Partial<SyncPartyList> & { songs: LibrarySongDetails[] }): SyncPartyList {
  return { partyListId: MAYA_ID, slug: 'maya-bday-7q2xk', name: 'Maya bday', gameFolderName: 'Party - Maya bday', endsAt: '2026-11-02T06:00:00Z', ...overrides };
}

class FakeLibrary implements SyncLibrary {
  librarySongs: LibrarySongDetails[] = [];
  /** null: a site from before party lists. */
  partyLists: SyncPartyList[] | null = [];
  isPartyListsDown = false;
  readonly fetchedSongIds: string[] = [];

  fetchLibrary(): Promise<LibrarySongDetails[]> {
    return Promise.resolve(this.librarySongs);
  }

  fetchPartyLists(): Promise<SyncPartyList[] | null> {
    return this.isPartyListsDown ? Promise.reject(new Error('dancedance.studio answered with an error (503).')) : Promise.resolve(this.partyLists);
  }

  fetchFingerprint(librarySongId: string): Promise<AudioFingerprint> {
    return Promise.resolve({ envelope: [librarySongId.charCodeAt(0)], rateHertz: 100 });
  }

  fetchSongFiles({ librarySongId, chartVersion }: { librarySongId: string; chartVersion: string }): Promise<SongFiles> {
    this.fetchedSongIds.push(librarySongId);
    return Promise.resolve({ sscText: `#TITLE:${librarySongId};\n#OFFSET:-0.100000;\n#VERSIONTAG:${chartVersion};\n`, images: [] });
  }
}

const UNUSED_HTTP: HttpClient = { requestJson: () => Promise.reject(new Error('unused')), requestText: () => Promise.reject(new Error('unused')), requestBytes: () => Promise.reject(new Error('unused')) };

/** A game, a library and the record, synced with the real planner and executor; music "music-x" is song x's own edit. */
class TestSync {
  readonly songsFolder = new MemorySongsFolder();
  readonly library = new FakeLibrary();
  record: InstalledSongsRecord = buildEmptyInstalledSongsRecord();
  layout: FolderLayout = 'one-group';
  private idCount = 0;

  constructor() {
    for (const file of MUSIC_FILES) this.songsFolder.addMusicSource({ sourceId: file.sourceId, bytes: new Uint8Array([79, 103, 103, 83]) });
  }

  async sync() {
    const outcome = await runSync({ ports: this.buildPorts(), settings: await this.buildSettings() });
    this.record = outcome.record;
    return outcome;
  }

  async listFolder(path: SongsPath): Promise<string[]> {
    return (await this.songsFolder.listEntries(path)).map((entry) => entry.name).sort((first, second) => first.localeCompare(second));
  }

  buildPorts(): SyncPorts {
    return {
      songsFolder: this.songsFolder,
      library: this.library,
      recordStore: { load: () => Promise.resolve(this.record), save: (record) => { this.record = record; return Promise.resolve(); } },
      httpClient: UNUSED_HTTP,
      checkAudioSource: ({ sourceId, fingerprint }) => Promise.resolve(sourceId === `music-${String.fromCharCode(fingerprint.envelope[0] ?? 0)}` ? { kind: 'matched', sourceId, shiftSeconds: 0 } : { kind: 'different-edit', sourceId }),
      downloadAddonFile: () => Promise.reject(new Error('unused')),
      createId: () => `id-${String((this.idCount += 1))}`,
      getNow: () => '2026-10-31T12:00:00Z',
    };
  }

  async buildSettings(): Promise<SyncSettings> {
    const musicIndex = await scanMusicLibrary({ musicLibrary: { listMusicFiles: () => toAsyncIterable(MUSIC_FILES) } });
    return { layout: this.layout, shouldUpdateAutomatically: true, choices: { replaceEditedSongIds: new Set(), removeFromGameSongIds: new Set(), updateSongIds: new Set() }, pickedSourceIdsBySongId: new Map(), musicIndex, addons: [] };
  }
}

async function* toAsyncIterable<Item>(items: readonly Item[]): AsyncIterable<Item> {
  for (const item of items) yield await Promise.resolve(item);
}

describe('party list folders', () => {
  it('puts copies of a list’s ready songs in its own folder, next to the layout’s folders', async () => {
    const game = new TestSync();
    game.layout = 'by-genre';
    game.library.librarySongs = [CHEAP_THRILLS];
    game.library.partyLists = [buildPartyList({ songs: [CHEAP_THRILLS, LEVITATING] })];
    const outcome = await game.sync();

    expect(await game.listFolder([])).toEqual(['Party - Maya bday', 'Pop']);
    expect(await game.listFolder(['Pop'])).toEqual(['Cheap Thrills']);
    expect(await game.listFolder(['Party - Maya bday'])).toEqual(['Cheap Thrills', 'Levitating']);
    expect(await game.songsFolder.readText(['Party - Maya bday', 'Levitating', 'Levitating.ssc'])).toContain('#TITLE:d;');
    expect(outcome.events.map((event) => [event.librarySongId, event.partyListId ?? null, event.folderPath.join('/')])).toEqual([
      ['a', null, 'Pop/Cheap Thrills'],
      ['a', MAYA_ID, 'Party - Maya bday/Cheap Thrills'],
      ['d', MAYA_ID, 'Party - Maya bday/Levitating'],
    ]);
    expect(outcome.finalPlan.songPlans.map((songPlan) => songPlan.librarySongId)).toEqual(['a']);
    expect(outcome.finalPlan.partyFolderPlans?.map((folderPlan) => [folderPlan.groupName, folderPlan.songPlans.map((songPlan) => songPlan.status)])).toEqual([['Party - Maya bday', ['synced', 'synced']]]);
    expect(findPartyFolder({ record: game.record, partyListId: MAYA_ID })?.installedSongs.map((song) => song.librarySongId)).toEqual(['a', 'd']);
  });

  it('keeps party copies where they are when the player changes the folder layout', async () => {
    const game = new TestSync();
    game.library.librarySongs = [CHEAP_THRILLS, WATCH_ME];
    game.library.partyLists = [buildPartyList({ songs: [CHEAP_THRILLS, WATCH_ME] })];
    await game.sync();
    for (const layout of ['by-artist', 'my-groups'] as const) {
      game.layout = layout;
      const outcome = await game.sync();
      expect(outcome.events.filter((event) => event.partyListId !== undefined)).toEqual([]);
    }
    expect(await game.listFolder([])).toEqual(['dancedance.studio - Ungrouped', 'Party - Maya bday']);
    expect(await game.listFolder(['Party - Maya bday'])).toEqual(['Cheap Thrills', 'Watch Me']);
  });

  it('syncs new ready songs in and removed songs out, leaving the song’s layout folder alone', async () => {
    const game = new TestSync();
    game.library.librarySongs = [CHEAP_THRILLS];
    game.library.partyLists = [buildPartyList({ songs: [CHEAP_THRILLS] })];
    await game.sync();
    game.library.partyLists = [buildPartyList({ songs: [LEVITATING] })];
    const outcome = await game.sync();

    expect(outcome.events.map((event) => [event.kind, event.folderPath.join('/')])).toEqual([['added', 'Party - Maya bday/Levitating'], ['removed', 'Party - Maya bday/Cheap Thrills']]);
    expect(await game.listFolder(['Party - Maya bday'])).toEqual(['Levitating']);
    expect(await game.listFolder(['dancedance.studio'])).toEqual(['Cheap Thrills']);
  });

  it('removes the whole folder when the list ends, is deleted or its sync is turned off, and nothing else', async () => {
    const game = new TestSync();
    await game.songsFolder.writeText({ path: ['Party - Old games', 'Their song', 'their.ssc'], text: 'the player’s own song' });
    game.library.librarySongs = [CHEAP_THRILLS];
    game.library.partyLists = [buildPartyList({ songs: [CHEAP_THRILLS, LEVITATING] })];
    await game.sync();
    game.library.partyLists = [];
    const outcome = await game.sync();

    expect(outcome.events.map((event) => [event.kind, event.partyListId, event.folderPath.join('/')])).toEqual([['removed', MAYA_ID, 'Party - Maya bday/Cheap Thrills'], ['removed', MAYA_ID, 'Party - Maya bday/Levitating']]);
    expect(outcome.finalPlan.partyFolderPlans).toEqual([]);
    expect(await game.listFolder([])).toEqual(['dancedance.studio', 'Party - Old games']);
    expect(await game.songsFolder.readText(['Party - Old games', 'Their song', 'their.ssc'])).toBe('the player’s own song');
    expect(getPartyFolders(game.record)).toEqual([]);
    expect(game.record.ownedGroupNames).toEqual(['dancedance.studio']);
  });

  it('finishes removing a gone list’s folder on a later sync, from its own record', async () => {
    const game = new TestSync();
    game.library.partyLists = [buildPartyList({ songs: [LEVITATING] })];
    await game.sync();
    game.library.partyLists = [];
    const removeFolder = game.songsFolder.removeFolder.bind(game.songsFolder);
    game.songsFolder.removeFolder = () => Promise.reject(new Error('StepMania has the folder open.'));
    const failedOutcome = await game.sync();
    expect(failedOutcome.events.map((event) => event.kind)).toEqual(['failed']);
    expect(findPartyFolder({ record: game.record, partyListId: MAYA_ID })?.installedSongs).toHaveLength(1);

    game.songsFolder.removeFolder = removeFolder;
    const outcome = await game.sync();
    expect(outcome.events.map((event) => event.kind)).toEqual(['removed']);
    expect(await game.listFolder([])).toEqual([]);
  });

  it('keeps a copy the player edited when its list ends, as their own song', async () => {
    const game = new TestSync();
    game.library.partyLists = [buildPartyList({ songs: [LEVITATING] })];
    await game.sync();
    await game.songsFolder.writeText({ path: ['Party - Maya bday', 'Levitating', 'Levitating.ssc'], text: 'the player’s own steps' });
    game.library.partyLists = [];
    await game.sync();

    expect(await game.songsFolder.readText(['Party - Maya bday', 'Levitating', 'Levitating.ssc'])).toBe('the player’s own steps');
    expect(getPartyFolders(game.record)).toEqual([]);
  });

  it('moves the folder when the list is renamed', async () => {
    const game = new TestSync();
    game.library.partyLists = [buildPartyList({ songs: [LEVITATING] })];
    await game.sync();
    game.library.partyLists = [buildPartyList({ name: 'Maya turns 30', gameFolderName: 'Party - Maya turns 30', songs: [LEVITATING] })];
    const outcome = await game.sync();

    expect(outcome.events.map((event) => [event.kind, event.folderPath.join('/')])).toEqual([['moved', 'Party - Maya turns 30/Levitating']]);
    expect(await game.listFolder([])).toEqual(['Party - Maya turns 30']);
    expect(findPartyFolder({ record: game.record, partyListId: MAYA_ID })).toMatchObject({ listName: 'Maya turns 30', groupName: 'Party - Maya turns 30' });
  });

  it('uses the “name already yours” rule, numbers lists with the same name, and names folders in English letters', async () => {
    const game = new TestSync();
    await game.songsFolder.writeText({ path: ['Party - Maya bday', 'Their song', 'their.ssc'], text: 'the player’s own song' });
    game.library.partyLists = [
      buildPartyList({ songs: [LEVITATING] }),
      buildPartyList({ partyListId: 'party_other_maya', songs: [LEVITATING] }),
      buildPartyList({ partyListId: 'party_sakura', name: '桜の夜', gameFolderName: 'Party - 桜の夜', songs: [LEVITATING] }),
    ];
    await game.sync();

    expect(await game.listFolder([])).toEqual(['dancedance.studio - Party - Maya bday', 'dancedance.studio - Party - Maya bday 2', 'Party - Maya bday', 'Party - Untitled list']);
    expect(await game.listFolder(['Party - Maya bday'])).toEqual(['Their song']);
    expect(getPartyFolderBaseName('Party - Beyoncé: Live / Tour?')).toBe('Party - Beyonce Live Tour');
  });

  it('keeps the layout out of a party folder, even with a genre of the same name', async () => {
    const game = new TestSync();
    game.layout = 'by-genre';
    game.library.librarySongs = [{ ...CHEAP_THRILLS, genre: 'Party - Maya bday' }];
    game.library.partyLists = [buildPartyList({ songs: [LEVITATING] })];
    await game.sync();

    expect(await game.listFolder([])).toEqual(['dancedance.studio - Party - Maya bday', 'Party - Maya bday']);
    expect(await game.listFolder(['Party - Maya bday'])).toEqual(['Levitating']);
  });

  it('leaves party folders as they are when the site has no party lists or can’t say', async () => {
    const game = new TestSync();
    game.library.partyLists = [buildPartyList({ songs: [LEVITATING] })];
    await game.sync();
    game.library.partyLists = null;
    const olderSiteOutcome = await game.sync();
    game.library.partyLists = [];
    game.library.isPartyListsDown = true;
    const downOutcome = await game.sync();

    expect(olderSiteOutcome.partyLists).toBeNull();
    expect([...olderSiteOutcome.events, ...downOutcome.events]).toEqual([]);
    expect(downOutcome.finalPlan.partyFolderPlans).toBeUndefined();
    expect(await game.listFolder(['Party - Maya bday'])).toEqual(['Levitating']);
  });

  it('syncs no party folders, without an error, with a library that can’t read party lists', async () => {
    const game = new TestSync();
    game.library.librarySongs = [CHEAP_THRILLS];
    const libraryWithoutPartyLists: SyncLibrary = { fetchLibrary: () => game.library.fetchLibrary(), fetchFingerprint: (id) => game.library.fetchFingerprint(id), fetchSongFiles: (request) => game.library.fetchSongFiles(request) };
    const outcome = await runSync({ ports: { ...game.buildPorts(), library: libraryWithoutPartyLists }, settings: await game.buildSettings() });

    expect(outcome.partyLists).toBeNull();
    expect(await game.listFolder([])).toEqual(['dancedance.studio']);
  });

  it('searches a song’s audio once, even when the library and two lists need it', async () => {
    const game = new TestSync();
    game.library.librarySongs = [CHEAP_THRILLS];
    game.library.partyLists = [buildPartyList({ songs: [CHEAP_THRILLS] }), buildPartyList({ partyListId: 'party_friday', name: 'Friday', gameFolderName: 'Party - Friday', songs: [CHEAP_THRILLS] })];
    const outcome = await game.sync();

    expect([...outcome.audioResultsBySongId.keys()]).toEqual(['a']);
    expect(game.library.fetchedSongIds).toEqual(['a', 'a', 'a']);
    expect(await game.listFolder([])).toEqual(['dancedance.studio', 'Party - Friday', 'Party - Maya bday']);
  });
});
