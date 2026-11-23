// "What's new" for a version is the message of its annotated tag (docs/releasing.md says how to write it). It becomes
// the GitHub release's notes and, on Ship it, the #announcements post.
// Usage: gh api repos/<owner>/<repo>/git/tags/<sha> --jq .message | node whats-new.mjs > whats-new.md
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';

/** A signed tag's message ends with its signature, which is not for players. */
export function getWhatsNew(tagMessage) {
  const signatureStart = tagMessage.search(/^-----BEGIN (PGP|SSH) SIGNATURE-----$/m);
  const message = signatureStart === -1 ? tagMessage : tagMessage.slice(0, signatureStart);
  return message.replace(/\r\n/g, '\n').trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const whatsNew = getWhatsNew(Buffer.concat(chunks).toString('utf8'));
  if (whatsNew === '') {
    console.error('The tag has no message, so the version has no "What\'s new". Tag it again with git tag -a (docs/releasing.md).');
    process.exit(1);
  }
  process.stdout.write(`${whatsNew}\n`);
}
