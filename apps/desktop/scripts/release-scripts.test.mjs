import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { getCommonName, getSignatureProblemOrNull } from './check-signature.mjs';
import { buildDiscordBody, DISCORD_MESSAGE_MAX_LENGTH } from './discord-message.mjs';
import { refreshUpdateFiles } from './refresh-update-files.mjs';
import { describeInstaller, getUpdateFileProblems, parseLatestYml } from './update-files.mjs';
import { buildSigningRequestUrls, waitForSigningRequest } from './wait-for-signing.mjs';
import { getWhatsNew } from './whats-new.mjs';

const INSTALLER_NAME = 'dancedance-studio-Sync-Setup-0.2.0.exe';

/** latest.yml as electron-builder writes it for the unsigned installer. */
function buildLatestYml({ sha512, size }) {
  return `version: 0.2.0\nfiles:\n  - url: ${INSTALLER_NAME}\n    sha512: ${sha512}\n    size: ${String(size)}\npath: ${INSTALLER_NAME}\nsha512: ${sha512}\nreleaseDate: '2026-11-23T11:26:07.424Z'\n`;
}

let temporaryFolder = null;

async function makeReleaseFolder({ installerBytes, latestYml }) {
  temporaryFolder = await mkdtemp(path.join(os.tmpdir(), 'sync-release-'));
  await writeFile(path.join(temporaryFolder, INSTALLER_NAME), installerBytes);
  await writeFile(path.join(temporaryFolder, 'latest.yml'), latestYml);
  return temporaryFolder;
}

afterEach(async () => {
  if (temporaryFolder) await rm(temporaryFolder, { recursive: true, force: true });
  temporaryFolder = null;
});

describe('the update files', () => {
  it('after signing, describe the signed installer again, with a new blockmap', async () => {
    const signedBytes = Buffer.alloc(300_000, 7);
    const folder = await makeReleaseFolder({ installerBytes: signedBytes, latestYml: buildLatestYml({ sha512: 'unsigned-installer-sha512', size: 1234 }) });
    await refreshUpdateFiles(folder);
    const manifest = parseLatestYml(await readFile(path.join(folder, 'latest.yml'), 'utf8'));
    const installer = await describeInstaller(path.join(folder, INSTALLER_NAME));
    expect(installer.sha512).toBe(createHash('sha512').update(signedBytes).digest('base64'));
    expect(getUpdateFileProblems({ manifest, installer, expectedVersion: '0.2.0' })).toEqual([]);
    const blockMap = JSON.parse(gunzipSync(await readFile(path.join(folder, `${INSTALLER_NAME}.blockmap`))).toString('utf8'));
    expect(blockMap.files[0].sizes.reduce((total, size) => total + size, 0)).toBe(signedBytes.byteLength);
  });

  it('name every way latest.yml disagrees with the installer', () => {
    const manifest = parseLatestYml(buildLatestYml({ sha512: 'old', size: 1234 }));
    const installer = { name: INSTALLER_NAME, size: 5678, sha512: 'new' };
    expect(getUpdateFileProblems({ manifest, installer, expectedVersion: '0.2.1' })).toEqual([
      'latest.yml says version 0.2.0, not 0.2.1.',
      'latest.yml\'s sha512 doesn\'t match the installer.',
      'latest.yml says the installer is 1234 bytes; it is 5678.',
      'latest.yml\'s file sha512 doesn\'t match the installer.',
    ]);
    expect(getUpdateFileProblems({ manifest, installer: { ...installer, name: 'other.exe', size: 1234, sha512: 'old' }, expectedVersion: '0.2.0' })).toEqual(['latest.yml names dancedance-studio-Sync-Setup-0.2.0.exe, not the installer other.exe.', 'latest.yml lists no file named other.exe.']);
  });

  it('read quoted values and Windows line ends', () => {
    expect(parseLatestYml("version: '0.2.0'\r\npath: \"a b.exe\"\r\n")).toMatchObject({ version: '0.2.0', path: 'a b.exe' });
  });
});

describe('the signature check', () => {
  it('accepts only a valid signature by the expected publisher', () => {
    const subject = 'CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=Delaware, C=US';
    expect(getCommonName(subject)).toBe('SignPath Foundation');
    expect(getSignatureProblemOrNull({ fileName: 'Setup.exe', status: 'Valid', subject, expectedPublisher: 'SignPath Foundation' })).toBeNull();
    expect(getSignatureProblemOrNull({ fileName: 'Setup.exe', status: 'NotSigned', subject: '', expectedPublisher: 'SignPath Foundation' })).toBe('Setup.exe is not signed.');
    expect(getSignatureProblemOrNull({ fileName: 'Setup.exe', status: 'HashMismatch', subject, expectedPublisher: 'SignPath Foundation' })).toBe('Setup.exe\'s signature is not valid (HashMismatch).');
    expect(getSignatureProblemOrNull({ fileName: 'Setup.exe', status: 'Valid', subject: 'CN=Someone Else, O=Someone Else', expectedPublisher: 'SignPath Foundation' })).toBe('Setup.exe is signed by Someone Else, not SignPath Foundation.');
    expect(getCommonName('CN="Example, Inc.", O=Example')).toBe('Example, Inc.');
  });
});

describe('the Discord message body', () => {
  it('is JSON whatever the text holds, and never pings anyone', () => {
    const body = buildDiscordBody('  MISS Sync 0.2.0 check failed: "the installer\'s signature"\n@everyone <https://example.org/run> \\ done  ');
    expect(body).toEqual({ content: 'MISS Sync 0.2.0 check failed: "the installer\'s signature"\n@everyone <https://example.org/run> \\ done', allowed_mentions: { parse: [] } });
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('is cut to Discord’s length, and refuses an empty message', () => {
    expect(buildDiscordBody('x'.repeat(5000)).content).toHaveLength(DISCORD_MESSAGE_MAX_LENGTH);
    expect(() => buildDiscordBody(' \n')).toThrow('empty');
  });
});

describe('What’s new', () => {
  it('is the tag message without a signature', () => {
    const tagMessage = 'Options: switches for updates and starting with Windows.\r\n\r\n- Test versions first\r\n-----BEGIN PGP SIGNATURE-----\r\n\r\nabc\r\n-----END PGP SIGNATURE-----\r\n';
    expect(getWhatsNew(tagMessage)).toBe('Options: switches for updates and starting with Windows.\n\n- Test versions first');
    expect(getWhatsNew('Line\n-----BEGIN SSH SIGNATURE-----\nxyz\n')).toBe('Line');
    expect(getWhatsNew('\n  \n')).toBe('');
  });
});

describe('waiting for SignPath', () => {
  it('uses the connector routes of SignPath’s own action', () => {
    expect(buildSigningRequestUrls({ organizationId: 'org 1', signingRequestId: 'req-2' })).toEqual({
      statusUrl: 'https://pipelineconnector.connectors.signpath.io/GitHubActions/GitHubCom/org%201/SigningRequests/req-2/Status?api-version=1.0',
      signedArtifactUrl: 'https://pipelineconnector.connectors.signpath.io/GitHubActions/GitHubCom/org%201/SigningRequests/req-2/SignedArtifact?api-version=1.0',
    });
  });

  function buildClock() {
    const clock = { nowMilliseconds: 0 };
    return { clock, waitMilliseconds: (milliseconds) => { clock.nowMilliseconds += milliseconds; return Promise.resolve(); }, getNowMilliseconds: () => clock.nowMilliseconds };
  }

  it('waits through the approval and a SignPath hiccup, logging each new status once', async () => {
    const answers = [{ status: 'WaitingForApproval', isFinalStatus: false }, { status: 'WaitingForApproval', isFinalStatus: false }, new Error('fetch failed'), { status: 'InProgress', isFinalStatus: false }, { status: 'Completed', isFinalStatus: true }];
    const logLines = [];
    await waitForSigningRequest({
      fetchStatus: () => { const answer = answers.shift(); return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer); },
      ...buildClock(), timeoutMilliseconds: 60 * 60_000, log: (line) => { logLines.push(line); },
    });
    expect(logLines).toEqual(['Signing request: WaitingForApproval. Waiting for the approval on SignPath…', 'SignPath didn\'t answer (fetch failed); asking again.', 'Signing request: InProgress. Waiting for the approval on SignPath…']);
  });

  it('stops at a denied request, and when the wait runs out', async () => {
    await expect(waitForSigningRequest({ fetchStatus: () => Promise.resolve({ status: 'Denied', isFinalStatus: true }), ...buildClock(), timeoutMilliseconds: 60_000, log: () => undefined })).rejects.toThrow('ended as Denied');
    await expect(waitForSigningRequest({ fetchStatus: () => Promise.resolve({ status: 'WaitingForApproval', isFinalStatus: false }), ...buildClock(), timeoutMilliseconds: 5 * 60_000, log: () => undefined })).rejects.toThrow('still WaitingForApproval when the wait ended');
  });
});
