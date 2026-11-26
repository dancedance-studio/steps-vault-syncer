# What Sync sends, and where

dancedance.studio Sync has no tracking, no ads and no crash reports. It sends something only to the places below, and
only for the reason given.

## dancedance.studio, once you link this computer

Nothing goes to dancedance.studio until you sign in from Sync and link the computer to your account. After that, Sync
sends:

- this computer's name, the Sync version, the link addons you have turned on (only the sites they declare), and
  whether an addon you have turned on can look for a song you pick on the website (never which addon)
- requests for your library list and your party lists, and the songs' steps and pictures
- the result of each sync: how many songs are in your game, and your game's name
- your answers to jobs you start on the website, such as "Into my game" or a song link
- the songs a community generator made on this computer (title, artist, generator, levels and when), for the website's
  "This PC" list
- a music file, only when you ask dancedance.studio to make steps for it: from Sync's own "Make a song", where Sync
  asks you first, or from a song link you paste or a song you pick on the website

The website's privacy policy covers what dancedance.studio does with it:
[dancedance.studio/help#privacy](https://dancedance.studio/help#privacy).

## Addons and generators you add

An addon or a generator is a separate program, made by anyone, that you choose to add. Sync sends it what it needs for
a song: its title, artist, album, genre, length and related video. A generator also gets the music file you choose.
Each one's own privacy policy applies.

## GitHub, to check for new versions

The installed app asks GitHub whether there is a newer version when it starts, then every 6 hours. GitHub sees your
computer's internet address and the Sync version. See
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

You can turn this off in the installer's "What Sync sends" page, or in Sync's Options with "Check for new versions
automatically". You can still check by hand with "Check for updates". With "Get test versions first", the check also
looks at test versions; GitHub sees the same. The switches come with version 0.1.0; the 0.1.0 preview always checks.
A copy run from source never checks: its updates come from git.

## On your computer

Your settings, sign-in and history stay in `%APPDATA%\dancedance.studio Sync`. The installer keeps your two answers
(check for new versions, start with Windows) in `installer-choices.json` in Sync's program folder; Sync copies them
into its settings on its first start, and from then on Options decides. Uninstalling Sync (Windows Settings › Apps)
removes the app and takes it off the programs Windows starts. To remove your settings too, delete that folder.
