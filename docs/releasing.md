# Releasing dancedance.studio Sync

Releases are built in public GitHub Actions (`.github/workflows/release.yml`). Sync isn't code signed yet
([code signing policy](code-signing-policy.md)), so a release goes out **unsigned**. The workflow also has a signed
path, through the SignPath Foundation's free plan for open-source projects; it takes over by itself once the SignPath
variables are set (see "Later: signing through SignPath"). Either way, each version goes out first as a **test
version** (a GitHub pre-release), is checked automatically on a clean Windows machine, and reaches players only when
the owner runs **Ship it** (`.github/workflows/ship-it.yml`). The app updates itself from GitHub releases.

## Make a release

1. **Tag.** Set the new version in `apps/desktop/package.json` (for example `0.2.0`) and merge that to `main`. Then tag
   that commit with an annotated tag whose message is the version's "What's new" (see below), and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -F whats-new.txt
   git push origin v0.2.0
   ```

   The tag must match the version (`v` + the version), and it must have a message, or the workflow stops at once.
2. **Wait for the test version.** The workflow checks, tests and packages the app, builds the installer, makes sure
   nothing in it is signed, and publishes the installer, `latest.yml`, the blockmap and `SHA256SUMS.txt` as a
   pre-release, about 5 minutes after the push. #admins gets "Sync 0.2.0 test version is out (unsigned)". Copies with
   "Get test versions first" in Options get it from now on.
3. **Wait for "checked ✓".** A fresh Windows machine downloads the test version and checks it (below). A few minutes
   later #admins gets "Sync 0.2.0 checked ✓ · ready to ship".
4. **Run Ship it.** In GitHub: Actions › ship-it › Run workflow, version `0.2.0`. It makes the pre-release the latest
   full release with the same files (nothing is built again), posts "Released ✓" to #admins and the What's new to
   #announcements. Every installed copy with automatic checks on finds it within 6 hours, downloads it quietly and
   shows "Restart to update". Ship it refuses a version whose automatic check didn't pass.

If the Discord webhooks aren't set up (below), nothing is posted: each message is shown as a notice in the run's log
instead. Then follow the run in Actions › release: the version is ready to ship when its `check-test-version` job is
green.

With SignPath set up, step 2 changes: the owner approves two signing requests on SignPath ("Signature needed" on
#admins, see "Later: signing through SignPath"), and the test version is published only once both are signed.

`v0.1.0-preview.1` was published by hand, from a release run that had no automatic check, and with no update file.
Ship it refuses it.

## Write "What's new"

"What's new" is the annotated tag's message. It becomes the GitHub release's notes and, on Ship it, the #announcements
post, under "**dancedance.studio Sync 0.2.0** is out.". On the release page of an unsigned version, the workflow adds
a short note under it: Sync isn't code signed yet, what Windows will say, and how to check the download. The
announcement doesn't get that note.

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
| Sync 0.2.0 test version is out (unsigned) | #admins | The unsigned test version is published; the automatic check runs next. | Wait for "checked ✓". |
| Sync 0.2.0 checked ✓ · ready to ship | #admins | The test version is published and passed the check. | Run Ship it (the message links it). |
| MISS Sync 0.2.0 check failed: *step* | #admins | The test version is published but failed the check at that step. Players don't get it. | See "Try again", below. |
| MISS Sync v0.2.0 stopped at *job* | #admins | The release stopped before publishing (tests, the build, or with SignPath a denied or late approval). Nothing is published. | See "Try again", below. |
| Released ✓ Sync 0.2.0 is out for everyone | #admins | Ship it made it the latest full release. | Nothing. |
| **dancedance.studio Sync 0.2.0** is out. … | #announcements | The What's new, for players. | Nothing. |
| Signature needed: Sync 0.2.0 → Approve on SignPath · 1 of 2: the programs inside the app | #admins | Signed releases only: SignPath waits for your approval. | Open the link, check it is the tag you pushed, approve. |
| Signature needed: … · 2 of 2: the installer | #admins | Signed releases only: the installer made from the signed app waits. | Approve it too. |

## The automatic check

On a fresh `windows-latest` machine, from the published pre-release:

- the signatures: for an unsigned release, the installer and the installed `.exe` have no signature at all, so a
  half-signed build fails; for a signed one, both signatures are valid and the publisher is "SignPath Foundation"
- `latest.yml` names the installer with its exact size and SHA-512, and `SHA256SUMS.txt` matches every file
- a silent per-user install (`/S`) works, with both "What Sync sends" answers on
- for an unsigned release, the installed app's `resources\app-update.yml` points at this repo's GitHub releases and
  names no `publisherName` (see "Updates without a signature")
- the installer and the app say "dancedance.studio Sync" and the version in their file details
- the installed app starts and reports its version (`--print-version`, which opens no window)
- a silent uninstall removes the app, its entry in Apps and the `dancedance-sync` link scheme

Before anything is published, the build job already makes sure that nothing in an unsigned build is signed (with
SignPath, that the signed installer's publisher is right). The install part is
`apps/desktop/scripts/check-installer.ps1`. Never run it on a computer you use: it installs and uninstalls Sync for the
current user.

## Updates without a signature

The installed app's updater (electron-updater) checks a downloaded installer's signature only when the app's
`resources\app-update.yml` names a `publisherName`. electron-builder writes one only when it signs the app with a
certificate itself (`CSC_LINK`, `win.signtoolOptions.publisherName` or `win.azureSignOptions`). This repo's builds have
none of these: SignPath signs outside electron-builder. So no copy asks for a signature, and an unsigned copy takes an
unsigned update (or, later, a signed one). Every download is still checked against the SHA-512 in its release's
`latest.yml`, and updates come only from this repo's GitHub releases. The automatic check fails an unsigned release
whose `app-update.yml` names a publisher, because that copy would refuse every unsigned update.

If a certificate is ever set up inside electron-builder, copies built from then on refuse any update that isn't signed
by that publisher: from then on, never release unsigned again.

## Try again

- **Tests or the build failed** ("stopped at building and testing", or "stopped at building the installer"): nothing is
  published. Fix it on `main`, delete the tag (`git push --delete origin v0.2.0` and `git tag -d v0.2.0`), and tag the
  fixed commit again.
- **A signing request was denied, or not approved in time** (with SignPath; "stopped at signing …"): in GitHub, open
  the run and choose "Re-run failed jobs". A new signing request comes to #admins; approve it.
- **Publishing failed**: if a half-made release exists, delete the release on GitHub (not the tag), then "Re-run failed
  jobs".
- **The check failed** ("check failed: *step*"): open the run and read that step. If GitHub's machine had a hiccup,
  "Re-run failed jobs" checks again. If the version itself is broken, delete its pre-release, fix the problem and
  release the next version (`0.2.1`). Never publish a version number twice: test copies may already have it.
- **Ship it failed**: read the error. It is safe to run again; it refuses a version that is already a full release.

## A test build (a manual run)

Actions › release › Run workflow (on any branch) builds the unsigned installer, keeps it with `latest.yml`, the
blockmap and `SHA256SUMS.txt` for 7 days as the artifact `release-files`, and runs the same automatic check on a clean
machine, from those files instead of a release. It is never published or signed, and it posts nothing to Discord.

## Run from source

A copy run from source (for example the owner's game PC) gets its updates from git, not GitHub releases: Options shows
"Running from source · updates come from git", without the update button and switches. "Start Sync when Windows
starts" works there too: Windows starts the Electron program with the app folder, listed as "dancedance.studio Sync
(from source)" in Task Manager › Startup apps. The app folder is the one that last ran with the switch on.

## Set up (once)

### Discord

Create a webhook in #admins and one in #announcements (channel settings › Integrations › Webhooks), and add their URLs
as the repo secrets `DISCORD_ADMINS_WEBHOOK_URL` and `DISCORD_ANNOUNCEMENTS_WEBHOOK_URL`. Never paste them anywhere
else.

### Later: signing through SignPath

The workflow signs every tag once the variable `SIGNPATH_ORGANIZATION_ID` is set, and no longer publishes unsigned
builds; no code change is needed. Until then, tags go out unsigned. When Sync is signed, update
[the code signing policy](code-signing-policy.md), the README's Download section and this page.

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

With SignPath, step 2 of "Make a release" is:

- **Approve on SignPath.** The workflow checks, tests and packages the app, then asks SignPath to sign every program
  inside it. #admins gets "Signature needed: Sync 0.2.0 → Approve on SignPath · 1 of 2". Open the link and approve.
  A few minutes later the installer is built from the signed app, and "2 of 2: the installer" asks again. Each request
  waits up to 5½ hours for you. Then the signed files are published as the test version.

## Known gaps

- **Sync isn't code signed.** Windows says "unknown publisher" when the installer starts, and PCs with Smart App
  Control block it; players there use Sync in the browser on dancedance.studio.
- **With SignPath, the uninstaller is still not signed.** NSIS makes it while building the installer, so it can't go
  through SignPath before the installer is assembled. Windows may warn when the app is uninstalled.
- **The installer is about 110 MB**, mostly the Chromium runtime that Electron ships.
