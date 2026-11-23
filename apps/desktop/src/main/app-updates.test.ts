import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdates, buildAppVersionsView, type AppUpdater, type NewVersionCheck, type UpdateCheckSettings } from './app-updates';
import { buildDefaultSettings, parseSettings } from './desktop-settings';

const SIX_HOURS = 6 * 60 * 60 * 1000;

function buildUpdates({ answers, settings = { isAutomaticUpdateCheckOn: true, shouldGetTestVersionsFirst: false } }: { answers: (() => Promise<NewVersionCheck>)[]; settings?: UpdateCheckSettings }) {
  const checkOptions: { shouldGetTestVersionsFirst: boolean }[] = [];
  const updater: AppUpdater = {
    checkForNewVersion: (options) => {
      checkOptions.push(options);
      const answer = answers.shift();
      return answer ? answer() : Promise.resolve({ kind: 'up-to-date' });
    },
    installNow: vi.fn(),
  };
  const currentSettings = { ...settings };
  const logLines: string[] = [];
  const appUpdates = new AppUpdates({ updater, getSettings: () => currentSettings, onChange: vi.fn(), log: (line) => { logLines.push(line); } });
  return { appUpdates, checkOptions, currentSettings, logLines };
}

describe('AppUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('with automatic checks on, checks at start and every 6 hours', async () => {
    const { appUpdates, checkOptions } = buildUpdates({ answers: [] });
    appUpdates.applyAutomaticCheckSetting();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkOptions).toHaveLength(1);
    expect(appUpdates.updateCheck).toEqual({ kind: 'up-to-date' });
    await vi.advanceTimersByTimeAsync(SIX_HOURS);
    expect(checkOptions).toHaveLength(2);
    appUpdates.stop();
  });

  it('with automatic checks off, checks nothing until the player presses Check for updates', async () => {
    const { appUpdates, checkOptions } = buildUpdates({ answers: [], settings: { isAutomaticUpdateCheckOn: false, shouldGetTestVersionsFirst: false } });
    appUpdates.applyAutomaticCheckSetting();
    await vi.advanceTimersByTimeAsync(SIX_HOURS * 2);
    expect(checkOptions).toHaveLength(0);
    expect(appUpdates.updateCheck).toEqual({ kind: 'not-checked' });
    await appUpdates.checkNow({ isStartedByPlayer: true });
    expect(checkOptions).toHaveLength(1);
  });

  it('turning automatic checks off stops the 6-hourly checks, and on again checks at once', async () => {
    const { appUpdates, checkOptions, currentSettings } = buildUpdates({ answers: [] });
    appUpdates.applyAutomaticCheckSetting();
    await vi.advanceTimersByTimeAsync(0);
    currentSettings.isAutomaticUpdateCheckOn = false;
    appUpdates.applyAutomaticCheckSetting();
    await vi.advanceTimersByTimeAsync(SIX_HOURS * 2);
    expect(checkOptions).toHaveLength(1);
    currentSettings.isAutomaticUpdateCheckOn = true;
    appUpdates.applyAutomaticCheckSetting();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkOptions).toHaveLength(2);
    appUpdates.stop();
  });

  it('asks for test versions only with Get test versions first, and checks again when it changes', async () => {
    const { appUpdates, checkOptions, currentSettings } = buildUpdates({ answers: [] });
    await appUpdates.checkNow({ isStartedByPlayer: true });
    currentSettings.shouldGetTestVersionsFirst = true;
    appUpdates.handleTestVersionsChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkOptions).toEqual([{ shouldGetTestVersionsFirst: false }, { shouldGetTestVersionsFirst: true }]);
  });

  it('with checks off, a change of Get test versions first forgets the old "up to date" instead of checking', async () => {
    const { appUpdates, checkOptions, currentSettings } = buildUpdates({ answers: [], settings: { isAutomaticUpdateCheckOn: false, shouldGetTestVersionsFirst: false } });
    await appUpdates.checkNow({ isStartedByPlayer: true });
    currentSettings.shouldGetTestVersionsFirst = true;
    appUpdates.handleTestVersionsChange();
    expect(checkOptions).toHaveLength(1);
    expect(appUpdates.updateCheck).toEqual({ kind: 'not-checked' });
  });

  it('goes from checking to downloading to ready, and checks no more once a version waits for a restart', async () => {
    let finishDownload: () => void = () => undefined;
    const download = new Promise<void>((resolve) => { finishDownload = resolve; });
    const { appUpdates, checkOptions } = buildUpdates({ answers: [() => Promise.resolve({ kind: 'found', version: '0.2.0', download })] });
    const checking = appUpdates.checkNow({ isStartedByPlayer: true });
    expect(appUpdates.updateCheck).toEqual({ kind: 'checking' });
    await vi.advanceTimersByTimeAsync(0);
    expect(appUpdates.updateCheck).toEqual({ kind: 'downloading', version: '0.2.0' });
    expect(appUpdates.readyVersion).toBeNull();
    finishDownload();
    await checking;
    expect(appUpdates.updateCheck).toEqual({ kind: 'ready', version: '0.2.0' });
    expect(appUpdates.readyVersion).toBe('0.2.0');
    await appUpdates.checkNow({ isStartedByPlayer: true });
    expect(checkOptions).toHaveLength(1);
  });

  it('shows a failed check only when the player started it', async () => {
    const offline = () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'));
    const { appUpdates, logLines } = buildUpdates({ answers: [() => Promise.resolve({ kind: 'up-to-date' }), offline, offline] });
    await appUpdates.checkNow({ isStartedByPlayer: false });
    await appUpdates.checkNow({ isStartedByPlayer: false });
    expect(appUpdates.updateCheck).toEqual({ kind: 'up-to-date' });
    await appUpdates.checkNow({ isStartedByPlayer: true });
    expect(appUpdates.updateCheck).toEqual({ kind: 'failed' });
    expect(logLines).toEqual(['Update check failed: net::ERR_INTERNET_DISCONNECTED', 'Update check failed: net::ERR_INTERNET_DISCONNECTED']);
  });

  it('shows a failed download of a version the player asked for as a failed check', async () => {
    const { appUpdates } = buildUpdates({ answers: [() => Promise.resolve({ kind: 'found', version: '0.2.0', download: Promise.reject(new Error('sha512 checksum mismatch')) })] });
    await appUpdates.checkNow({ isStartedByPlayer: true });
    expect(appUpdates.updateCheck).toEqual({ kind: 'failed' });
  });
});

describe('the versions Options shows', () => {
  it('says a copy run from source gets its updates from git', () => {
    expect(buildAppVersionsView({ appUpdates: null, currentVersion: '0.1.0', settings: buildDefaultSettings() })).toEqual({ kind: 'from-source', currentVersion: '0.1.0' });
  });

  it('shows the installed copy’s check and its two switches', () => {
    const { appUpdates } = buildUpdates({ answers: [] });
    expect(buildAppVersionsView({ appUpdates, currentVersion: '0.1.0', settings: { isAutomaticUpdateCheckOn: false, shouldGetTestVersionsFirst: true } })).toEqual({ kind: 'installed', currentVersion: '0.1.0', updateCheck: { kind: 'not-checked' }, isAutomaticCheckOn: false, shouldGetTestVersionsFirst: true });
  });
});

describe('the update and start switches in the settings', () => {
  it('start with checks on, test versions off and start with Windows on, also for a settings file from before them', () => {
    const settings = parseSettings({ version: 1, layout: 'by-genre' });
    expect([settings.isAutomaticUpdateCheckOn, settings.shouldGetTestVersionsFirst, settings.shouldStartWithWindows]).toEqual([true, false, true]);
  });

  it('keep what the player chose', () => {
    const settings = parseSettings({ version: 1, isAutomaticUpdateCheckOn: false, shouldGetTestVersionsFirst: true, shouldStartWithWindows: false });
    expect([settings.isAutomaticUpdateCheckOn, settings.shouldGetTestVersionsFirst, settings.shouldStartWithWindows]).toEqual([false, true, false]);
  });
});
