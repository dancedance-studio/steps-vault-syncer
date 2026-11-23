// Builds the JSON body of one Discord webhook post, so post-to-discord.sh never puts text into JSON by hand.
// Usage: DISCORD_MESSAGE='Sync 0.2.0 checked ✓ · ready to ship' node discord-message.mjs > body.json
import { pathToFileURL } from 'node:url';

/** Discord refuses longer messages. */
export const DISCORD_MESSAGE_MAX_LENGTH = 2000;

/** No @everyone, @here, role or user pings, whatever the text says (a tag message is written by hand). */
export function buildDiscordBody(message) {
  const text = message.trim();
  if (text === '') throw new Error('The Discord message is empty.');
  const content = text.length <= DISCORD_MESSAGE_MAX_LENGTH ? text : `${text.slice(0, DISCORD_MESSAGE_MAX_LENGTH - 1)}…`;
  return { content, allowed_mentions: { parse: [] } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(buildDiscordBody(process.env.DISCORD_MESSAGE ?? '')));
}
