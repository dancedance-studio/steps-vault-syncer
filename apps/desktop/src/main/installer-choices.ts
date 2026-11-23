import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopSettings } from './desktop-settings';

/** Written next to the installed app by the installer's "What Sync sends" page (build/installer.nsh). */
export const INSTALLER_CHOICES_FILE_NAME = 'installer-choices.json';

/** The player's two answers in the installer, and which install they belong to. */
export interface InstallerChoices {
  /** A new one at every install; an update writes no file. */
  installId: string;
  isAutomaticUpdateCheckOn: boolean;
  shouldStartWithWindows: boolean;
}

export function parseInstallerChoicesOrNull(text: string): InstallerChoices | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const { installId, isAutomaticUpdateCheckOn, shouldStartWithWindows } = value as Record<string, unknown>;
    if (typeof installId !== 'string' || installId === '' || typeof isAutomaticUpdateCheckOn !== 'boolean' || typeof shouldStartWithWindows !== 'boolean') return null;
    return { installId, isAutomaticUpdateCheckOn, shouldStartWithWindows };
  } catch {
    return null;
  }
}

/** Null without a program folder (a copy run from source has no installer) or without a readable file. */
export async function readInstallerChoicesOrNull(programFolder: string | null): Promise<InstallerChoices | null> {
  if (programFolder === null) return null;
  const text = await readFile(path.join(programFolder, INSTALLER_CHOICES_FILE_NAME), 'utf8').catch(() => null);
  return text === null ? null : parseInstallerChoicesOrNull(text);
}

/**
 * On the first start after an install, the installer's answers become the settings; after that the Options switches
 * own them, so the same install's answers are never applied twice. Null when there is nothing new to apply.
 */
export function withInstallerChoicesOrNull({ settings, choices }: { settings: DesktopSettings; choices: InstallerChoices | null }): DesktopSettings | null {
  if (choices === null || choices.installId === settings.appliedInstallId) return null;
  return { ...settings, isAutomaticUpdateCheckOn: choices.isAutomaticUpdateCheckOn, shouldStartWithWindows: choices.shouldStartWithWindows, appliedInstallId: choices.installId };
}
