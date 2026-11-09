#!/usr/bin/env bash
# Fightcord on Linux - installs / updates / uninstalls Fightcord in Fightcade.
#
# Fightcade for Linux (the official tarball from fightcade.com) has the same tree as the
# Windows app: it runs resources/app/inject/inject.js at startup. This puts Fightcord's
# loader there and its modules in inject/fightcord/, exactly like FightcordSetup.exe does
# on Windows, and keeps whatever was there before in resources/app/fightcord-backup/.
#
# The Flatpak package keeps Fightcade under /app, which is read-only: a mod cannot be
# installed there until the Flathub manifest exposes inject/ as writable. This script
# detects that case and explains it instead of failing halfway.
#
# Usage:
#   ./install.sh --install   [--root=<Fightcade folder>] [--log=<file>] [--yes]
#   ./install.sh --uninstall [--root=<Fightcade folder>] [--restore] [--log=<file>] [--yes]
#
#   --root=<folder>  the folder that has Fightcade2.sh and fc2-electron/ (found automatically)
#   --restore        with --uninstall: put the setup that was there before Fightcord back
#   --force          also run while Fightcade (or a match) is open - not recommended
#   --yes            never ask (the script only asks for confirmation without it)
#   --log=<file>     also write everything to a file
#
# Build the folder this script lives in with: ./build.sh

set -u

SELF=$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")
HERE=$(cd "$(dirname "$SELF")" && pwd)
PAYLOAD="$HERE/payload"

MODE=""
ROOT=""
RESTORE=0
FORCE=0
YES=0
LOG=""

MARKER='/* Fightcord loader */'
DATA_FILES=(
    chat-extras-config.json discord-theme-config.json discover-config.json emoji-config.json
    fontstyle-config.json match-screens-config.json member-list-config.json scout-config.json
    translate-config.json discord-rpc-config.json match-history.json
    challenge-filters-config.json fightcord-state.json
    friends-config.json notes-config.json challenge-card-config.json channel-banner-config.json
    hover-cards-config.json backgrounds-config.json music-config.json fightcord-core-config.json
    theme-background.png theme-background.jpg theme-background.gif theme-background.webp
    rank-history.json goals-config.json progress-config.json analytics-config.json
    feed-config.json feed-history.json welcome-config.json events-config.json
    find-match-config.json streamer-config.json login-screen-config.json emu-skin-config.json
    fight-stats-config.json
)

say() { printf '%s\n' "$*"; }
log() { printf '%s\n' "$*"; }
fail() { printf 'Fightcord: %s\n' "$*" >&2; exit 1; }

sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

usage() {
    cat <<'EOF'
Fightcord on Linux

  ./install.sh --install   [--root=<Fightcade folder>] [--log=<file>] [--yes]
  ./install.sh --uninstall [--root=<Fightcade folder>] [--restore] [--log=<file>] [--yes]

  --root=<folder>  the folder with Fightcade2.sh and fc2-electron/ (found automatically)
  --restore        with --uninstall: put the setup that was there before Fightcord back
  --force          run even while Fightcade or a match is open (not recommended)
  --yes            do not ask for confirmation
  --log=<file>     also write everything to a file

Fightcade from the official Linux tarball can be modded. The Flatpak build is read-only
until its Flathub manifest makes inject/ writable; this script says so if it finds one.
EOF
}

# ---------------------------------------------------------------- arguments

while [ $# -gt 0 ]; do
    case "$1" in
        --install) MODE=install ;;
        --uninstall) MODE=uninstall ;;
        --restore) RESTORE=1 ;;
        --force) FORCE=1 ;;
        --yes|-y) YES=1 ;;
        --root=*) ROOT=${1#*=} ;;
        --root) shift; [ $# -gt 0 ] || fail "--root needs a folder"; ROOT=$1 ;;
        --log=*) LOG=${1#*=} ;;
        --log) shift; [ $# -gt 0 ] || fail "--log needs a file"; LOG=$1 ;;
        --help|-h) usage; exit 0 ;;
        *) fail "unknown option: $1 (try --help)" ;;
    esac
    shift
done

if [ -z "$MODE" ]; then
    usage
    exit 0
fi

if [ -n "$LOG" ]; then
    LOG=$(readlink -f "$LOG" 2>/dev/null || printf '%s' "$LOG")
    exec > >(tee -a "$LOG") 2>&1
fi

# ------------------------------------------------------------- what is here

is_fightcade() {
    [ -n "$1" ] && [ -f "$1/fc2-electron/resources/app/lib/preload.js" ]
}

proc_cmdline() {
    { tr '\0' ' ' < "/proc/$1/cmdline"; } 2>/dev/null || true
}

# PIDs whose command line contains the literal text (no grep: its own command line would match)
proc_matching() {
    local d pid cmd
    for d in /proc/[0-9]*; do
        pid=${d#/proc/}
        cmd=$(proc_cmdline "$pid")
        case "$cmd" in
            *"$1"*) printf '%s\n' "$pid" ;;
        esac
    done
}

fightcade_running() { [ -n "$(proc_matching '/fc2-electron/fc2-electron')" ]; }

emulator_running() {
    local d pid cmd
    for d in /proc/[0-9]*; do
        pid=${d#/proc/}
        cmd=$(proc_cmdline "$pid")
        case "$cmd" in
            *fcadefbneo*|*flycast*|*ggpofba*|*fcadesnes*|*fcv39*|*duckstation*) return 0 ;;
        esac
    done
    return 1
}

# the running Fightcade's folder: .../fc2-electron/fc2-electron -> ...
root_from_processes() {
    local pid exe cwd
    for pid in $(proc_matching '/fc2-electron/fc2-electron'); do
        exe=$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)
        case "$exe" in
            */fc2-electron/fc2-electron)
                printf '%s\n' "${exe%/fc2-electron/fc2-electron}"
                return 0 ;;
        esac
        cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
        if is_fightcade "$cwd"; then printf '%s\n' "$cwd"; return 0; fi
    done
    return 1
}

# the Flatpak build lives under /app (read-only on the host); --show-location gives its files
root_from_flatpak() {
    command -v flatpak >/dev/null 2>&1 || return 1
    flatpak info com.fightcade.Fightcade >/dev/null 2>&1 || return 1
    local loc candidate
    loc=$(flatpak info --show-location com.fightcade.Fightcade 2>/dev/null || true)
    [ -n "$loc" ] || return 1
    for candidate in "$loc/files/fightcade/Fightcade" "$loc/fightcade/Fightcade"; do
        if is_fightcade "$candidate"; then printf '%s\n' "$candidate"; return 0; fi
    done
    return 1
}

find_fightcade() {
    local candidate dirs
    dirs=(
        "${FIGHTCADE_ROOT:-}"
        "$HOME/Fightcade"
        "$HOME/Fightcade2"
        "$HOME/Games/Fightcade"
        "$HOME/games/Fightcade"
        "$HOME/Documents/Fightcade"
        "$HOME/Documents/Fightcade2"
        "$HOME/.local/share/Fightcade"
        "/opt/Fightcade"
        "/usr/local/Fightcade"
        "$PWD/Fightcade"
    )
    for candidate in "${dirs[@]}"; do
        [ -n "$candidate" ] || continue
        if is_fightcade "$candidate"; then printf '%s\n' "$candidate"; return 0; fi
    done
    if candidate=$(root_from_processes); then printf '%s\n' "$candidate"; return 0; fi
    if candidate=$(root_from_flatpak); then printf '%s\n' "$candidate"; return 0; fi
    return 1
}

# ------------------------------------------------------------------- setup

[ -n "$ROOT" ] || ROOT=$(find_fightcade) || fail "Fightcade folder not found - pass --root=<folder>"
ROOT=$(readlink -f "$ROOT" 2>/dev/null || printf '%s' "$ROOT")
is_fightcade "$ROOT" || fail "$ROOT doesn't look like Fightcade (expected fc2-electron/resources/app/lib/preload.js)"

APP="$ROOT/fc2-electron/resources/app"
INJECT="$APP/inject"
BK_ROOT="$APP/fightcord-backup"

# Flatpak keeps /app read-only and exposes the writable folders as absolute symlinks to
# /var/data (the app's data directory). From the host that target is
# ~/.var/app/com.fightcade.Fightcade/data, so use that path directly: a host process can't
# follow /var/data/inject. The Flathub manifest has to create these symlinks (docs/LINUX.md).
FLATPAK=0
FLATPAK_DATA="$HOME/.var/app/com.fightcade.Fightcade/data"
if [ -L "$INJECT" ]; then
    case "$(readlink "$INJECT")" in
        /var/data/inject)
            FLATPAK=1
            INJECT="$FLATPAK_DATA/inject"
            BK_ROOT="$FLATPAK_DATA/fightcord-backup"
            ;;
        *) fail "$INJECT points somewhere Fightcord does not know - nothing was changed" ;;
    esac
fi

FCDIR="$INJECT/fightcord"
OLD_PLUGINS="$INJECT/plugins"
MANIFEST="$FCDIR/fightcord.json"
EMU_UI="$ROOT/emulator/fbneo/ui"
if [ -L "$EMU_UI" ]; then
    case "$(readlink "$EMU_UI")" in
        /var/data/ui) EMU_UI="$FLATPAK_DATA/ui" ;;
    esac
fi

if [ "$FLATPAK" = 1 ]; then
    mkdir -p "$INJECT" "$BK_ROOT" 2>/dev/null || fail "could not create $INJECT (is the Flatpak data folder writable?)"
    [ -w "$INJECT" ] || fail "$INJECT is not writable"
elif [ ! -w "$APP" ]; then
    if ! mkdir -p "$INJECT" 2>/dev/null || [ ! -w "$INJECT" ]; then
        case "$ROOT" in
            /var/lib/flatpak/*|"$HOME"/.local/share/flatpak/*)
                cat >&2 <<EOF
Fightcord: this Fightcade is read-only (the Flatpak build).

The Flathub package installs Fightcade under /app and only exposes a few files as
writable, so a mod cannot be added there yet. Use the official Linux tarball from
https://www.fightcade.com/download/linux for now, or see docs/LINUX.md for the
Flatpak status. Nothing was changed.
EOF
                exit 1 ;;
            *) fail "$ROOT is not writable - run the installer as the folder's owner or pick another folder" ;;
        esac
    fi
fi

if [ "$MODE" = install ]; then
    [ -f "$PAYLOAD/inject.js" ] || fail "payload/inject.js is missing - build the folder with ./build.sh"
    [ -f "$PAYLOAD/fightcord/fightcord-core.js" ] || fail "payload/fightcord is missing - build the folder with ./build.sh"
    VERSION=$(cat "$PAYLOAD/version" 2>/dev/null || printf '?')
fi

if ! fightcade_running && ! emulator_running; then
    :
elif [ "$FORCE" = 0 ]; then
    fail "Fightcade or a match is open - close it first (or pass --force)"
fi

if [ "$YES" = 0 ] && [ -t 0 ]; then
    if [ "$MODE" = install ]; then
        printf 'Install Fightcord %s into %s? [y/N] ' "${VERSION:-?}" "$ROOT"
    else
        printf 'Remove Fightcord from %s? [y/N] ' "$ROOT"
    fi
    read -r answer || answer=""
    case "$answer" in
        y|Y|yes|YES) ;;
        *) say "Cancelled."; exit 0 ;;
    esac
fi

our_loader() {
    [ -f "$INJECT/inject.js" ] && grep -qF "$MARKER" "$INJECT/inject.js"
}

has_old_setup() {
    [ -d "$OLD_PLUGINS" ] || { [ -f "$INJECT/inject.js" ] && ! our_loader; }
}

migrate_from() {
    local src=$1 f
    [ -d "$src" ] || return 0
    mkdir -p "$FCDIR"
    for f in "${DATA_FILES[@]}"; do
        if [ -f "$src/$f" ] && [ ! -f "$FCDIR/$f" ]; then
            cp -p "$src/$f" "$FCDIR/$f"
            log "  $f"
        fi
    done
    if [ -d "$src/match-screens" ] && [ ! -d "$FCDIR/match-screens" ]; then
        cp -R "$src/match-screens" "$FCDIR/match-screens"
        log "  match-screens/ (your sounds)"
    fi
    if [ -d "$src/fc-snapshots" ] && [ ! -d "$FCDIR/fc-snapshots" ]; then
        mv "$src/fc-snapshots" "$FCDIR/fc-snapshots"
        log "  fc-snapshots/"
    fi
}

new_backup() {
    local base
    base="$BK_ROOT/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BK_ROOT" || fail "could not create $BK_ROOT"
    if [ -e "$base" ]; then base="$base-$$"; fi
    mkdir -p "$base" || fail "could not create $base"
    printf '%s\n' "$base"
}

latest_backup() {
    [ -d "$BK_ROOT" ] || return 1
    local d
    for d in $(find "$BK_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name 'uninstall-*' -printf '%f\n' 2>/dev/null | sort); do
        LAST_BACKUP="$BK_ROOT/$d"
    done
    [ -n "${LAST_BACKUP:-}" ]
}

read_manifest() {
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\\($2\\).*/\\1/p" "$MANIFEST" 2>/dev/null | head -n 1
}

write_manifest() {
    local off disabled splash now
    off=$(read_manifest off '\[[^]]*\]');   [ -n "$off" ] || off='[]'
    disabled=$(read_manifest disabled 'true\|false'); [ -n "$disabled" ] || disabled=false
    splash=$(read_manifest splash 'true\|false');     [ -n "$splash" ] || splash=true
    now=$(date '+%Y-%m-%dT%H:%M:%S')
    printf '{\n  "version": "%s",\n  "installedAt": "%s",\n  "disabled": %s,\n  "splash": %s,\n  "off": %s\n}\n' \
        "$VERSION" "$now" "$disabled" "$splash" "$off" > "$MANIFEST"
}

restore_emulator_ui() {
    local bak="$FCDIR/emu-ui-original" cfg="$FCDIR/emu-skin-config.json" live name want have
    [ -d "$bak" ] && [ -f "$cfg" ] || return 0
    live="$EMU_UI"
    sed -n 's/.*"written"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p' "$cfg" | tr ',' '\n' |
    while IFS= read -r pair; do
        name=$(printf '%s' "$pair" | sed -n 's/^[[:space:]]*"\([^"]*\)"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{64\}\)".*/\1/p')
        want=$(printf '%s' "$pair" | sed -n 's/^[[:space:]]*"\([^"]*\)"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{64\}\)".*/\2/p')
        [ -n "$name" ] || continue
        [ -f "$live/$name" ] && [ -f "$bak/$name" ] || continue
        have=$(sha256_file "$live/$name" 2>/dev/null)
        if [ "$have" = "$want" ]; then
            cp -f "$bak/$name" "$live/$name" && log "  restored the emulator's $name"
        fi
    done
}

# ----------------------------------------------------------------- install

do_install() {
    log "Fightcade: $ROOT"
    mkdir -p "$INJECT" || fail "could not create $INJECT"

    if has_old_setup; then
        local bk
        bk=$(new_backup)
        log "Backing up the current setup to $bk"
        if [ -f "$INJECT/inject.js" ] && ! our_loader; then
            cp -p "$INJECT/inject.js" "$bk/inject.js"
        fi
        if [ -f "$INJECT/config.json" ]; then mv "$INJECT/config.json" "$bk/config.json"; fi
        if [ -d "$OLD_PLUGINS" ]; then mv "$OLD_PLUGINS" "$bk/plugins"; fi

        mkdir -p "$FCDIR"
        log "Bringing your settings and match history along"
        migrate_from "$bk/plugins"

        log "The previous setup and its loader are out (kept in the backup)"
    fi

    log "Installing Fightcord $VERSION"
    mkdir -p "$FCDIR" || fail "could not create $FCDIR"
    cp -f "$PAYLOAD/inject.js" "$INJECT/inject.js" || fail "could not write $INJECT/inject.js"
    cp -f "$PAYLOAD"/fightcord/*.js "$FCDIR"/ || fail "could not copy the modules"
    if [ -d "$PAYLOAD/fightcord/node_modules" ]; then
        mkdir -p "$FCDIR/node_modules"
        cp -R "$PAYLOAD/fightcord/node_modules/." "$FCDIR/node_modules/" || fail "could not copy node_modules"
    fi
    write_manifest

    log ""
    log "Done. Open Fightcade - everything is under Settings -> Fightcord and the other blocks."
}

# --------------------------------------------------------------- uninstall

do_uninstall() {
    local prev="" keep
    if [ ! -d "$FCDIR" ] && ! our_loader; then
        log "Fightcord is not installed in $ROOT"
        return 0
    fi
    if latest_backup; then prev=$LAST_BACKUP; fi
    keep="$BK_ROOT/uninstall-$(date +%Y%m%d-%H%M%S)"

    log "Keeping your settings and match history in $keep"
    mkdir -p "$keep" || fail "could not create $keep"
    local f
    for f in "${DATA_FILES[@]}" fightcord.json; do
        [ -f "$FCDIR/$f" ] && cp -p "$FCDIR/$f" "$keep/$f"
    done
    [ -d "$FCDIR/match-screens" ] && cp -R "$FCDIR/match-screens" "$keep/match-screens"
    [ -d "$FCDIR/music" ] && cp -R "$FCDIR/music" "$keep/music"

    restore_emulator_ui

    log "Removing Fightcord"
    [ -d "$FCDIR" ] && rm -rf "$FCDIR"
    if our_loader; then rm -f "$INJECT/inject.js"; fi

    if [ "$RESTORE" = 1 ] && [ -n "$prev" ]; then
        log "Restoring $prev"
        [ -f "$prev/inject.js" ] && cp -f "$prev/inject.js" "$INJECT/inject.js"
        [ -f "$prev/config.json" ] && cp -f "$prev/config.json" "$INJECT/config.json"
        if [ -d "$prev/plugins" ]; then
            [ -d "$OLD_PLUGINS" ] && rm -rf "$OLD_PLUGINS"
            mv "$prev/plugins" "$OLD_PLUGINS"
        fi
    fi

    log ""
    if [ "$RESTORE" = 1 ] && [ -n "$prev" ]; then
        log "Fightcord removed. Your previous setup is back."
    else
        log "Fightcord removed. Fightcade runs plain."
    fi
}

case "$MODE" in
    install) do_install ;;
    uninstall) do_uninstall ;;
    *) fail "unknown mode: $MODE" ;;
esac
