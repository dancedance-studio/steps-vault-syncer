// The release check: a program's Authenticode signature must be valid, and signed by the expected publisher. While
// Sync isn't code signed (docs/code-signing-policy.md), a release must have no signature at all instead, so a
// half-signed build is caught. Windows only (it asks PowerShell's Get-AuthenticodeSignature).
// Usage: node check-signature.mjs <file> "SignPath Foundation"
//        node check-signature.mjs <file> --not-signed
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The command-line word for "this release is unsigned": nothing in it may carry a signature. */
export const NOT_SIGNED_OPTION = '--not-signed';

/** The signer's name: the CN in a subject such as "CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, C=US". */
export function getCommonName(subject) {
  const match = /(?:^|,\s*)CN=(?:"([^"]*)"|([^,]*))/.exec(subject ?? '');
  return match ? (match[1] ?? match[2] ?? '').trim() : null;
}

/**
 * Null when the file is signed as the release expects; otherwise what is wrong, in one sentence. A null
 * expectedPublisher is an unsigned release: then the file must have no signature, valid or not.
 */
export function getSignatureProblemOrNull({ fileName, status, subject, expectedPublisher }) {
  if (expectedPublisher === null) return getUnsignedProblemOrNull({ fileName, status, subject });
  if (status === 'NotSigned') return `${fileName} is not signed.`;
  if (status !== 'Valid') return `${fileName}'s signature is not valid (${String(status)}).`;
  const publisher = getCommonName(subject);
  if (publisher !== expectedPublisher) return `${fileName} is signed by ${String(publisher)}, not ${expectedPublisher}.`;
  return null;
}

function getUnsignedProblemOrNull({ fileName, status, subject }) {
  if (status === 'NotSigned') return null;
  const signature = status === 'Valid' ? `is signed by ${String(getCommonName(subject))}` : `has a signature that is not valid (${String(status)})`;
  return `${fileName} ${signature}, but nothing in an unsigned release may be signed: this is a half-signed build.`;
}

/**
 * PowerShell's Status is an enum; ConvertTo-Json would write its number, so it is turned into its name first. Windows
 * PowerShell gets no PSModulePath: started from PowerShell 7 (check-installer.ps1 runs in pwsh), it would inherit 7's
 * module folders, fail to load Get-AuthenticodeSignature, and read no status at all.
 */
function readSignature(filePath) {
  const script = '$ErrorActionPreference = "Stop"; $signature = Get-AuthenticodeSignature -LiteralPath $env:SIGNED_FILE; @{ status = "$($signature.Status)"; subject = "$($signature.SignerCertificate.Subject)" } | ConvertTo-Json -Compress';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...getEnvironmentWithoutModulePath(), SIGNED_FILE: filePath }, encoding: 'utf8' });
  const signature = JSON.parse(output);
  if (!signature.status) throw new Error(`PowerShell read no signature status for ${filePath}.`);
  return signature;
}

/** Windows names are case-insensitive, so PSModulePath may come in any case. */
function getEnvironmentWithoutModulePath() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filePath, expectation] = process.argv.slice(2);
  if (!filePath || !expectation) throw new Error(`Give the file, and the publisher it must be signed by or ${NOT_SIGNED_OPTION}.`);
  const expectedPublisher = expectation === NOT_SIGNED_OPTION ? null : expectation;
  const { status, subject } = readSignature(filePath);
  const problem = getSignatureProblemOrNull({ fileName: filePath, status, subject, expectedPublisher });
  if (problem) {
    console.log(`::error::${problem}`);
    process.exit(1);
  }
  console.log(expectedPublisher === null ? `${filePath} is not signed, as an unsigned release must be.` : `${filePath} is signed by ${expectedPublisher}, and the signature is valid.`);
}
