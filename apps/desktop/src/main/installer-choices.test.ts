import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDefaultSettings, parseSettings } from './desktop-settings';
import { parseInstallerChoicesOrNull, readInstallerChoicesOrNull, withInstallerChoicesOrNull } from './installer-choices';

/** What build/installer.nsh writes, CRLF included. */
const INSTALLER_FILE_TEXT = '{"installId":"{5F1C2A7E-0B6D-4C11-9E3A-2D8B7F4C9A10}","isAutomaticUpdateCheckOn":false,"shouldStartWithWindows":true}\r\n';

let temporaryFolder: string | null = null;

afterEach(async () => {
  if (temporaryFolder) await rm(temporaryFolder, { recursive: true, force: true });
  temporaryFolder = null;
});

describe('the installer’s choices', () => {
  it('reads the file the installer writes', () => {
    expect(parseInstallerChoicesOrNull(INSTALLER_FILE_TEXT)).toEqual({ installId: '{5F1C2A7E-0B6D-4C11-9E3A-2D8B7F4C9A10}', isAutomaticUpdateCheckOn: false, shouldStartWithWindows: true });
  });

  it.each([
    ['not JSON', 'isAutomaticUpdateCheckOn=false'],
    ['a list', '[]'],
    ['no install id', '{"isAutomaticUpdateCheckOn":false,"shouldStartWithWindows":true}'],
    ['words instead of true or false', '{"installId":"{A}","isAutomaticUpdateCheckOn":"false","shouldStartWithWindows":true}'],
  ])('ignores a file that is %s', (_name, text) => {
    expect(parseInstallerChoicesOrNull(text)).toBeNull();
  });

  it('reads them next to the installed app, and never for a copy run from source', async () => {
    temporaryFolder = await mkdtemp(path.join(os.tmpdir(), 'sync-installer-choices-'));
    expect(await readInstallerChoicesOrNull(temporaryFolder)).toBeNull();
    await writeFile(path.join(temporaryFolder, 'installer-choices.json'), INSTALLER_FILE_TEXT);
    expect((await readInstallerChoicesOrNull(temporaryFolder))?.isAutomaticUpdateCheckOn).toBe(false);
    expect(await readInstallerChoicesOrNull(null)).toBeNull();
  });

  it('become the settings on the first start after an install, and only then', () => {
    const choices = { installId: '{A}', isAutomaticUpdateCheckOn: false, shouldStartWithWindows: false };
    const firstStart = withInstallerChoicesOrNull({ settings: buildDefaultSettings(), choices });
    expect(firstStart).toMatchObject({ isAutomaticUpdateCheckOn: false, shouldStartWithWindows: false, appliedInstallId: '{A}' });
    if (!firstStart) throw new Error('Expected the choices to apply.');
    const switchedOnInOptions = parseSettings({ ...firstStart, isAutomaticUpdateCheckOn: true });
    expect(withInstallerChoicesOrNull({ settings: switchedOnInOptions, choices })).toBeNull();
    expect(withInstallerChoicesOrNull({ settings: switchedOnInOptions, choices: { ...choices, installId: '{B}' } })).toMatchObject({ isAutomaticUpdateCheckOn: false, appliedInstallId: '{B}' });
  });

  it('change nothing without a file', () => {
    expect(withInstallerChoicesOrNull({ settings: buildDefaultSettings(), choices: null })).toBeNull();
  });
});
