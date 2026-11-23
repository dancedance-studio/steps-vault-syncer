// Signing changes the installer's bytes, so the update files must describe the signed file: latest.yml gets its SHA-512
// and size (or electron-updater refuses the download), and the blockmap is made again from it (or every update is a
// full download). Usage: node refresh-update-files.mjs <release folder>
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeInstaller, parseLatestYml } from './update-files.mjs';

/** electron-builder's own blockmap maker, the one it used for the unsigned installer. */
async function loadBuildBlockMap() {
  const requireFromBuilder = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
  const blockMapModulePath = path.join(path.dirname(requireFromBuilder.resolve('app-builder-lib/package.json')), 'out', 'targets', 'blockmap', 'blockmap.js');
  const { buildBlockMap } = await import(pathToFileURL(blockMapModulePath).href);
  return buildBlockMap;
}

export async function refreshUpdateFiles(releaseFolder) {
  const manifestPath = path.join(releaseFolder, 'latest.yml');
  const manifestText = await readFile(manifestPath, 'utf8');
  const installerName = parseLatestYml(manifestText).path;
  if (!installerName) throw new Error('latest.yml names no installer (no "path:" line).');
  const installerPath = path.join(releaseFolder, installerName);
  const installer = await describeInstaller(installerPath);
  const refreshed = manifestText.replace(/^(\s*sha512: ).+$/gm, `$1${installer.sha512}`).replace(/^(\s*size: )\d+$/m, `$1${String(installer.size)}`);
  await writeFile(manifestPath, refreshed);
  const buildBlockMap = await loadBuildBlockMap();
  await buildBlockMap(installerPath, 'gzip', `${installerPath}.blockmap`);
  return installer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const releaseFolder = process.argv[2];
  if (!releaseFolder) throw new Error('Give the release folder that holds latest.yml and the installer.');
  const installer = await refreshUpdateFiles(releaseFolder);
  console.log(`latest.yml and ${installer.name}.blockmap now match ${installer.name} (${String(installer.size)} bytes).`);
}
