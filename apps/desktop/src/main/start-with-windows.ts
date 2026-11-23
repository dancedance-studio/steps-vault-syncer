import { APP_DISPLAY_NAME } from '../shared/app-name';

/**
 * The names of Sync's values under the per-user Run key (HKCU\Software\Microsoft\Windows\CurrentVersion\Run). The
 * installed one is also in build/installer.nsh, whose uninstaller removes it; keep the two in step.
 */
export const INSTALLED_LOGIN_ITEM_NAME = APP_DISPLAY_NAME;
export const FROM_SOURCE_LOGIN_ITEM_NAME = `${APP_DISPLAY_NAME} (from source)`;

/** The part of Electron's app.setLoginItemSettings options that Sync uses. */
export interface LoginItemSettings {
  openAtLogin: boolean;
  name: string;
  args?: string[];
}

/** This copy of Sync, as Windows would start it. */
export interface SyncCopy {
  isPackaged: boolean;
  /** process.execPath: the installed app, or the Electron program a copy run from source runs in. */
  programPath: string;
  /** app.getAppPath(): the folder with package.json, which is what a copy run from source is started with. */
  appFolder: string;
  platform: string;
  /** A test run with its own settings folder (DANCEDANCE_USER_DATA_DIR) never changes what starts with Windows. */
  isTestRun: boolean;
}

/** Adds this copy to, or takes it off, the programs Windows starts when the player signs in. */
export interface StartWithWindows {
  /** What the Run value says for this copy; null where Sync never changes it (not Windows, or a test run). */
  readonly command: string | null;
  apply(shouldStart: boolean): void;
}

/**
 * Electron fills in the program (process.execPath, quoted). The installed app is that program; a copy run from source
 * is the Electron program with the app folder, as `electron .` starts it, under its own name so it never replaces the
 * installed app's value.
 */
export function createStartWithWindows({ copy, setLoginItemSettings }: { copy: SyncCopy; setLoginItemSettings: (settings: LoginItemSettings) => void }): StartWithWindows {
  const isChangeable = copy.platform === 'win32' && !copy.isTestRun;
  // Electron quotes each argument itself (and escapes quotes inside it), so the folder goes in bare.
  const args = copy.isPackaged ? [] : [copy.appFolder];
  const name = copy.isPackaged ? INSTALLED_LOGIN_ITEM_NAME : FROM_SOURCE_LOGIN_ITEM_NAME;
  return {
    command: isChangeable ? [`"${copy.programPath}"`, ...args].join(' ') : null,
    apply: (shouldStart) => {
      if (!isChangeable) return;
      setLoginItemSettings(args.length > 0 ? { openAtLogin: shouldStart, name, args } : { openAtLogin: shouldStart, name });
    },
  };
}

/**
 * At start, Windows' list is changed only when the switch or this copy's command changed since Sync last wrote it: a
 * copy that moved (a newer Electron from source, an install in another folder) is written again, but Sync never turns
 * itself back on after the player turned it off in Windows' own Startup apps list.
 */
export function getStartWithWindowsChangeOrNull({ shouldStart, command, writtenCommand }: { shouldStart: boolean; command: string | null; writtenCommand: string | null }): { shouldStart: boolean; writtenCommand: string | null } | null {
  if (command === null) return null;
  const wantedCommand = shouldStart ? command : null;
  return wantedCommand === writtenCommand ? null : { shouldStart, writtenCommand: wantedCommand };
}
