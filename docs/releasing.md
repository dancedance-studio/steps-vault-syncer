# Releasing dancedance.studio Sync

Releases are built in public GitHub Actions (`.github/workflows/release.yml`) and signed through the SignPath
Foundation's free plan for open-source projects; the owner approves every signing by hand. Each version goes out first
as a **test version** (a GitHub pre-release), is checked automatically on a clean Windows machine, and reaches players
only when the owner runs **Ship it** (`.github/workflows/ship-it.yml`). The app updates itself from GitHub releases.

## Make a release

1. **Tag.** Set the new version in `apps/desktop/package.json` (for example `0.2.0`) and merge that to `main`. Then tag
   that commit with an annotated tag whose message is the version's "What's new" (see below), and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -F whats-new.txt
   git push origin v0.2.0
   ```

   The tag must match the version (`v` + the version), and it must have a message, or the workflow stops at once.
2. **Approve on SignPath.** The workflow checks, tests and packages the app, then asks SignPath to sign every program
   inside it. #admins gets "Signature needed: Sync 0.2.0 → Approve on SignPath · 1 of 2". Open the link and approve.
   A few minutes later the installer is built from the signed app, and "2 of 2: the installer" asks again. Each
   request waits up to 5½ hours for you.
3. **Wait for "checked ✓".** The signed installer, `latest.yml`, the blockmap and `SHA256SUMS.txt` are published as a
   pre-release. Copies with "Get test versions first" in Options get it from now on. A fresh Windows machine then
   downloads it and checks it (below). #admins gets "Sync 0.2.0 checked ✓ · ready to ship".
4. **Run Ship it.** In GitHub: Actions › ship-it › Run workflow, version `0.2.0`. It makes the pre-release the latest
   full release with the same files (nothing is built or signed again), posts "Released ✓" to #admins and the What's
   new to #announcements. Every installed copy with automatic checks on finds it within 6 hours, downloads it quietly
   and shows "Restart to update". Ship it refuses a version whose automatic check didn't pass.

`v0.1.0-preview.1` is the one exception: it was published by hand, unsigned, for the SignPath application, with no
update file. Nothing unsigned is ever published by the workflow.

## Write "What's new"

"What's new" is the annotated tag's message. It becomes the GitHub release's notes and, on Ship it, the #announcements
post, under "**dancedance.studio Sync 0.2.0** is out.".

- Write it for players, in simple English: what they will notice, one short line each. No version-control talk.
- The first line is a short title; then a blank line, then the changes as `- ` lines. Discord and GitHub both show
  Markdown.
- Keep it under 1,800 characters (a Discord post holds 2,000 with the title).
- Never name a video or music site; say "songs from the web".
- Read it twice before you push the tag: the announcement uses the tag's message as it is. A fix to the release notes
  on GitHub doesn't reach #announcements.

```text
Options, and start with Windows

- Options shows your version, with Check for updates.
- Turn off the automatic check for new versions, or get test versions first.
- Sync can start when Windows starts.
```

A plain tag (`git tag v0.2.0`, without `-a`) has no message: delete it (`git push --delete origin v0.2.0` and
`git tag -d v0.2.0`) and tag again.

## What the Discord messages mean

The workflows post through two webhooks kept as repo secrets: `DISCORD_ADMINS_WEBHOOK_URL` (#admins) and
`DISCORD_ANNOUNCEMENTS_WEBHOOK_URL` (#announcements). When a secret is missing, the post is skipped and the run's log
shows a notice with the message. A post Discord refuses is a warning; the release never stops for Discord.

| Message | Channel | Means | Do |
|---|---|---|---|
| Signature needed: Sync 0.2.0 → Approve on SignPath · 1 of 2: the programs inside the app | #admins | SignPath waits for your approval. | Open the link, check it is the tag you pushed, approve. |
| Signature needed: … · 2 of 2: the installer | #admins | The installer made from the signed app waits. | Approve it too. |
| Sync 0.2.0 checked ✓ · ready to ship | #admins | The test version is published and passed the check. | Run Ship it (the message links it). |
| MISS Sync 0.2.0 check failed: *step* | #admins | The test version is published but failed the check at that step. Players don't get it. | See "Try again", below. |
| MISS Sync v0.2.0 stopped at *job* | #admins | The release stopped before publishing (tests, a denied or late approval, the build). Nothing is published. | See "Try again", below. |
| Released ✓ Sync 0.2.0 is out for everyone | #admins | Ship it made it the latest full release. | Nothing. |
| **dancedance.studio Sync 0.2.0** is out. … | #announcements | The What's new, for players. | Nothing. |

## The automatic check

On a fresh `windows-latest` machine, from the published pre-release:

- the installer's Authenticode signature is valid, and its publisher is "SignPath Foundation"
- `latest.yml` names the installer with its exact size and SHA-512, and `SHA256SUMS.txt` matches every file
- a silent per-user install (`/S`) works, with both "What Sync sends" answers on
- the installed `.exe` is signed by SignPath Foundation too
- the installer and the app say "dancedance.studio Sync" and the version in their file details
- the installed app starts and reports its version (`--print-version`, which opens no window)
- a silent uninstall removes the app, its entry in Apps and the `dancedance-sync` link scheme

The install part is `apps/desktop/scripts/check-installer.ps1`. Never run it on a computer you use: it installs and
uninstalls Sync for the current user.

## Try again

- **Tests or the build failed** ("stopped at building and testing"): nothing is published. Fix it on `main`, delete
  the tag (`git push --delete origin v0.2.0` and `git tag -d v0.2.0`), and tag the fixed commit again.
- **A signing request was denied, or not approved in time** ("stopped at signing …"): in GitHub, open the run and
  choose "Re-run failed jobs". A new signing request comes to #admins; approve it.
- **Publishing failed**: if a half-made release exists, delete the release on GitHub (not the tag), then "Re-run failed
  jobs".
- **The check failed** ("check failed: *step*"): open the run and read that step. If GitHub's machine had a hiccup,
  "Re-run failed jobs" checks again. If the version itself is broken, delete its pre-release, fix the problem and
  release the next version (`0.2.1`). Never publish a version number twice: test copies may already have it.
- **Ship it failed**: read the error. It is safe to run again; it refuses a version that is already a full release.

## A test build without SignPath

Actions › release › Run workflow (on any branch) builds an unsigned installer, keeps it for 7 days as the artifact
`test-build-unsigned`, and runs the same install check on a clean machine without the signature steps. It is never
published, and it posts nothing to Discord. A tag pushed while SignPath isn't set up does the same. Windows' Smart App
Control blocks unsigned programs, so the installer won't run on most players' computers.

## Run from source

A copy run from source (for example the owner's game PC) gets its updates from git, not GitHub releases: Options shows
"Running from source · updates come from git", without the update button and switches. "Start Sync when Windows
starts" works there too: Windows starts the Electron program with the app folder, listed as "dancedance.studio Sync
(from source)" in Task Manager › Startup apps. The app folder is the one that last ran with the switch on.

## Set up (once)

### SignPath

1. Apply at https://signpath.org for this repo (issue #14). SignPath needs an OSI licence (Apache-2.0), a public repo
   and builds in public CI, all of which are in place.
2. In SignPath, create the project with two artifact configurations:
   - `app-folder`: a zip of the app folder; sign every `.exe` and `.dll` inside it (deep signing);
   - `installer`: a zip holding only the installer `.exe`; sign that file.
3. Link the project to this repo as a "trusted build system" (GitHub Actions), and create a signing policy whose every
   request needs a manual approval by an approver (docs/code-signing-policy.md).
4. In this repo's Settings › Secrets and variables › Actions, add:
   - the secret `SIGNPATH_API_TOKEN` (a SignPath user who may submit signing requests);
   - the variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY_SLUG`.

### Discord

Create a webhook in #admins and one in #announcements (channel settings › Integrations › Webhooks), and add their URLs
as the repo secrets `DISCORD_ADMINS_WEBHOOK_URL` and `DISCORD_ANNOUNCEMENTS_WEBHOOK_URL`. Never paste them anywhere
else.

## Known gaps

- **The uninstaller is not signed.** NSIS makes it while building the installer, so it can't go through SignPath
  before the installer is assembled. Windows may warn when the app is uninstalled.
- **The installer is about 110 MB**, mostly the Chromium runtime that Electron ships.
