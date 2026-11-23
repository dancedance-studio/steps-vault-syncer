// The release check: latest.yml must name the installer next to it, with its exact size and SHA-512, and the version
// being released. Usage: node check-update-files.mjs <folder with latest.yml and the installer> <version>
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describeInstaller, getUpdateFileProblems, parseLatestYml } from './update-files.mjs';

const [folder, expectedVersion] = process.argv.slice(2);
if (!folder || !expectedVersion) throw new Error('Give the folder with latest.yml and the installer, and the version.');
const manifest = parseLatestYml(await readFile(path.join(folder, 'latest.yml'), 'utf8'));
if (!manifest.path) throw new Error('latest.yml names no installer (no "path:" line).');
const installer = await describeInstaller(path.join(folder, manifest.path));
const problems = getUpdateFileProblems({ manifest, installer, expectedVersion });
for (const problem of problems) console.log(`::error::${problem}`);
if (problems.length > 0) process.exit(1);
console.log(`latest.yml matches ${installer.name}: version ${expectedVersion}, ${String(installer.size)} bytes, same sha512.`);
