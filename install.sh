#!/bin/sh
# terminal-deck install script (macOS first-class; Linux/Windows-WSL sh works)
#
# Installs the runtime deps (tmux + Node), clones/updates the app, installs npm
# deps (compiles node-pty, needs Xcode CLT on macOS), and puts `terminal-deck`
# on your PATH so you can fire it from any terminal.
#
#   curl -fsSL https://raw.githubusercontent.com/rhCat/terminal-deck/master/install.sh | sh
#
# or run the local copy:
#   ./install.sh
set -eu

APP_DIR="${TERMINAL_DECK_DIR:-$HOME/.terminal-deck}"
REPO="https://github.com/rhCat/terminal-deck.git"

say()  { printf '  \033[32m>\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "missing '$1'. See the step above — install it, then re-run."
  fi
}

echo ""
echo "      ▦  terminal-deck — installer"
echo ""

# ---- 1) prerequisite binaries ---------------------------------------------
echo "-> checking prerequisites..."

if command -v brew >/dev/null 2>&1; then
  say "found Homebrew"
else
  warn "Homebrew not found — if you're on macOS, install it first:"
  warn "    /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  warn "Proceeding anyway (tmux/node may be installed another way)."
fi

# tmux (the persistence runtime)
if command -v tmux >/dev/null 2>&1; then
  say "tmux $(tmux -V 2>/dev/null || echo 'found')"
else
  say "installing tmux (the persistent-session runtime)..."
  if command -v brew >/dev/null 2>&1; then
    brew install tmux
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y tmux
  else
    err "can't auto-install tmux — brew install tmux, or use your package manager"
  fi
fi
need_cmd tmux

# node
if command -v node >/dev/null 2>&1; then
  say "node $(node -v 2>/dev/null || echo found)"
else
  say "installing node via Homebrew..."
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    err "can't auto-install node — install Node >= 18, then re-run"
  fi
fi
need_cmd node
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -lt 18 ] && err "Node >= 18 required (have $(node -v)). Upgrade node, then re-run."

# build toolchain for node-pty (macOS: Xcode CLT; Linux: make+g+++python3)
if [ "$(uname -s)" = "Darwin" ]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    say "installing Xcode Command Line Tools (needed to compile node-pty)..."
    xcode-select --install || warn "run 'xcode-select --install' manually, then re-run"
  else
    say "Xcode CLT present"
  fi
else
  for b in make g++ python3; do
    command -v "$b" >/dev/null 2>&1 || warn "missing '$b' — node-pty may fail to build"
  done
fi

# ---- 2) clone / update the app ----------------------------------------------
echo "-> fetching terminal-deck..."
if [ -d "$APP_DIR/.git" ]; then
  say "updating existing install at $APP_DIR"
  git -C "$APP_DIR" pull --ff-only || warn "git pull failed; continuing with existing files"
else
  say "cloning repo -> $APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

# ---- 3) install npm deps (compiles node-pty) --------------------------------
echo "-> installing npm dependencies..."
( cd "$APP_DIR" && npm install ) || err "npm install failed — check build tools (Xcode CLT on mac)"

# ---- 4) expose `terminal-deck` on PATH --------------------------------------
echo "-> wiring the terminal-deck command..."

# Prefer a real global link if we have permission; fall back to a symlink.
if ( cd "$APP_DIR" && npm link >/dev/null 2>&1 ); then
  say "installed global command via npm link"
elif command -v terminal-deck >/dev/null 2>&1; then
  say "terminal-deck already on PATH"
else
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
  ln -sfn "$APP_DIR/bin/terminal-deck" "$BIN_DIR/terminal-deck"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      warn "$BIN_DIR is not on your PATH. Add it to your shell config:"
      warn "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc"
      ;;
  esac
  need_cmd terminal-deck 2>/dev/null || say "link created at $BIN_DIR/terminal-deck (add $BIN_DIR to PATH if needed)"
fi

echo ""
say "done. Run it:"
echo ""
echo "    terminal-deck --open"
echo ""
echo "  then open http://localhost:8787 in your browser."
echo "  Each work = one tmux session; sessions persist across browser close."
echo ""
