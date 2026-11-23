#!/usr/bin/env bash
# Posts DISCORD_MESSAGE to a Discord channel through its webhook, DISCORD_WEBHOOK_URL (a repo secret, never printed).
# The release never stops for Discord: without the secret the post is skipped with a notice, and a post Discord
# refuses is a warning. Usage: DISCORD_WEBHOOK_URL=… DISCORD_MESSAGE=… post-to-discord.sh <channel name, for the log>
set -euo pipefail
channel_name=${1:?Give the channel name, for example admins.}
if [ -z "${DISCORD_WEBHOOK_URL:-}" ]; then
  echo "::notice::Not posted to #$channel_name: its webhook secret isn't set. The message was:"
  printf '%s\n' "${DISCORD_MESSAGE:-}"
  exit 0
fi
body=$(node "$(dirname "$0")/discord-message.mjs")
if curl --fail --silent --show-error --retry 3 --max-time 30 --header 'Content-Type: application/json' --data-binary "$body" "$DISCORD_WEBHOOK_URL" > /dev/null; then
  echo "Posted to #$channel_name."
else
  echo "::warning::Discord didn't take the message for #$channel_name; the release goes on. The message was:"
  printf '%s\n' "${DISCORD_MESSAGE:-}"
fi
