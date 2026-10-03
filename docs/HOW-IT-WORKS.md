# Fightcord

Discord-style Fightcade, as one installer: **`dist\FightcordSetup.exe`** (about 650 KB, no other
downloads, runs on any Windows 10/11).

## What it installs

| Plugin | What it does |
|---|---|
| `discord-theme.js` | Discord look, presets (Dark / AMOLED / Classic), accent colour |
| `discover.js` | the search tab: sidebar, spotlight, instant search, game pages, Live now, results |
| `chat-extras.js` | mentions, NEW line, hover actions, link previews, jump to present, timestamps |
| `translate.js` | auto-translate incoming chat |
| `emoji.js` / `fontstyle.js` | `:emoji:` shortcodes, chat font styles |
| `fightcord.js` | the Fightcord settings screen (Ctrl+,) and the updater |
| `member-list.js` | Discord role groups, filters, sort, ping / Wi-Fi / VPN, #leaderboard spots |
| `scout.js` | opponent profile card: ELO (real or estimated), win odds, leaderboard spot |
| `challenge-filters.js` | Off / Warn / Decline rules for incoming challenges |
| `stats.js` | Your stats page (+ import your Fightcade history) |
| `match-screens.js` | VS / YOU WON! / YOU LOST! screens, session tracker, streaks |
| `discord-rpc.js` | Discord Rich Presence (+ its `node_modules`) |
| `snapshot.js` | dev helper: Ctrl+Shift+S saves the page for offline work |

Sources: `src/` and `rpc/`. See the README there for
each plugin's details.

## How it hooks into Fightcade

Fightcade's desktop app (a nativefier build) runs exactly one file at startup:
`<Fightcade>\fc2-electron\resources\app\inject\inject.js`. Fightcord puts its own small loader
there (`loader\inject.js`), which loads everything in `inject\fightcord\` once Fightcade's app is
up. Settings, match history and sounds live next to the plugins in that folder.

`inject\fightcord\fightcord.json`: `{"version", "disabled": false, "off": ["snapshot.js"]}` —
`disabled` turns all of Fightcord off (also in Fightcade's Settings → Fightcord), `off` skips
single plugins.

## The installer

* Finds Fightcade on its own (Documents, OneDrive, C:\Fightcade…, or a running Fightcade); Browse
  if it's somewhere else.
* **Install** — if Cerberus / the old "FC2 Injector" loader is there, it is **moved** (not copied)
  to `resources\app\fightcord-backup\<date-time>\`, your settings, match history, sounds and
  snapshots are brought into `inject\fightcord\`, then Fightcord is unpacked.
* **Update / Repair** — the same button once installed; keeps your settings and switches.
* **Uninstall** — keeps your settings in `fightcord-backup\uninstall-<date-time>\`, removes
  Fightcord, and can put the previous setup (Cerberus) back.
* Fightcade must be closed; the installer offers to close it, but never while an emulator is
  running (a match).
* No admin rights. The .exe isn't code-signed, so Windows SmartScreen may say "Windows protected
  your PC" the first time: More info → Run anyway.

Command line (used for testing):
`FightcordSetup.exe --root=<Fightcade folder> --install | --uninstall [--restore] [--log=<file>]`

## Settings and updates

Everything is configured in one Discord-style screen: **Ctrl+,**, the gear in the Discover sidebar,
`/fightcord` in chat, or Fightcade's Settings → "Open Fightcord settings". Each section is a
`.frontendOptions` host, so every plugin puts its own settings block there; Fightcade's page keeps
only the on/off switch and the button. My Fightcord switches single plugins on/off (`off[]`).

**Updates** come from GitHub Releases of `JillTheStingray/fightcord`: `fightcord.js` reads
`releases/latest/download/latest.json` once a day (or "Check for updates"), downloads the named zip
from that same repo, checks its sha256, unpacks it with a built-in ZIP reader into `.update\` and
moves the `.js` files into place (plus `inject.js` if it's the Fightcord loader). It applies on the
next start. Nothing else is ever downloaded or written. State: `fightcord-state.json`.

### Making a release

1. Bump `Version` (and the two assembly attributes) in `installer\FightcordSetup.cs`.
2. `powershell -ExecutionPolicy Bypass -File build.ps1 -Release -Notes "what changed"` →
   `dist\FightcordSetup.exe`, `dist\fightcord-<ver>-update.zip`, `dist\latest.json`.
3. `gh release create v<ver> dist\FightcordSetup.exe dist\fightcord-<ver>-update.zip dist\latest.json
   --repo JillTheStingray/fightcord --notes "..."`.

Never publish `src/dev-harness/snapshots/` — snapshots hold real chat, names and the
account email.

## Building

```bash
powershell -ExecutionPolicy Bypass -File build.ps1
```

Collects the plugins, `node --check`s them, strips native-build leftovers from `node_modules`
(their deep paths hit Windows' 260-character limit), zips everything into the installer as a
resource and compiles `installer\FightcordSetup.cs` with the .NET Framework 4 C# compiler that
ships with Windows (C# 5, so no newer syntax). The .cs file is kept ASCII-only.
`installer\make_icon.py` redraws the icon (needs Pillow).

Bump the version in `installer\FightcordSetup.cs` (`Version` + the assembly attributes).
