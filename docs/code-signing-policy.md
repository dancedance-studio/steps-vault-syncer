# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

Windows shows the publisher of dancedance.studio Sync as **SignPath Foundation**.

## What gets signed

- Only the Windows installer and the program files inside it, built from a tagged commit of this repo by the release
  workflow ([.github/workflows/release.yml](../.github/workflows/release.yml)) on GitHub Actions. Nothing built on a
  personal computer is ever signed.
- Every signing request is approved by hand by an approver before anything is signed.
- A new version goes out first as a test version. Players get it only after the approver releases it.

## Team roles

| Role | Who |
|---|---|
| Committers and reviewers | [Members of the dancedance-studio organisation](https://github.com/orgs/dancedance-studio/people) |
| Approvers | [Owners of the dancedance-studio organisation](https://github.com/orgs/dancedance-studio/people?query=role%3Aowner) |

- Changes from anyone outside the organisation (pull requests) are reviewed by a member before they are merged.
- Every team member uses two-step login (multi-factor authentication) on GitHub and on SignPath.

## Privacy

[What Sync sends, and where](privacy.md). Sync sends nothing to anyone until you choose to: link it to your
dancedance.studio account, add an addon or a generator, or leave its automatic update check on.

The website's own privacy policy: [dancedance.studio/help#privacy](https://dancedance.studio/help#privacy).
