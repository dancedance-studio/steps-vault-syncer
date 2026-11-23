import { describe, expect, it } from 'vitest';
import { createStartWithWindows, getStartWithWindowsChangeOrNull, type LoginItemSettings, type SyncCopy } from './start-with-windows';

const INSTALLED: SyncCopy = { isPackaged: true, programPath: 'C:\\Users\\Noa\\AppData\\Local\\Programs\\dancedance.studio Sync\\dancedance.studio Sync.exe', appFolder: 'C:\\Users\\Noa\\AppData\\Local\\Programs\\dancedance.studio Sync\\resources\\app.asar', platform: 'win32', isTestRun: false };
const FROM_SOURCE: SyncCopy = { isPackaged: false, programPath: 'C:\\projects\\sync\\node_modules\\.pnpm\\electron@45.1.0\\node_modules\\electron\\dist\\electron.exe', appFolder: 'C:\\projects\\sync\\apps\\desktop', platform: 'win32', isTestRun: false };

function applyWith(copy: SyncCopy, shouldStart: boolean): { command: string | null; written: LoginItemSettings[] } {
  const written: LoginItemSettings[] = [];
  const startWithWindows = createStartWithWindows({ copy, setLoginItemSettings: (settings) => { written.push(settings); } });
  startWithWindows.apply(shouldStart);
  return { command: startWithWindows.command, written };
}

describe('start with Windows', () => {
  it('starts the installed app itself, under the app’s name', () => {
    expect(applyWith(INSTALLED, true)).toEqual({ command: `"${INSTALLED.programPath}"`, written: [{ openAtLogin: true, name: 'dancedance.studio Sync' }] });
  });

  it('from source, starts Electron with the quoted app folder, under its own name', () => {
    expect(applyWith(FROM_SOURCE, true)).toEqual({ command: `"${FROM_SOURCE.programPath}" "C:\\projects\\sync\\apps\\desktop"`, written: [{ openAtLogin: true, name: 'dancedance.studio Sync (from source)', args: ['"C:\\projects\\sync\\apps\\desktop"'] }] });
  });

  it('turned off, removes the same value', () => {
    expect(applyWith(INSTALLED, false).written).toEqual([{ openAtLogin: false, name: 'dancedance.studio Sync' }]);
    expect(applyWith(FROM_SOURCE, false).written).toEqual([{ openAtLogin: false, name: 'dancedance.studio Sync (from source)', args: ['"C:\\projects\\sync\\apps\\desktop"'] }]);
  });

  it('changes nothing outside Windows or in a test run', () => {
    expect(applyWith({ ...FROM_SOURCE, platform: 'darwin' }, true)).toEqual({ command: null, written: [] });
    expect(applyWith({ ...INSTALLED, isTestRun: true }, true)).toEqual({ command: null, written: [] });
  });
});

describe('what Sync changes in Windows’ list at start', () => {
  const command = '"C:\\Sync\\dancedance.studio Sync.exe"';

  it('writes this copy the first time, and then leaves the list alone', () => {
    expect(getStartWithWindowsChangeOrNull({ shouldStart: true, command, writtenCommand: null })).toEqual({ shouldStart: true, writtenCommand: command });
    expect(getStartWithWindowsChangeOrNull({ shouldStart: true, command, writtenCommand: command })).toBeNull();
  });

  it('writes again when the copy moved', () => {
    expect(getStartWithWindowsChangeOrNull({ shouldStart: true, command, writtenCommand: '"C:\\Old\\electron.exe" "C:\\Old\\apps\\desktop"' })).toEqual({ shouldStart: true, writtenCommand: command });
  });

  it('removes the copy once when the switch is off', () => {
    expect(getStartWithWindowsChangeOrNull({ shouldStart: false, command, writtenCommand: command })).toEqual({ shouldStart: false, writtenCommand: null });
    expect(getStartWithWindowsChangeOrNull({ shouldStart: false, command, writtenCommand: null })).toBeNull();
  });

  it('changes nothing where Sync never touches the list', () => {
    expect(getStartWithWindowsChangeOrNull({ shouldStart: true, command: null, writtenCommand: null })).toBeNull();
  });
});
