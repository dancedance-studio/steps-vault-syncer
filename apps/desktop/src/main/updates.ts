import { autoUpdater } from 'electron-updater';
import type { AppUpdater } from './app-updates';

/**
 * New versions come from this repo's GitHub releases; a test version is a GitHub pre-release, seen only with "Get test
 * versions first". A found version downloads quietly, then the "update ready" banner asks the player to restart; it is
 * also installed when the app quits. Only the installed app has an updater: a copy run from source has nothing to
 * update.
 */
export function createElectronAppUpdater(): AppUpdater {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // electron-updater also reports every failure as an event; without a listener Node would treat it as a crash.
  autoUpdater.on('error', (error) => {
    console.warn(`Update check failed: ${error.message}`);
  });
  return {
    checkForNewVersion: async ({ shouldGetTestVersionsFirst }) => {
      // Set every time: electron-updater's own default turns test versions on for a version like 0.1.0-preview.1.
      autoUpdater.allowPrerelease = shouldGetTestVersionsFirst;
      const result = await autoUpdater.checkForUpdates();
      if (!result) throw new Error('This copy of Sync doesn’t update itself.');
      if (!result.isUpdateAvailable || !result.downloadPromise) return { kind: 'up-to-date' };
      return { kind: 'found', version: result.updateInfo.version, download: result.downloadPromise };
    },
    installNow: () => {
      autoUpdater.quitAndInstall(false, true);
    },
  };
}
