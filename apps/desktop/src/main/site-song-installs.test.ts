import { describe, expect, it } from 'vitest';
import { buildEmptyInstalledSongsRecord, MemorySongsFolder, type InstalledSong, type SongPlan, type SyncOutcome } from '@stepsvault/sync-core';
import { installSongForSite, type SiteSongInstallPorts } from './site-song-installs';

const NIGHT_DRIVE_FOLDER = ['dancedance.studio', 'Night Drive'];
const NIGHT_DRIVE: InstalledSong = {
  vaultSongId: 'song_42', chartVersion: 'v1', installId: 'install-1', folderPath: NIGHT_DRIVE_FOLDER, chartHashesByFileName: { 'Night Drive.ssc': 'hash' },
  music: { fileName: 'music.ogg', videoFileName: 'video.mp4', shiftSeconds: 0 }, installedAt: '2026-11-21T10:00:00.000Z',
};

function buildOutcome({ installedSongs = [], songPlan }: { installedSongs?: InstalledSong[]; songPlan: SongPlan }): SyncOutcome {
  return { vaultSongs: [], partyLists: null, finalPlan: { songPlans: [songPlan], forgetActions: [] }, audioResultsBySongId: new Map(), events: [], record: { ...buildEmptyInstalledSongsRecord(), installedSongs } };
}

const INSTALLED = buildOutcome({ installedSongs: [NIGHT_DRIVE], songPlan: { vaultSongId: 'song_42', status: 'synced', actions: [], isWaitingForAddon: false } });
const STILL_GETTING_MUSIC = buildOutcome({ songPlan: { vaultSongId: 'song_42', status: 'needs-audio', actions: [], isWaitingForAddon: true } });
const NO_MUSIC = buildOutcome({ songPlan: { vaultSongId: 'song_42', status: 'needs-audio', actions: [], isWaitingForAddon: false } });

/** The app around an install: its syncs (each gives the next outcome), its game folder in memory, and the time. */
class FakeApp {
  readonly songsFolder = new MemorySongsFolder();
  readonly waits: number[] = [];
  nowMilliseconds = 0;
  syncCount = 0;
  hasGameFolder = true;
  isStepManiaRunning = false;
  problem: string | null = null;
  runningSyncOutcome: SyncOutcome | null = null;
  /** What each sync now gives, in order; null: it stopped. */
  outcomes: (SyncOutcome | null)[] = [];

  readonly ports: SiteSongInstallPorts = {
    hasGame: () => this.hasGameFolder,
    isGameRunning: () => Promise.resolve(this.isStepManiaRunning),
    waitForRunningSync: () => Promise.resolve(this.runningSyncOutcome),
    syncNow: async () => {
      this.syncCount += 1;
      const outcome = this.outcomes.shift() ?? null;
      if (outcome === INSTALLED) await this.writeNightDrive();
      return outcome;
    },
    getProblem: () => this.problem,
    getSongsFolder: () => this.songsFolder,
    isAddonFile: (sourceId) => sourceId.startsWith('addon:'),
    getNowMilliseconds: () => this.nowMilliseconds,
    waitMilliseconds: (milliseconds) => {
      this.waits.push(milliseconds);
      this.nowMilliseconds += milliseconds;
      return Promise.resolve();
    },
  };

  async writeNightDrive(): Promise<void> {
    for (const fileName of ['Night Drive.ssc', 'music.ogg', 'video.mp4']) await this.songsFolder.writeBytes({ path: [...NIGHT_DRIVE_FOLDER, fileName], bytes: new Uint8Array([1]) });
  }

  install(): ReturnType<typeof installSongForSite> {
    return installSongForSite({ ports: this.ports, vaultSongId: 'song_42' });
  }
}

describe('installSongForSite', () => {
  it('runs a sync now and answers installed once the music and video are in the song’s folder', async () => {
    const app = new FakeApp();
    app.outcomes = [INSTALLED];
    expect(await app.install()).toEqual({ kind: 'installed' });
    expect(app.syncCount).toBe(1);
  });

  it('counts a sync that is already running: waits for it, and needs no other when the song landed', async () => {
    const app = new FakeApp();
    await app.writeNightDrive();
    app.runningSyncOutcome = INSTALLED;
    expect(await app.install()).toEqual({ kind: 'installed' });
    expect(app.syncCount).toBe(0);
  });

  it('syncs again after a running sync that didn’t bring the song in, and never answers installed without the music file', async () => {
    const app = new FakeApp();
    app.runningSyncOutcome = INSTALLED;
    app.outcomes = [INSTALLED];
    expect(await app.install()).toEqual({ kind: 'installed' });
    expect(app.syncCount).toBe(1);
  });

  it('syncs again every 15 s while the link addon is still getting the music, then answers installed', async () => {
    const app = new FakeApp();
    app.outcomes = [STILL_GETTING_MUSIC, STILL_GETTING_MUSIC, INSTALLED];
    expect(await app.install()).toEqual({ kind: 'installed' });
    expect(app.syncCount).toBe(3);
    expect(app.waits).toEqual([15_000, 15_000]);
  });

  it('answers different when the music the addon got is another version, and failed when the player’s own file is', async () => {
    const fromSource = (sourceId: string): SyncOutcome => ({ ...NO_MUSIC, finalPlan: { songPlans: [{ vaultSongId: 'song_42', status: 'different-edit', actions: [], isWaitingForAddon: false }], forgetActions: [] }, audioResultsBySongId: new Map([['song_42', { match: { kind: 'different-edit', sourceId }, addonMessages: [], pageLinks: [] }]]) });
    const fromAddon = new FakeApp();
    fromAddon.outcomes = [fromSource('addon:night-drive.ogg')];
    expect(await fromAddon.install()).toEqual({ kind: 'different', reason: 'The music your link addon got is another version of this song, or another song.' });
    const fromPlayer = new FakeApp();
    fromPlayer.outcomes = [fromSource('file:Night Drive.mp3')];
    expect((await fromPlayer.install()).kind).toBe('failed');
  });

  it('answers failed with a reason when the song’s audio can’t be found', async () => {
    const app = new FakeApp();
    app.outcomes = [NO_MUSIC];
    expect(await app.install()).toEqual({ kind: 'failed', reason: 'Sync couldn’t find this song’s music in your music folders or through your addons.' });
  });

  it('gives up after 8 minutes when the addon is still getting the music, inside the site’s 10 minutes', async () => {
    const app = new FakeApp();
    app.outcomes = Array.from({ length: 60 }, () => STILL_GETTING_MUSIC);
    expect(await app.install()).toEqual({ kind: 'failed', reason: 'Your link addon is still getting the music. Try again in a few minutes.' });
    expect(app.nowMilliseconds).toBeLessThanOrEqual(8 * 60_000);
    expect(app.syncCount).toBe(33);
  });

  it('says why without a game folder, while StepMania runs, and when the sync stopped', async () => {
    const noGame = new FakeApp();
    noGame.hasGameFolder = false;
    expect(await noGame.install()).toEqual({ kind: 'failed', reason: 'Sync has no game folder yet. Open dancedance.studio Sync and choose your game.' });
    const gameRunning = new FakeApp();
    gameRunning.isStepManiaRunning = true;
    expect(await gameRunning.install()).toEqual({ kind: 'failed', reason: 'StepMania is running. Close it so Sync can add the song, then try again.' });
    expect(gameRunning.syncCount).toBe(0);
    const stopped = new FakeApp();
    stopped.problem = 'dancedance.studio answered with an error (503). Try again in a minute.';
    expect(await stopped.install()).toEqual({ kind: 'failed', reason: 'dancedance.studio answered with an error (503). Try again in a minute.' });
    const stoppedWithoutProblem = new FakeApp();
    expect(await stoppedWithoutProblem.install()).toEqual({ kind: 'failed', reason: 'Sync couldn’t finish a sync. Try again in a minute.' });
  });
});
