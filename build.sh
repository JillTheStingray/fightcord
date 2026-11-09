#!/usr/bin/env bash
# Builds the Linux release: dist/fightcord-<version>-linux.tar.gz
#   1. collects the modules, the Discord-status plugin and the loader
#   2. syntax-checks every .js with node and runs the unit tests
#   3. stages payload/ (inject.js + fightcord/) and adds installer/linux/install.sh
#   4. writes the tarball
# With --release it also writes the in-app update for GitHub Releases (the same JS-only
# update Windows uses, because the updater runs inside Fightcade on both systems):
#   dist/fightcord-<version>-update.zip   (inject.js, fightcord\*.js, node_modules, files.json)
#   dist/latest.json                      ({version, zip, sha256, notes, setup, linux})
#
# The version lives in installer/FightcordSetup.cs, like build.ps1. The Windows build is
# unchanged: run this on Linux/macOS, build.ps1 on Windows.
#
# Run: ./build.sh [--release] [--notes "what changed" | --notes-file notes.md]

set -euo pipefail

RELEASE=0
NOTES=""
NOTES_FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --release) RELEASE=1 ;;
        --notes) shift; [ $# -gt 0 ] || { echo "--notes needs text" >&2; exit 2; }; NOTES=$1 ;;
        --notes-file) shift; [ $# -gt 0 ] || { echo "--notes-file needs a file" >&2; exit 2; }; NOTES_FILE=$1 ;;
        --help|-h) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
done

if [ -n "$NOTES_FILE" ] && [ -f "$NOTES_FILE" ]; then
    NOTES=$(cat "$NOTES_FILE")
fi

HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
cd "$HERE"

SRC=src
RPC=rpc
BUILD=build/linux
DIST=dist

VERSION=$(sed -n 's/.*const string Version = "\([0-9.]*\)".*/\1/p' installer/FightcordSetup.cs | head -n 1)
[ -n "$VERSION" ] || { echo "could not read Version from installer/FightcordSetup.cs" >&2; exit 1; }
echo "Fightcord $VERSION"

# The module list lives in build.ps1 (one source for both builds): every quoted .js in
# $plugins = @( ... ). A top-level module missing from it must not ship.
PLUGINS=()
while IFS= read -r name; do PLUGINS+=("$name"); done < <(
    awk 'index($0, "$plugins = @(") == 1 { on = 1 } on { print } on && /\)[[:space:]]*$/ { exit }' build.ps1 |
    grep -oE "'[A-Za-z0-9_.-]+\.js'" | tr -d "'"
)
[ ${#PLUGINS[@]} -gt 0 ] || { echo "could not read the plugin list from build.ps1" >&2; exit 1; }

unlisted=""
while IFS= read -r f; do
    printf '%s\n' "${PLUGINS[@]}" | grep -qx "$f" || unlisted="$unlisted $f"
done < <(find "$SRC" -maxdepth 1 -name '*.js' -printf '%f\n' | sort)
if [ -n "$unlisted" ]; then
    echo "not in \$plugins (add them to build.ps1):$unlisted" >&2
    exit 1
fi

if [ ! -d "$RPC/node_modules/discord-rpc" ]; then
    echo "Installing the Discord-status dependencies (npm)"
    (cd "$RPC" && npm install --omit=optional --no-audit --no-fund >/dev/null)
fi

rm -rf "$BUILD"
STAGE="$BUILD/payload"
mkdir -p "$STAGE/fightcord/node_modules" "$DIST"

echo "Collecting files"
cp loader/inject.js "$STAGE/inject.js"
for p in "${PLUGINS[@]}"; do cp "$SRC/$p" "$STAGE/fightcord/$p"; done
cp "$RPC/plugin/discord-rpc.js" "$STAGE/fightcord/discord-rpc.js"

# discord-rpc's optional native helper (register-scheme) is never used: discord-rpc loads it
# in a try/catch, and we never register a URL scheme. Leaving it out keeps the payload pure
# JavaScript (the same list build.ps1 uses).
SKIP_PACKAGES=" register-scheme bindings file-uri-to-path node-addon-api "
for d in "$RPC/node_modules"/*/; do
    name=$(basename "$d")
    case "$name" in .*) continue ;; esac
    case "$SKIP_PACKAGES" in *" $name "*) continue ;; esac
    cp -R "$d" "$STAGE/fightcord/node_modules/$name"
done
printf '%s\n' "$VERSION" > "$STAGE/version"

echo "Checking syntax"
while IFS= read -r f; do node --check "$f"; done < <(find "$STAGE" -type f -name '*.js' | sort)
# the Discord-status plugin must still load its library from what we ship
node -e 'const p = require("path");
    require(p.resolve(process.argv[1])); require(p.resolve(process.argv[2]));' \
    "$STAGE/fightcord/node_modules/discord-rpc" "$STAGE/fightcord/node_modules/ws"

echo "Running tests"
node --test "$SRC"/tests/*.test.js

echo "Packing the Linux installer"
BUNDLE="$BUILD/fightcord-$VERSION-linux"
mkdir -p "$BUNDLE"
cp -R "$STAGE" "$BUNDLE/payload"
cp installer/linux/install.sh "$BUNDLE/install.sh"
chmod +x "$BUNDLE/install.sh"
chmod +x installer/linux/install.sh

LINUX_TAR="$DIST/fightcord-$VERSION-linux.tar.gz"
rm -f "$LINUX_TAR"
tar -C "$BUILD" -czf "$LINUX_TAR" "fightcord-$VERSION-linux"
echo "Built $LINUX_TAR ($(du -h "$LINUX_TAR" | cut -f1))"
echo "  install: tar xzf $(basename "$LINUX_TAR") && cd fightcord-$VERSION-linux && ./install.sh --install"

if [ "$RELEASE" = 1 ]; then
    echo "Writing the in-app update"
    UP="$BUILD/update"
    mkdir -p "$UP/fightcord"
    cp "$STAGE/inject.js" "$UP/inject.js"
    cp "$STAGE"/fightcord/*.js "$UP/fightcord/"
    cp -R "$STAGE/fightcord/node_modules" "$UP/fightcord/node_modules"
    MODS=$(find "$UP/fightcord" -maxdepth 1 -name '*.js' -printf '%f\n' | sort)
    node -e '
        const fs = require("fs");
        const [out, version, ...mods] = process.argv.slice(1);
        fs.writeFileSync(out, JSON.stringify({ version: version, modules: mods.sort() }, null, 0));
    ' "$UP/files.json" "$VERSION" $MODS

    UP_NAME="fightcord-$VERSION-update.zip"
    DIST_ABS=$(cd "$DIST" && pwd)
    UP_ZIP="$DIST_ABS/$UP_NAME"
    rm -f "$UP_ZIP"
    (cd "$UP" && zip -qr "$UP_ZIP" .)
    SHA=$(sha256sum "$UP_ZIP" | cut -d' ' -f1)
    node -e '
        const fs = require("fs");
        const [out, version, zip, sha, notes, linux] = process.argv.slice(1);
        fs.writeFileSync(out, JSON.stringify({
            version: version, zip: zip, sha256: sha, notes: notes,
            setup: "FightcordSetup.exe", linux: linux
        }, null, 0));
    ' "$DIST/latest.json" "$VERSION" "$UP_NAME" "$SHA" "$NOTES" "$(basename "$LINUX_TAR")"
    echo "Wrote $UP_NAME and latest.json (sha256 $SHA)"
fi
