# Code signing policy

**dancedance.studio Sync isn't code signed yet.** Its installer and the programs inside it carry no signature, so
Windows can't tell you who made them. We plan to apply for code signing again, and this page will say when that
changes. Until then, you can check a download yourself (below).

## What you will see on Windows

- **"Windows protected your PC".** Windows usually stops the installer and shows its publisher as **Unknown
  publisher**. Choose **More info**, then **Run anyway**. Do this only for an installer you got from
  [dancedance.studio/sync/about](https://dancedance.studio/sync/about) or this repo's
  [releases](https://github.com/dancedance-studio/sync/releases), best after checking it.
- **Smart App Control.** A PC with Smart App Control on blocks programs that aren't signed, with no **Run anyway**.
  On such a PC, use Sync in the browser on [dancedance.studio](https://dancedance.studio) instead (Chrome or Edge).
- **Updates.** The installed app updates itself only from this repo's GitHub releases, and checks each download
  against the SHA-512 in that release's `latest.yml`. It checks no signature, because there is none yet.

## Check a download

Every release is built by the release workflow ([.github/workflows/release.yml](../.github/workflows/release.yml)) in
public GitHub Actions, from a tagged commit of this repo. From 0.1.0 on, each release also has `SHA256SUMS.txt`: the
SHA-256 of the installer, `latest.yml` and the blockmap.

1. Download the installer and `SHA256SUMS.txt` from the same release.
2. In PowerShell, in the folder you downloaded them to, run (with the installer's real name):

   ```powershell
   Get-FileHash .\dancedance-studio-Sync-Setup-0.1.0.exe
   ```

3. The hash it shows must be the one on the installer's line in `SHA256SUMS.txt` (PowerShell writes it in capitals).

The same sums are printed in the public log of the run that built the release: in this repo's
[Actions](https://github.com/dancedance-studio/sync/actions/workflows/release.yml), open the "release" run whose branch
is the version's tag (for example `v0.1.0`), then its job `build-installer` (`sign-installer` for a signed release). A
run's log can't be edited afterwards, and it shows the commit it was built from, so a match there means your file is
the one GitHub's machine built from that commit. GitHub keeps the log for 90 days.

## What gets built and published

- Only the Windows installer that the release workflow built from a tagged commit, on GitHub Actions, is published.
  Nothing built on a personal computer is ever published.
- A new version goes out first as a test version (a GitHub pre-release) and is checked automatically on a clean
  Windows machine, which also makes sure that nothing in it is signed, so a half-signed build is caught. Players get
  it only after an approver releases it.
- Once Sync is code signed, every signing request will be approved by hand by an approver before anything is signed.
  The release workflow is ready for it.

## Team roles

| Role | Who |
|---|---|
| Committers and reviewers | [Members of the dancedance-studio organisation](https://github.com/orgs/dancedance-studio/people) |
| Approvers | [Owners of the dancedance-studio organisation](https://github.com/orgs/dancedance-studio/people?query=role%3Aowner) |

- Changes from anyone outside the organisation (pull requests) are reviewed by a member before they are merged.
- Approvers release each version to players and, once Sync is code signed, approve each signing request.
- Every team member uses two-step login (multi-factor authentication) on GitHub.

## Privacy

[What Sync sends, and where](privacy.md). Sync sends nothing to anyone until you choose to: link it to your
dancedance.studio account, add an addon or a generator, or leave its automatic update check on.

The website's own privacy policy: [dancedance.studio/help#privacy](https://dancedance.studio/help#privacy).
