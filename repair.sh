#!/bin/sh
# terminal-deck repair.sh — repair the node-pty native layer on macOS.
#
# Root cause this fixes: node-pty spawns its own helper binary (spawn-helper)
# via posix_spawnp. Two things break that on a Mac:
#   1. Gatekeeper quarantine xattr on the npm-downloaded helper -> kernel
#      refuses the exec -> generic "posix_spawnp failed" on every pane.
#   2. FORCING a compile (npm --build-from-source) DELETES node-pty's bundled
#      prebuilt binaries (prebuilds/<platform>-<arch>/) and compiles ancient
#      C++ against the current SDK — which fails on macOS 26's libc++
#      (__atomic_unique_lock::__owns_lock removed).
#
# The fix: install NORMALLY (prebuilds load), strip quarantine, and never pass
# --build-from-source. node-pty 1.1.0 ships prebuilt darwin-arm64 binaries in
# the package tarball itself.
#
#   curl -fsSL https://raw.githubusercontent.com/rhCat/terminal-deck/master/repair.sh | sh
#
set -u

DECK_DIR="${TERMINAL_DECK_DIR:-$HOME/.terminal-deck}"
[ -d "$DECK_DIR" ] || DECK_DIR="$(pwd)"
echo "== terminal-deck repair: fixing node-pty native layer in $DECK_DIR =="

# 1) check the config that usually causes this
echo ""
echo "-- npm ignore-scripts: $(cd "$DECK_DIR" && npm config get ignore-scripts 2>&1)"

# 2) macOS Gatekeeper quarantine is a top cause of "posix_spawnp failed":
# node-pty spawns its own spawn-helper via posix_spawnp, and a quarantined
# (npm-downloaded) helper is refused by the kernel. Strip it, if present.
if [ "$(uname -s)" = "Darwin" ]; then
  echo "-- stripping com.apple.quarantine from node-pty binaries..."
  xattr -dr com.apple.quarantine "$DECK_DIR/node_modules/node-pty" 2>/dev/null || true
  find "$DECK_DIR/node_modules/node-pty" \( -name 'spawn-helper' -o -name 'pty.node' \) 2>/dev/null | while read -r f; do
    if xattr -p com.apple.quarantine "$f" >/dev/null 2>&1; then
      xattr -dr com.apple.quarantine "$f" && echo "   cleared quarantine: $f"
    fi
  done
  echo "   done"
fi

# 3) wipe node_modules so the (correct) prebuilds are re-extracted fresh.
#    IMPORTANT: plain `npm install` — NEVER --build-from-source, which deletes
#    the bundled prebuilds and forces an SDK-incompatible compile.
echo "-- removing node_modules + package-lock.json (fresh reinstall)..."
rm -rf "$DECK_DIR/node_modules" "$DECK_DIR/package-lock.json"
echo "-- npm install (prebuilds load automatically; no compile)..."
if (cd "$DECK_DIR" && npm install --foreground-scripts); then
  echo "npm install OK"
else
  echo "!! npm install failed. Paste the error."
  echo "   (If it still tries to compile node-pty, check for a global"
  echo "    .npmrc setting npm_config_build_from_source=true:"
  echo "    npm config get build-from-source  →  should print 'false')"
fi

# 4) verify the PREBUILT binaries are in place (not a compiled build)
echo ""
echo "-- verifying node-pty prebuilt binaries..."
PREBUILT="$DECK_DIR/node_modules/node-pty/prebuilds"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  P="$PREBUILT/darwin-arm64" ;;
  Darwin-x86_64) P="$PREBUILT/darwin-x64" ;;
  *)             P="$PREBUILT" ;;
esac
if [ -f "$P/pty.node" ] && [ -f "$P/spawn-helper" ]; then
  echo "prebuilds: PRESENT at $P"
  ls -la "$P" | grep -E 'pty.node|spawn-helper'
  xattr -p com.apple.quarantine "$P/spawn-helper" >/dev/null 2>&1 \
    && echo "!! spawn-helper STILL quarantined" || echo "spawn-helper: quarantine clear"
  # node-pty packaging bug: the prebuilt spawn-helper ships 0644 (no exec bit);
  # macOS execs it via posix_spawnp -> EACCES -> "posix_spawnp failed". Fix it.
  if [ ! -x "$P/spawn-helper" ]; then
    echo "!! spawn-helper has no exec bit (node-pty prebuild bug) — fixing..."
    chmod +x "$P/spawn-helper"
    echo "   chmod +x applied: $(ls -la "$P/spawn-helper" | awk '{print $1}')"
  else
    echo "spawn-helper: exec bit present"
  fi
else
  echo "prebuilds: MISSING at $P — will need the full error log"
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
