#!/usr/bin/env bash
# Writes a version's "What's new", the message of its annotated tag, to a file (whats-new.mjs drops a signature).
# Fails when the tag is a plain one with no message. Needs GH_TOKEN and GITHUB_REPOSITORY.
# Usage: get-whats-new.sh v0.2.0 whats-new.md
set -euo pipefail
tag=${1:?Give the tag, for example v0.2.0.}
output_file=${2:?Give the file to write.}
tag_object=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" --jq 'select(.object.type == "tag") | .object.sha')
if [ -z "$tag_object" ]; then
  echo "::error::$tag is a plain tag with no message, so the version has no \"What's new\". Delete it and tag again with git tag -a (docs/releasing.md)."
  exit 1
fi
gh api "repos/$GITHUB_REPOSITORY/git/tags/$tag_object" --jq .message | node "$(dirname "$0")/whats-new.mjs" > "$output_file"
