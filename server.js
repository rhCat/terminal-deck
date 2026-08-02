// terminal-deck — PowerPoint-style live thumbnail terminal manager on persistent tmux
//
// Model: each "work" = one persistent tmux SESSION. 6-7 works = 6-7 sessions =
// 6-7 cards in the deck. This is exactly your requirement: work persists because
// the tmux server holds the sessions detached; closing the browser, reloading,
// or even restarting this node server doesn't kill them.
//
//  * Thumbnails (the "slide sorter"): cheap `tmux capture-pane` snapshots, polled
//    every ~1s. Non-interactive, but live enough to peek at what's flowing.
//  * Main slide (the focused work): a real interactive node-pty running
//    `tmux attach -t <session>` — full keyboard, resize, everything.
//  * Zoom: point the main pty at a different session => that card becomes the
//    big screen. Grid view: show all cards at once as live snapshots.
//
// Persistence rationale for node-pty: the pty is only a thin *client* to tmux.
// If it dies, tmux keeps the session; we just spawn a fresh `tmux attach` on the
// next interaction. The work itself lives in the tmux server, not in the pty.

import express from 'express';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { spawn, execFileSync } from 'child_process';
import { mkdirSync, existsSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- tmux environment (rootless install on this box) ------------------------
// Resolve tmux to an ABSOLUTE path at startup so node-pty doesn't depend on the
// caller's PATH (a conda/base shell on macOS can hide /opt/homebrew/bin, which
// caused "posix_spawnp failed" crashes on attach).
const _tmuxCandidates = (process.env.TMUX_BIN || 'tmux');
let TMUX_BIN = _tmuxCandidates;
try {
  if (!process.env.TMUX_BIN) {
    // 1) spawn-search via PATH; 2) fall back to standard Homebrew prefixes.
    let abs = '';
    try { abs = execFileSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim(); } catch {}
    if (!abs) {
      for (const cand of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux']) {
        if (existsSync(cand)) { abs = cand; break; }
      }
    }
    if (abs) TMUX_BIN = abs;
  }
} catch { TMUX_BIN = _tmuxCandidates; } // keep 'tmux' -> spawn error surfaces later
const TMUX_LIB_DIR = process.env.TMUX_LIB_DIR || null;
const TMUX_SOCK_DIR = process.env.TMUX_SOCK_DIR || path.join(os.tmpdir(), 'terminal-deck');
mkdirSync(TMUX_SOCK_DIR, { recursive: true });

function tmuxEnv(extra) {
  const e = { ...process.env, TMUX_TMPDIR: TMUX_SOCK_DIR, ...extra };
  if (TMUX_LIB_DIR) e.LD_LIBRARY_PATH = [TMUX_LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  return e;
}

// ---- persistent tmux server -------------------------------------------------
console.log('[terminal-deck] using tmux at:', TMUX_BIN);
function ensureServer() {
  try { spawn(TMUX_BIN, ['-L', 'deck', 'start-server'], { env: tmuxEnv(), stdio: 'ignore' }); } catch (e) {
    console.error('tmux start-server failed:', e.message);
  }
}
ensureServer();

function tmux(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(TMUX_BIN, ['-L', 'deck', ...args], { env: tmuxEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `tmux exit ${code}`))));
  });
}

async function listSessions() {
  const out = await tmux(['list-sessions', '-F', '#{session_name}']).catch(() => '');
  return out.split('\n').filter(Boolean).map((name) => ({ name }));
}

async function snapshot(session, cols = 80, rows = 24) {
  // raw snapshot with no status line; strip tmux screen-control preamble that
  // capture-pane -p can prepend in control-ish contexts (rare)
  const out = await tmux(['capture-pane', '-t', session, '-p', '-J', '-e']).catch(() => '');
  // tn: -e keeps escape sequences so ANSI color/format passes through to xterm
  return out;
}

// ---- HTTP --------------------------------------------------------------------
const app = express();
app.use(express.json()); // parse JSON request bodies (POST /api/rename, /api/session.name, etc.)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sessions', async (_req, res) => {
  try { res.json({ ok: true, sessions: await listSessions() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/session', async (req, res) => {
  const name = String((req.body && req.body.name) || 'work').replace(/[^A-Za-z0-9._-]/g, '_');
  try { await tmux(['new-session', '-d', '-s', name, '-x', '132', '-y', '43']); }
  catch { /* exists */ }
  res.json({ ok: true, name });
});

app.post('/api/rename', async (req, res) => {
  const old_ = String((req.body && req.body.old) || '').replace(/[^A-Za-z0-9._-]/g, '_');
  const new_ = String((req.body && req.body.news) || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (!old_ || !new_) return res.status(400).json({ ok: false, error: 'old & new required' });
  try { await tmux(['rename-session', '-t', old_, new_]); res.json({ ok: true, old: old_, new: new_ }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/info', async (req, res) => {
  const name = String(req.query.name || '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const run = (cmd) => new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd[0], cmd.slice(1), { env: tmuxEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return resolve(''); }
    let o = ''; p.stdout.on('data', (d) => (o += d));
    p.on('error', () => resolve(''));   // e.g. binary not installed (tailscale)
    p.on('close', () => resolve(o.trim()));
  });
  try {
    const pwd = (await tmux(['display-message', '-t', name, '-p', '#{pane_current_path}'])).trim() || '—';
    const hostname = (await run(['hostname'])).trim() || os.hostname();
    let ip = (await run(['tailscale', 'ip', '-4'])).split('\n')[0].trim();
    if (!ip) ip = (await run(['hostname', '-I'])).trim().split(/\s+/)[0] || '—';
    const uptime = (await run(['uptime', '-p'])).trim() || '—';
    const date = (await run(['date', '+%Y-%m-%d %H:%M:%S %Z'])).trim() || '—';
    // recent console history: scrollback of the pane (last ~40 lines), faint hint
    // that the shell history file may not be authoritative under detached tmux.
    const hist = (await tmux(['capture-pane', '-t', name, '-p', '-J', '-S', '-40']).catch(() => '')).split('\n').slice(-40);
    res.json({ ok: true, name, pwd, hostname, ip, uptime, date, history: hist });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/kill', async (req, res) => {
  const name = String((req.body && req.body.name) || '').replace(/[^A-Za-z0-9._-]/g, '_');
  try { await tmux(['kill-session', '-t', name]); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ---- WebSocket ----------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

// token -> {pty}  main interactive terminals
const mains = new Map();

// sockets -> Set<token> so we can reap when a browser disconnects
const socketTokens = new Map();

function diagnoseSpawn() {
  // node-pty's generic "posix_spawnp failed" hides the real cause on macOS.
  // Gather: arch, node-pty's helper binary, cwd, and a plain-spawn probe.
  const lines = [];
  try { lines.push(`node=${process.version} arch=${process.arch} platform=${process.platform}`); } catch {}
  try { lines.push(`tmux=${TMUX_BIN} exists=${existsSync(TMUX_BIN)}`); } catch {}
  try {
    // node-pty ships a native helper (spawn-helper); missing/wrong-arch breaks spawn.
    const p = path.join(__dirname, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper');
    lines.push(`spawn-helper=${p} exists=${existsSync(p)}`);
  } catch {}
  try {
    const home = os.homedir();
    lines.push(`cwd=${home} exists=${existsSync(home)}`);
  } catch {}
  try {
    // If plain spawn of tmux works, node-pty's native layer is the problem.
    const r = execFileSync(TMUX_BIN, ['-V'], { encoding: 'utf8', timeout: 5000 });
    lines.push(`plain-spawn tmux -V => OK (${r.trim()})`);
  } catch (e2) {
    lines.push(`plain-spawn tmux -V => FAILED: ${e2.message}`);
  }
  return '[diag] ' + lines.join(' | ');
}

function openMain(ws, token, session, cols, rows) {
  // If we already have this token, just return (idempotent).
  if (mains.has(token)) return;
  // Pre-flight: node-pty's generic "posix_spawnp failed" hides the real cause.
  // Give a precise error if tmux is missing or not executable.
  try {
    if (!existsSync(TMUX_BIN)) {
      throw new Error(`tmux not found at resolved path '${TMUX_BIN}' — install it (brew install tmux) or set TMUX_BIN`);
    }
    if (process.platform !== 'win32') {
      const st = statSync(TMUX_BIN);
      if (!(st.mode & 0o111)) throw new Error(`tmux at '${TMUX_BIN}' is not executable (mode ${st.mode.toString(8)})`);
    }
  } catch (e) {
    console.error(`openMain: preflight failed for '${session}':`, e.message);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ t: 'data', token, data: `\r\n[terminal-deck] ${e.message}\r\n` }));
      ws.send(JSON.stringify({ t: 'bye', token }));
    }
    return;
  }
  let p;
  try {
    p = pty.spawn(TMUX_BIN, ['-L', 'deck', 'attach', '-t', session], {
      name: 'xterm-256color', cols: cols || 132, rows: rows || 43, cwd: os.homedir(),
      env: tmuxEnv({ TERM: 'xterm-256color' }),
    });
  } catch (e) {
    // A failed spawn must NEVER take down the whole deck — report to this pane.
    // node-pty's "posix_spawnp failed" is generic; gather the real facts.
    const diag = diagnoseSpawn();
    console.error(`openMain: cannot spawn tmux for '${session}':`, e.message, diag);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ t: 'data', token,
        data: `\r\n[terminal-deck] cannot start terminal for '${session}': ${e.message}\r\n${diag}\r\n` }));
      ws.send(JSON.stringify({ t: 'bye', token }));
    }
    return;
  }
  p.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'data', token, data })); });
  p.onExit(() => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'bye', token })); mains.delete(token); });
  mains.set(token, { pty: p, session });
  if (!socketTokens.has(ws)) socketTokens.set(ws, new Set());
  socketTokens.get(ws).add(token);
}

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === 'main') {
      openMain(ws, msg.token, msg.session, msg.cols, msg.rows);
    } else if (msg.t === 'input') {
      const m = mains.get(msg.token);
      if (m) m.pty.write(msg.data);
    } else if (msg.t === 'resize') {
      const m = mains.get(msg.token);
      if (m) m.pty.resize(Math.floor(msg.cols), Math.floor(msg.rows));
    } else if (msg.t === 'unfollow') {
      const m = mains.get(msg.token);
      if (m) { try { m.pty.kill(); } catch {} mains.delete(msg.token); }
    } else if (msg.t === 'snapshot') {
      // live thumbnail refresh
      const snap = await snapshot(msg.session);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'snap', session: msg.session, data: snap }));
    }
  });
  ws.on('close', () => {
    const toks = socketTokens.get(ws);
    if (toks) for (const t of toks) { const m = mains.get(t); if (m) { try { m.pty.kill(); } catch {} mains.delete(t); } }
    socketTokens.delete(ws);
  });
});

export function attachTo(server) {
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    else socket.destroy();
  });
}

const PORT = process.env.PORT || 9000;
export { app, listSessions, tmux, TMUX_BIN, TMUX_SOCK_DIR };
