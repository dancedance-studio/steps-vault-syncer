import type { AppVersionsView, UpdateCheckView } from '@dancedance/sync-ui';

const CHECK_EVERY_HOURS = 6;

/** A check's answer: up to date, or a newer version that is now downloading. */
export type NewVersionCheck = { kind: 'up-to-date' } | { kind: 'found'; version: string; download: Promise<unknown> };

/** What the update checks need from electron-updater (src/main/updates.ts), passed in so they can be tested without it. */
export interface AppUpdater {
  /** Asks this repo's GitHub releases for a newer version and, when there is one, starts downloading it. */
  checkForNewVersion(options: { shouldGetTestVersionsFirst: boolean }): Promise<NewVersionCheck>;
  /** Quits and runs the downloaded installer. */
  installNow(): void;
}

export interface UpdateCheckSettings {
  isAutomaticUpdateCheckOn: boolean;
  shouldGetTestVersionsFirst: boolean;
}

export interface AppUpdatesOptions {
  updater: AppUpdater;
  getSettings: () => UpdateCheckSettings;
  onChange: () => void;
  log: (line: string) => void;
}

/**
 * The installed app's checks for new versions. With "Check for new versions automatically" on, it checks at start and
 * every 6 hours, and a new version downloads quietly; off, nothing is checked or downloaded unless the player presses
 * Check for updates. A failed automatic check (offline, GitHub busy) is not the player's problem, so only a check the
 * player started shows MISS.
 */
export class AppUpdates {
  private readonly options: AppUpdatesOptions;
  private check: UpdateCheckView = { kind: 'not-checked' };
  private automaticCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AppUpdatesOptions) {
    this.options = options;
  }

  get updateCheck(): UpdateCheckView {
    return this.check;
  }

  get readyVersion(): string | null {
    return this.check.kind === 'ready' ? this.check.version : null;
  }

  /** At start, and whenever the automatic switch changes: turning it on checks at once. */
  applyAutomaticCheckSetting(): void {
    const isOn = this.options.getSettings().isAutomaticUpdateCheckOn;
    if (isOn && this.automaticCheckTimer === null) {
      this.automaticCheckTimer = setInterval(() => void this.checkNow({ isStartedByPlayer: false }), CHECK_EVERY_HOURS * 60 * 60 * 1000);
      void this.checkNow({ isStartedByPlayer: false });
    }
    if (!isOn && this.automaticCheckTimer !== null) {
      clearInterval(this.automaticCheckTimer);
      this.automaticCheckTimer = null;
    }
  }

  /** "Up to date" was about the other kind of versions, so it is checked again (or forgotten, when checks are off). */
  handleTestVersionsChange(): void {
    if (this.check.kind !== 'up-to-date' && this.check.kind !== 'not-checked') return;
    if (this.options.getSettings().isAutomaticUpdateCheckOn) {
      void this.checkNow({ isStartedByPlayer: false });
      return;
    }
    this.setCheck({ kind: 'not-checked' });
  }

  /** A check already running, a download under way or a version ready waiting for a restart is enough. */
  async checkNow({ isStartedByPlayer }: { isStartedByPlayer: boolean }): Promise<void> {
    if (this.check.kind === 'checking' || this.check.kind === 'downloading' || this.check.kind === 'ready') return;
    const checkBefore = this.check;
    this.setCheck({ kind: 'checking' });
    try {
      const result = await this.options.updater.checkForNewVersion({ shouldGetTestVersionsFirst: this.options.getSettings().shouldGetTestVersionsFirst });
      if (result.kind === 'up-to-date') {
        this.setCheck({ kind: 'up-to-date' });
        return;
      }
      this.setCheck({ kind: 'downloading', version: result.version });
      await result.download;
      this.setCheck({ kind: 'ready', version: result.version });
    } catch (error) {
      this.options.log(`Update check failed: ${error instanceof Error ? error.message : String(error)}`);
      this.setCheck(isStartedByPlayer ? { kind: 'failed' } : checkBefore);
    }
  }

  stop(): void {
    if (this.automaticCheckTimer !== null) clearInterval(this.automaticCheckTimer);
    this.automaticCheckTimer = null;
  }

  private setCheck(check: UpdateCheckView): void {
    this.check = check;
    this.options.onChange();
  }
}

/** What Options shows; a copy run from source has no updater (its updates come from git). */
export function buildAppVersionsView({ appUpdates, currentVersion, settings }: { appUpdates: AppUpdates | null; currentVersion: string; settings: UpdateCheckSettings }): AppVersionsView {
  if (!appUpdates) return { kind: 'from-source', currentVersion };
  return { kind: 'installed', currentVersion, updateCheck: appUpdates.updateCheck, isAutomaticCheckOn: settings.isAutomaticUpdateCheckOn, shouldGetTestVersionsFirst: settings.shouldGetTestVersionsFirst };
}
