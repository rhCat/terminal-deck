#!/bin/sh
# terminal-deck repair.sh — force-rebuilds the node-pty native addon.
#
# Root cause this fixes: node-pty's compiled binary (build/Release/) is missing
# because npm skipped its postinstall build (usually ignore-scripts=true, or a
# silently failed node-gyp step). Without it, every pty.spawn throws the generic
# "posix_spawnp failed" even though tmux/node are perfectly fine.
#
#   curl -fsSL https://raw.githubusercontent.com/rhCat/terminal-deck/master/repair.sh | sh
#
set -u

DECK_DIR="${TERMINAL_DECK_DIR:-$HOME/.terminal-deck}"
[ -d "$DECK_DIR" ] || DECK_DIR="$(pwd)"
echo "== terminal-deck repair: rebuilding node-pty in $DECK_DIR =="

# 1) check the config that usually causes this
echo ""
echo "-- npm ignore-scripts: $(cd "$DECK_DIR" && npm config get ignore-scripts 2>&1)"

# 1b) macOS Gatekeeper quarantine is a top cause of "posix_spawnp failed":
# node-pty spawns its own spawn-helper via posix_spawnp, and a quarantined
# (npm-downloaded) helper is refused by the kernel. Strip it, if present.
if [ "$(uname -s)" = "Darwin" ]; then
  echo "-- stripping com.apple.quarantine from node-pty binaries..."
  find "$DECK_DIR/node_modules/node-pty" -name 'spawn-helper' -o -name 'pty.node' 2>/dev/null | while read -r f; do
    if xattr -p com.apple.quarantine "$f" >/dev/null 2>&1; then
      xattr -dr com.apple.quarantine "$f" && echo "   cleared quarantine: $f"
    fi
  done
  echo "   done (xattr -dr com.apple.quarantine applied over the tree)"
  xattr -dr com.apple.quarantine "$DECK_DIR/node_modules/node-pty" 2>/dev/null || true
fi

# 2) wipe node_modules so nothing is "up to date" and skipped again
echo "-- removing node_modules (forces a real build)..."
rm -rf "$DECK_DIR/node_modules" "$DECK_DIR/package-lock.json"

# 3) reinstall with scripts FORCED on and native build FROM SOURCE
echo "-- npm install --foreground-scripts --build-from-source ..."
if (cd "$DECK_DIR" && npm install --foreground-scripts --build-from-source) ; then
  echo "npm install OK"
else
  echo ""
  echo "!! npm install reported errors. If it mentions xcodebuild/gyp, run:"
  echo "     xcode-select --install"
  echo "   then re-run this script."
  echo ""
  # still continue so the check below reports the actual state
fi

# 4) verify the compiled addon exists
echo ""
echo "-- verifying node-pty native build..."
PTY_NODE="$DECK_DIR/node_modules/node-pty/build/Release/pty.node"
HELPER="$DECK_DIR/node_modules/node-pty/build/Release/spawn-helper"
if [ -e "$PTY_NODE" ]; then
  echo "pty.node: PRESENT ($(ls -la "$PTY_NODE" | awk '{print $5}') bytes)"
  file "$PTY_NODE" 2>&1
else
  echo "pty.node: MISSING — node-pty still not compiled"
fi
if [ -e "$HELPER" ]; then
  echo "spawn-helper: PRESENT"; file "$HELPER" 2>&1
else
  echo "spawn-helper: absent (not required on all platforms)"
fi

# 5) live probe: does pty.spawn of tmux work now?
echo ""
echo "-- live probe: pty.spawn('/opt/homebrew/bin/tmux', ['-V']) ..."
node -e "
  const pty = require('$DECK_DIR/node_modules/node-pty');
  try {
    const t = pty.spawn('/opt/homebrew/bin/tmux', ['-V'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.env.HOME, env: process.env });
    t.onData(d => { console.log('PROBE OK: ' + JSON.stringify(d).slice(0, 40)); process.exit(0); });
    t.onExit(e => { console.log('PROBE EXIT: ' + JSON.stringify(e)); process.exit(1); });
  } catch (e) { console.log('PROBE THREW: ' + e.message); process.exit(1); }
  setTimeout(() => { console.log('PROBE TIMEOUT'); process.exit(2); }, 5000);
" 2>&1

echo ""
echo "== done. If PROBE OK — start the deck: terminal-deck --open =="
