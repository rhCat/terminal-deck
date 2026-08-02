#!/bin/sh
# terminal-deck diagnosis.sh — collect everything needed to fix the
# "posix_spawnp failed" / node-pty spawn problem on macOS, in ONE run.
#
#   curl -fsSL https://raw.githubusercontent.com/rhCat/terminal-deck/master/diagnosis.sh | sh
#
# Writes a full report to ~/deck-diagnosis.txt AND prints it, so you can
# open the file in TextEdit and copy without fighting the terminal.
set -u

OUT="$HOME/deck-diagnosis.txt"
{
  echo "==== terminal-deck diagnosis $(date '+%Y-%m-%d %H:%M:%S %Z') ===="
  echo ""
  echo "--- 1. platform ---"
  uname -a 2>&1
  echo "arch: $(uname -m 2>&1)"

  echo ""
  echo "--- 2. node ---"
  command -v node 2>&1 || echo "node: NOT FOUND"
  node -v 2>&1 || true
  node -p 'process.arch + " / " + process.platform' 2>&1 || true

  echo ""
  echo "--- 3. tmux ---"
  command -v tmux 2>&1 || echo "tmux: NOT on PATH"
  for p in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux; do
    if [ -e "$p" ]; then ls -la "$p"; file "$p" 2>&1; fi
  done
  tmux -V 2>&1 || echo "(tmux -V failed)"

  echo ""
  echo "--- 4. repo version ---"
  for d in "$HOME/.terminal-deck" "$HOME/terminal-deck" "$(pwd)"; do
    if [ -d "$d/.git" ]; then
      echo "repo: $d"
      git -C "$d" log --oneline -1 2>&1
      grep -c "cannot start terminal" "$d/server.js" 2>/dev/null | sed 's/^/fix-marker-count: /'
    fi
  done

  echo ""
  echo "--- 5. node-pty native bits ---"
  for d in "$HOME/.terminal-deck" "$HOME/terminal-deck" "$(pwd)"; do
    if [ -d "$d/node_modules/node-pty" ]; then
      echo "node-pty in: $d"
      ls -la "$d/node_modules/node-pty/build/Release/" 2>&1 | head -20
      for h in "$d/node_modules/node-pty/build/Release/spawn-helper" "$d/node_modules/node-pty/build/Release/pty.node"; do
        if [ -e "$h" ]; then file "$h" 2>&1; fi
      done
    fi
  done

  echo ""
  echo "--- 6. direct node-pty spawn probe ---"
  NODE_PTY_DIR=""
  for d in "$HOME/.terminal-deck" "$HOME/terminal-deck" "$(pwd)"; do
    if [ -d "$d/node_modules/node-pty" ]; then NODE_PTY_DIR="$d"; break; fi
  done
  if [ -n "$NODE_PTY_DIR" ]; then
    node -e "
      const pty = require('$NODE_PTY_DIR/node_modules/node-pty');
      const bins = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', 'tmux'];
      for (const bin of bins) {
        try {
          const t = pty.spawn(bin, ['-V'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.env.HOME, env: process.env });
          t.onData(d => { console.log('PTY SPAWN OK  ' + bin + ' -> ' + JSON.stringify(d).slice(0, 40)); process.exit(0); });
          t.onExit(e => { console.log('PTY SPAWN EXIT ' + bin + ' -> ' + JSON.stringify(e)); process.exit(1); });
        } catch (e) { console.log('PTY SPAWN THREW ' + bin + ' -> ' + e.message); }
      }
      setTimeout(() => { console.log('PTY SPAWN TIMEOUT'); process.exit(2); }, 5000);
    " 2>&1
  else
    echo "node-pty: not found in any candidate dir"
  fi

  echo ""
  echo "--- 7. plain (non-pty) spawn probe ---"
  node -e "
    const { execFileSync } = require('child_process');
    for (const bin of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', 'tmux']) {
      try { const r = execFileSync(bin, ['-V'], { encoding: 'utf8', timeout: 5000 }); console.log('PLAIN OK  ' + bin + ' -> ' + r.trim()); }
      catch (e) { console.log('PLAIN FAIL ' + bin + ' -> ' + (e.message || '').split('\n')[0]); }
    }
  " 2>&1

  echo ""
  echo "--- 8. cwd / home ---"
  echo "HOME: $HOME  (exists: $([ -d "$HOME" ] && echo yes || echo no))"
  echo "PWD:  $(pwd)  (exists: $([ -d "$(pwd)" ] && echo yes || echo no))"
  echo ""
  echo "==== end diagnosis ===="
} 2>&1 | tee "$OUT"

echo ""
echo "Report saved to: $OUT"
echo "Open it with:    open $OUT"
