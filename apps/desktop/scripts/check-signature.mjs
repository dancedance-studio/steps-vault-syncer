// The release check: a program's Authenticode signature must be valid, and signed by the expected publisher.
// Windows only (it asks PowerShell's Get-AuthenticodeSignature).
// Usage: node check-signature.mjs <file> "SignPath Foundation"
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The signer's name: the CN in a subject such as "CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, C=US". */
export function getCommonName(subject) {
  const match = /(?:^|,\s*)CN=(?:"([^"]*)"|([^,]*))/.exec(subject ?? '');
  return match ? (match[1] ?? match[2] ?? '').trim() : null;
}

/** Null when the signature is valid and the publisher is the expected one; otherwise what is wrong, in one sentence. */
export function getSignatureProblemOrNull({ fileName, status, subject, expectedPublisher }) {
  if (status === 'NotSigned') return `${fileName} is not signed.`;
  if (status !== 'Valid') return `${fileName}'s signature is not valid (${String(status)}).`;
  const publisher = getCommonName(subject);
  if (publisher !== expectedPublisher) return `${fileName} is signed by ${String(publisher)}, not ${expectedPublisher}.`;
  return null;
}

/** PowerShell's Status is an enum; ConvertTo-Json would write its number, so it is turned into its name first. */
function readSignature(filePath) {
  const script = '$signature = Get-AuthenticodeSignature -LiteralPath $env:SIGNED_FILE; @{ status = "$($signature.Status)"; subject = "$($signature.SignerCertificate.Subject)" } | ConvertTo-Json -Compress';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, SIGNED_FILE: filePath }, encoding: 'utf8' });
  return JSON.parse(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filePath, expectedPublisher] = process.argv.slice(2);
  if (!filePath || !expectedPublisher) throw new Error('Give the file and the publisher it must be signed by.');
  const { status, subject } = readSignature(filePath);
  const problem = getSignatureProblemOrNull({ fileName: filePath, status, subject, expectedPublisher });
  if (problem) {
    console.log(`::error::${problem}`);
    process.exit(1);
  }
  console.log(`${filePath} is signed by ${expectedPublisher}, and the signature is valid.`);
}
