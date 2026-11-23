// The update files electron-updater reads next to the installer: latest.yml (the version, the installer's name, size and
// SHA-512) and <installer>.blockmap (block checksums for downloading only what changed). Signing changes the
// installer's bytes, so both are written again for the signed file (refresh-update-files.mjs), and the release check
// compares them with the published installer (check-update-files.mjs).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The values electron-updater uses, read line by line: latest.yml is small and electron-builder always writes it alike. */
export function parseLatestYml(text) {
  const manifest = { version: null, path: null, sha512: null, files: [] };
  for (const line of text.split(/\r?\n/)) {
    const topLevel = /^(version|path|sha512): (.+)$/.exec(line);
    if (topLevel) {
      manifest[topLevel[1]] = unquote(topLevel[2]);
      continue;
    }
    const fileStart = /^\s+- url: (.+)$/.exec(line);
    if (fileStart) {
      manifest.files.push({ url: unquote(fileStart[1]), sha512: null, size: null });
      continue;
    }
    const fileField = /^\s+(sha512|size): (.+)$/.exec(line);
    const currentFile = manifest.files.at(-1);
    if (fileField && currentFile) currentFile[fileField[1]] = fileField[1] === 'size' ? Number(unquote(fileField[2])) : unquote(fileField[2]);
  }
  return manifest;
}

function unquote(value) {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** The installer's name, size and SHA-512 (base64, as latest.yml writes it). */
export async function describeInstaller(filePath) {
  const bytes = await readFile(filePath);
  return { name: path.basename(filePath), size: bytes.byteLength, sha512: createHash('sha512').update(bytes).digest('base64') };
}

/** Every way latest.yml disagrees with the installer next to it; empty when electron-updater would accept it. */
export function getUpdateFileProblems({ manifest, installer, expectedVersion }) {
  const problems = [];
  if (manifest.version !== expectedVersion) problems.push(`latest.yml says version ${String(manifest.version)}, not ${expectedVersion}.`);
  if (manifest.path !== installer.name) problems.push(`latest.yml names ${String(manifest.path)}, not the installer ${installer.name}.`);
  if (manifest.sha512 !== installer.sha512) problems.push('latest.yml\'s sha512 doesn\'t match the installer.');
  const file = manifest.files.find((candidate) => candidate.url === installer.name);
  if (!file) {
    problems.push(`latest.yml lists no file named ${installer.name}.`);
    return problems;
  }
  if (file.size !== installer.size) problems.push(`latest.yml says the installer is ${String(file.size)} bytes; it is ${String(installer.size)}.`);
  if (file.sha512 !== installer.sha512) problems.push('latest.yml\'s file sha512 doesn\'t match the installer.');
  return problems;
}
