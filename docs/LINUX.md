# Fightcord on Linux

Fightcade for Linux is the same app underneath: the official tarball from
[fightcade.com/download/linux](https://www.fightcade.com/download/linux) ships the same
`fc2-electron/resources/app/` tree, runs `inject/inject.js` at startup and keeps the emulators in
`emulator/`. Fightcord therefore runs there unchanged; only the installer and the few places that
talked to Windows needed a Linux path.

## Install

Download `fightcord-<version>-linux.tar.gz` from the release, then:

```sh
tar xzf fightcord-<version>-linux.tar.gz
cd fightcord-<version>-linux
./install.sh --install
```

The installer finds Fightcade by itself (the folder with `Fightcade2.sh` and `fc2-electron/`, a
running Fightcade, or the Flatpak build) and asks before changing anything. If it guesses wrong:

```sh
./install.sh --install --root="$HOME/Fightcade"
```

Close Fightcade first; the installer refuses to touch it while the app or an emulator is open
(`--force` overrides that, but a match may write its settings back on exit).

Update by running a newer installer the same way, or let Fightcord update itself: the in-app
updater ships the same JavaScript files on every system and works on Linux.

Uninstall:

```sh
./install.sh --uninstall            # keeps your settings in fightcord-backup/uninstall-<time>/
./install.sh --uninstall --restore  # ...and puts the setup that was there before Fightcord back
```

Options: `--root=<folder>`, `--log=<file>`, `--yes`, `--force`, `--help`.

## What is different on Linux

| Area | Behaviour |
|---|---|
| Emulator detection | Reads `/proc` (or `ps`) instead of `tasklist`, so a running Wine `fcadefbneo.exe` is still recognised and Fightcord will not offer to restart mid-match |
| Discord status | Uses the `discord-ipc-*` socket in `$XDG_RUNTIME_DIR`; process detection is ported. If Discord itself is a Flatpak, its socket may live in another sandbox and the status stays offline |
| Fight stats (parries, supers, perfect rounds) | **Off.** The reader compiles C# with Windows PowerShell and reads the emulator's Windows process memory; there is no equivalent on Linux yet. Training goals still work for every other goal type, and the goals screen says why 3rd Strike goals are unavailable |
| Everything else | The UI, chat, Discover, stats, lobbies, voice, uploads and the updater are plain JavaScript inside Fightcade's Electron app and are unchanged |

Settings, match history and sounds stay in `inject/fightcord/`, next to the modules, exactly as on
Windows. `fc2-electron/resources/app/fightcord-backup/` holds the previous loader (if any) and the
uninstall copies.

## Flatpak

The Flatpak package is **not moddable yet**. It installs Fightcade under `/app`, which is
read-only, and its Flathub manifest only exposes a fixed list of files as writable; the inject
folder is not one of them. `install.sh` detects this and says so instead of failing halfway.

Making it work needs a change in the Flathub packaging (a separate repository):

1. symlink `fc2-electron/resources/app/inject` to `/var/data/inject` (the directory Flatpak keeps
   across updates) and `emulator/fbneo/ui` to `/var/data/ui`, and
2. create those directories when the app starts, seeding `ui` from the shipped artwork.

The installer already understands that layout: once `inject/` is writable it installs into it the
same way as into the tarball, and it maps `/var/data/...` to
`~/.var/app/com.fightcade.Fightcade/data/...` because a host process can't follow the Flatpak's
`/var/data`. Until then, use the official tarball.

## Build

```sh
./build.sh
```

This mirrors `build.ps1`: it reads the module list and the version from the same files, installs
`rpc/node_modules` when needed, syntax-checks every `.js`, runs `src/tests/*.test.js`, stages
`payload/` and writes `dist/fightcord-<version>-linux.tar.gz`.

`./build.sh --release` additionally writes `dist/fightcord-<version>-update.zip` and
`dist/latest.json` for a GitHub release. Those are the files the in-app updater reads on every
system; `latest.json` also names the Linux tarball in its `linux` field.
