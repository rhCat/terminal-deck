// terminal-deck — browser-side app.
// Talks to the Node backend over one WebSocket. Sessions (works) live in
// persistent tmux; this page is just a viewer/controller.

const API = '';
const SNAP_INTERVAL = 1200; // ms between live thumbnail snapshots
const PROPS_INTERVAL = 3000; // ms between properties refreshes

const state = {
  sessions: [],      // [{name}]
  active: null,      // currently focused session name
  notes: {},         // session -> notes text (local, could be persisted server-side)
  tokens: {},        // session -> main terminal token
  theme: localStorage.getItem('deck-theme') || 'dark',
  clipboard: localStorage.getItem('deck-clipboard') || '',  // shared across all terminals/panes
};
try { state.clipboard = localStorage.getItem('deck-clipboard') || ''; } catch { state.clipboard = ''; }

// Base64 decode helper (browser-safe, handles UTF-8).
function b64Decode(str) {
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return ''; }
}
function b64Encode(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  } catch { return ''; }
}

// ---------- DOM refs ----------
const $cards = document.getElementById('cards');
const $stageTitle = document.getElementById('stage-title');
const $stageMeta = document.getElementById('stage-meta');
const $termEl = document.getElementById('term');
const $stageEmpty = document.getElementById('stage-empty');
const $notes = document.getElementById('notes-text');
const $btnGrid = document.getElementById('btn-grid');
const $btnZoom = document.getElementById('btn-zoom');
const $btnNew = document.getElementById('btn-new');
const $btnClose = document.getElementById('btn-close');
const $btnProps = document.getElementById('btn-props');
const $btnClear = document.getElementById('btn-clear');
const $btnDemo = document.getElementById('btn-demo');
const $btnRename = document.getElementById('btn-rename');
const $themeSelect = document.getElementById('theme-select');
const $props = document.getElementById('props');
const $propsClose = document.getElementById('props-close');
const $modal = document.getElementById('modal');
const $newName = document.getElementById('new-name');
const $modalRename = document.getElementById('modal-rename');
const $renameInput = document.getElementById('rename-input');
const $btnClip = document.getElementById('btn-clip');
const $clipPop = document.getElementById('clip-pop');

const THEMES = {
  dark:     { background: '#000000', foreground: '#d7dce6', cursor: '#d7dce6',
              selection: '#264f78', black:'#000000', red:'#cd3131', green:'#0dbc79', yellow:'#e5e510',
              blue:'#2472c8', magenta:'#bc3fbc', cyan:'#11a8cd', white:'#e5e5e5',
              brightBlack:'#666666', brightRed:'#f14c4c', brightGreen:'#23d18b', brightYellow:'#f5f543',
              brightBlue:'#3b8eea', brightMagenta:'#d670d6', brightCyan:'#29b8db', brightWhite:'#e5e5e5' },
  light:    { background: '#ffffff', foreground: '#333333', cursor: '#333333', selection: '#add6ff',
              black:'#000000', red:'#cd3131', green:'#00bc00', yellow:'#949800', blue:'#0451a5',
              magenta:'#bc05bc', cyan:'#0598bc', white:'#555555',
              brightBlack:'#666666', brightRed:'#cd3131', brightGreen:'#00bc00', brightYellow:'#949800',
              brightBlue:'#0451a5', brightMagenta:'#bc05bc', brightCyan:'#0598bc', brightWhite:'#a5a5a5' },
  dracula:  { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
              black:'#21222c', red:'#ff5555', green:'#50fa7b', yellow:'#f1fa8c',
              blue:'#bd93f9', magenta:'#ff79c6', cyan:'#8be9fd', white:'#f8f8f2',
              brightBlack:'#6272a4', brightRed:'#ff6e6e', brightGreen:'#69ff94', brightYellow:'#ffffa5',
              brightBlue:'#d6acff', brightMagenta:'#ff92df', brightCyan:'#a4ffff', brightWhite:'#ffffff' },
  gruvbox:  { background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945',
              black:'#282828', red:'#cc241d', green:'#98971a', yellow:'#d79921',
              blue:'#458588', magenta:'#b16286', cyan:'#689d6a', white:'#a89984',
              brightBlack:'#928374', brightRed:'#fb4934', brightGreen:'#b8bb26', brightYellow:'#fabd2f',
              brightBlue:'#83a598', brightMagenta:'#d3869b', brightCyan:'#8ec07c', brightWhite:'#ebdbb2' },
  nord:     { background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selection: '#4c566a',
              black:'#3b4252', red:'#bf616a', green:'#a3be8c', yellow:'#ebcb8b',
              blue:'#81a1c1', magenta:'#b48ead', cyan:'#88c0d0', white:'#e5e9f0',
              brightBlack:'#4c566a', brightRed:'#bf616a', brightGreen:'#a3be8c', brightYellow:'#ebcb8b',
              brightBlue:'#81a1c1', brightMagenta:'#b48ead', brightCyan:'#8fbcbb', brightWhite:'#eceff4' },
  tokyonight: { background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selection: '#33467c',
              black:'#15161e', red:'#f7768e', green:'#9ece6a', yellow:'#e0af68',
              blue:'#7aa2f7', magenta:'#bb9af7', cyan:'#7dcfff', white:'#a9b1d6',
              brightBlack:'#414868', brightRed:'#f7768e', brightGreen:'#9ece6a', brightYellow:'#e0af68',
              brightBlue:'#7aa2f7', brightMagenta:'#bb9af7', brightCyan:'#7dcfff', brightWhite:'#c0caf5' },
  eyeGuard: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selection: '#073642',
              black:'#073642', red:'#dc322f', green:'#859900', yellow:'#b58900',
              blue:'#268bd2', magenta:'#d33682', cyan:'#2aa198', white:'#eee8d5',
              brightBlack:'#586e75', brightRed:'#dc322f', brightGreen:'#859900', brightYellow:'#b58900',
              brightBlue:'#268bd2', brightMagenta:'#d33682', brightCyan:'#2aa198', brightWhite:'#fdf6e3' },
  ocean:    { background: '#0b2b40', foreground: '#d7e9f7', cursor: '#7fd4ff', selection: '#1e4a63',
              black:'#0b2b40', red:'#ff5f87', green:'#5fd7a7', yellow:'#ffd787',
              blue:'#5fafff', magenta:'#af87ff', cyan:'#62d6ff', white:'#d7e9f7',
              brightBlack:'#4a6b80', brightRed:'#ff8faf', brightGreen:'#8ff7cf', brightYellow:'#ffe7af',
              brightBlue:'#8fc7ff', brightMagenta:'#cfafff', brightCyan:'#a2e7ff', brightWhite:'#eaf7ff' },
  forest:   { background: '#0f1f0f', foreground: '#cfe8c0', cursor: '#b8e08a', selection: '#1e3a1e',
              black:'#0f1f0f', red:'#d05555', green:'#8fd26f', yellow:'#d8c060',
              blue:'#6fa0c0', magenta:'#b080c0', cyan:'#65c0a0', white:'#cfe8c0',
              brightBlack:'#4a6a4a', brightRed:'#e07070', brightGreen:'#a0e080', brightYellow:'#e8d070',
              brightBlue:'#80b8e0', brightMagenta:'#c090d0', brightCyan:'#78d0b0', brightWhite:'#e8ffe0' },
  violet:   { background: '#1c162a', foreground: '#ddd0f0', cursor: '#c8a8f0', selection: '#3a2a52',
              black:'#241c38', red:'#f06878', green:'#a8e068', yellow:'#f0d068',
              blue:'#8fa0f0', magenta:'#d088f0', cyan:'#7fd0e0', white:'#ddd0f0',
              brightBlack:'#5a4a76', brightRed:'#f88a98', brightGreen:'#c0e888', brightYellow:'#f8e088',
              brightBlue:'#aab0f8', brightMagenta:'#e0a0f8', brightCyan:'#98e0f0', brightWhite:'#f0e8ff' },
  sepia:    { background: '#f5f0e6', foreground: '#3b342c', cursor: '#6b5a45', selection: '#d8cbb0',
              black:'#3b342c', red:'#a05030', green:'#5a7a40', yellow:'#9a7a20',
              blue:'#406080', magenta:'#7a5070', cyan:'#3a7060', white:'#d6cdbd',
              brightBlack:'#8a7f6f', brightRed:'#b06040', brightGreen:'#6a8a50', brightYellow:'#aa8a30',
              brightBlue:'#507090', brightMagenta:'#8a6080', brightCyan:'#4a8070', brightWhite:'#f0eadd' },
};

// ---------- xterm (main stage) ----------
let term = null;
let fit = null;
function ensureTerm() {
  if (term) return;
  // xterm exposed as globals by our vendored UMD builds
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon;
  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    allowProposedApi: true, // enables parser.registerOscHandler for OSC 52 clipboard
    theme: THEMES[state.theme] || THEMES.dark,
    scrollback: 20000, // covers tmux's 20000-line history-limit for review
    scrollOnUserInput: false, // typing doesn't yank the view to the bottom
  });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($termEl);
  // Native scrollback: xterm's own wheel/scrollbar/selection (incl. drag-to-edge
  // auto-scroll) work because we inject tmux's history into xterm's buffer on
  // attach. This wires: follow-pause while scrolled up, and the "reviewing"
  // indicator. (See the "scrollback & follow" section below.)
  term.onScroll((ydisp) => handleTermScroll(ydisp));
  // Wheel: xterm's native viewport scroll is kept, but its arrow-key fallback is
  // BLOCKED. When the wheel can't scroll (at the bottom scrolling down, or top
  // scrolling up), xterm sends \x1b[A/\x1b[B into the pty — any process that
  // echoes raw stdin (cat, gateways) prints them as literal ^[[A/^[[B garbage.
  // Capture phase so we run before xterm's own wheel handler.
  term.element.addEventListener('wheel', (e) => {
    if (!term || term.buffer.active.type !== 'normal') return;
    const b = term.buffer.active;
    const atBottom = b.viewportY >= b.baseY;
    const atTop = b.viewportY <= 0;
    const blocked =
      Math.abs(e.deltaX) > 0 ||                       // no h-scroll -> xterm would send left/right arrows
      (e.deltaY > 0 && atBottom) ||                   // wheel-down at bottom -> would send Down
      (e.deltaY < 0 && atTop);                        // wheel-up at top -> would send Up
    if (blocked) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true, passive: false });
  // PgUp/PgDn scroll the deck's native scrollback; never forward them to tmux
  // (its root PPage binding would drop the pane into copy-mode).
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      if (term) term.scrollPages(e.key === 'PageUp' ? -1 : 1);
      return false;
    }
    return true;
  });
  term.onData((d) => {
    // never forward mouse-report sequences into the pane — apps in the deck
    // don't use them (tmux mouse is off), and a raw-echoing foreground prints
    // them as ^[[<..M garbage (SGR) or ^[[M.. (X10)
    d = d.replace(/\x1b\[<[0-9;]*[Mm]/g, '').replace(/\x1b\[M[\x00-\xff]{0,3}/g, '');
    if (!d) return;
    if (term.buffer.active.viewportY < term.buffer.active.baseY) {
      // any input while scrolled up snaps back to live
      setTimeout(() => term.scrollToBottom(), 0);
    }
    sendInput(d);
  });
  // OSC 52: when a pane writes to the clipboard (e.g. tmux copy-mode, vim yank),
  // capture it into the deck's SHARED clipboard so it's available across panes.
  try {
    term.parser.registerOscHandler(52, (data) => {
      // data = "c;<base64>" or "<base64>" ; second segment is the base64 payload
      const idx = data.indexOf(';');
      const payload = idx >= 0 ? data.slice(idx + 1) : data;
      const text = b64Decode(payload);
      if (text) setSharedClipboard(text);
      return false; // also let xterm do its own clipboard handling
    });
  } catch (e) { console.warn('osc52 handler unavailable:', e); }
  requestAnimationFrame(() => { fit.fit(); resizeMain(); });
}

// ---- shared clipboard ----
function setSharedClipboard(text) {
  state.clipboard = text;
  try { localStorage.setItem('deck-clipboard', text); } catch {}
  const el = document.getElementById('cb-value');
  if (el) el.textContent = text;
  const count = document.getElementById('cb-len');
  if (count) count.textContent = text.length + ' chars';
}
function pasteToFocused(text) {
  if (!state.active || !state.tokens[state.active]) return;
  if (text == null) text = state.clipboard;
  // bracketed paste so multiline history is pasted verbatim
  const t = String(text).replace(/\r?\n/g, '\r');
  send({ t: 'input', token: state.tokens[state.active], data: '\x1b[200~' + t + '\x1b[201~' });
}
function copySelectionToClipboard() {
  if (!term) return;
  const sel = term.getSelection();
  if (sel) setSharedClipboard(sel);
}
// Expose clipboard helpers for programmatic use / testing.
window.setSharedClipboard = setSharedClipboard;
window.getSharedClipboard = () => state.clipboard;
window.pasteToFocused = pasteToFocused;
function resizeMain() {
  // Keep the tmux pane in sync with the actual visible viewport so the prompt
  // sits at the bottom of the screen and history flows down from the top.
  if (!fit || !term) return;
  try { fit.fit(); } catch {}
  const cols = Math.max(20, term.cols || 80);
  const rows = Math.max(5, term.rows || 24);
  if (state.active && state.tokens[state.active]) {
    send({ t: 'resize', token: state.tokens[state.active], cols, rows });
  }
  if (term) term.scrollToBottom();
}
window.addEventListener('resize', () => resizeMain());

// ---------- screen-clear detection (clear wipes scrollback too) ----------
// tmux consumes the pane's erase sequences and redraws its client with
// ED0-then-home (`\x1b[J\x1b[H`) — that signature IS a screen clear. Bare
// ED2/ED3 must NOT match: TUI inits (vim/less/htop) emit those in their
// redraws (tmux passes them through), and tmux keeps xterm in the normal
// buffer the whole time, so there is no alternate-screen to fall back on.
function isScreenClear(data) {
  return /(\x1b\[[0-9;?]*J\x1b\[H|\x1bc)/.test(data);
}

// ---------- scrollback & follow (native xterm review) ----------
// tmux's history is injected into xterm's OWN buffer on attach (see attachMain),
// so the browser scrollbar / wheel / text selection all behave like a normal
// terminal — including select-and-drag-to-edge auto-scroll, which needs the
// scrollback to live in xterm (copy-mode scrolling would break the anchor).
//   * scrolled up -> tell the server to pause the live stream (it buffers), and
//     flash a "reviewing" indicator
//   * back at the bottom -> resume (server flushes the buffered output)
let followState = { sentOff: false, flashTimer: 0 };
let attachGen = 0; // attach sequence id; stale injects are dropped
function setFollow(on) {
  const token = state.active ? state.tokens[state.active] : null;
  if (!token) return;
  if (!on && !followState.sentOff) { send({ t: 'follow', token, on: false }); followState.sentOff = true; }
  else if (on && followState.sentOff) { send({ t: 'follow', token, on: true }); followState.sentOff = false; }
}
// Force-hold/release the live stream during attach, independent of scroll-follow.
function holdLive(token) { if (token) send({ t: 'follow', token, on: false }); }
function releaseLive(token) { if (token) { send({ t: 'follow', token, on: true }); followState.sentOff = false; } }
function handleTermScroll(ydisp) {
  if (!term) return;
  const atBottom = ydisp >= term.buffer.active.baseY;
  if (!atBottom) { setFollow(false); flashReviewing(); }
  else setFollow(true);
}
function flashReviewing() {
  const m = $stageMeta;
  if (m.dataset.flash !== '1') {
    m.dataset.flash = '1';
    m.dataset.prev = m.textContent;
    m.textContent = (m.dataset.prev || '') + ' · reviewing history';
    m.classList.add('reviewing');
  }
  clearTimeout(followState.flashTimer);
  followState.flashTimer = setTimeout(() => {
    m.dataset.flash = ''; m.classList.remove('reviewing');
    m.textContent = m.dataset.prev || (state.active ? 'tmux · live' : '');
  }, 1500);
}
// theme select
$themeSelect.value = state.theme;
$themeSelect.addEventListener('change', () => {
  state.theme = $themeSelect.value;
  try { localStorage.setItem('deck-theme', state.theme); } catch {}
  if (term) term.options.theme = THEMES[state.theme] || THEMES.dark;
  applyThemeCss(state.theme);
});
function applyThemeCss(theme) {
  const t = THEMES[theme] || THEMES.dark;
  document.body.style.background = t.background;
  // Drive the app chrome + scrollbars from the theme palette so panels,
  // borders and scrollbars follow the selected theme (not just the terminal).
  const root = document.documentElement.style;
  // derive a panel/border palette from the theme background (simple shade)
  const bg = t.background;
  root.setProperty('--bg', bg);
  root.setProperty('--panel', shade(bg, 1.06));
  root.setProperty('--panel-2', shade(bg, 1.12));
  root.setProperty('--border', shade(bg, 1.28));
  root.setProperty('--text', t.foreground);
  root.setProperty('--muted', t.brightBlack || '#7b8494');
  root.setProperty('--accent', t.brightBlue || t.blue || '#4f8cff');
  root.setProperty('--accent-2', t.green || '#6ee7b7');
}
// blend a hex color toward white/black by a factor (1 = unchanged, >1 lighter)
function shade(hex, f) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// ---------- clipboard popover ----------
function refreshClipboardUI() {
  setSharedClipboard(state.clipboard); // repaint len + value
}
$btnClip.addEventListener('click', () => {
  const show = $clipPop.classList.toggle('hidden');
  $btnClip.classList.toggle('active', !show);
  if (!show) refreshClipboardUI();
});
document.getElementById('clip-close').addEventListener('click', () => {
  $clipPop.classList.add('hidden'); $btnClip.classList.remove('active');
});
document.getElementById('clip-copy-sel').addEventListener('click', copySelectionToClipboard);
document.getElementById('clip-paste').addEventListener('click', () => pasteToFocused());
document.getElementById('clip-clear').addEventListener('click', () => setSharedClipboard(''));
// Escape closes popover too
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $clipPop.classList.add('hidden'); $btnClip.classList.remove('active'); } });

// ---------- WebSocket ----------
let ws = null;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { if (state.active) attachMain(state.active); };
  ws.onclose = () => setTimeout(connect, 1500);
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    const activeTok = state.active ? state.tokens[state.active] : null;
    if (msg.t === 'data' && activeTok && msg.token === activeTok) {
      if (term) {
        // `clear` / Ctrl-L / reset inside a pane: tmux swallows the erase and
        // redraws as ED0+home (or the program emits ED2/ED3/RIS). When that
        // lands in the NORMAL buffer (not a TUI's alternate screen), treat it as
        // a screen clear and wipe the injected scrollback too — a fresh terminal.
        // tmux's own history is cleared via clearhist so it stays gone.
        if (isScreenClear(msg.data) && term.buffer.active.type === 'normal') {
          term.write(msg.data, () => {
            clearDeckBuffer();
          });
          send({ t: 'clearhist', session: state.active });
        } else {
          term.write(msg.data);
        }
      }
    } else if (msg.t === 'bye') {
      // session ended
      if (state.active && msg.token === state.tokens[state.active]) setActive(null);
    } else if (msg.t === 'snap') {
      const card = cardsEl.get(msg.session);
      if (card) renderThumb(card, msg.data);
    } else if (msg.t === 'hist') {
      // tmux scrollback (colors + joined lines) for the active session, written
      // into xterm at STAGE size: the capture's last `rows` lines re-render the
      // live screen, everything above becomes native scrollback. The live stream
      // is held during attach (holdLive), so this is the only writer; releasing
      // it (below) lets buffered live output overwrite just the screen tail.
      if (msg.session === state.active && term) {
        const data = String(msg.data || '');
        const gen = attachGen;
        const token = state.tokens[state.active];
        if (data) {
          // clear-then-write the full capture (history + screen): the clear drops
          // whatever attach frames leaked in; the capture's last `rows` lines
          // become the live screen and everything above is native scrollback.
          try { term.clear(); } catch {}
          term.write(data, () => {
            if (gen !== attachGen) return; // a newer attach superseded this one
            term.scrollToBottom();
            releaseLive(token);
          });
        } else {
          releaseLive(token);
        }
      }
    }
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

const cardsEl = new Map(); // sessionName -> {el, preview, dot}

async function refreshSessions() {
  const r = await fetch(API + '/api/sessions'); const j = await r.json();
  if (!j.ok) return;
  const names = j.sessions.map((s) => s.name);
  // remove cards for deleted sessions
  for (const n of [...cardsEl.keys()]) {
    if (!names.includes(n)) { cardsEl.get(n).el.remove(); cardsEl.delete(n); }
  }
  for (const s of j.sessions) {
    if (!cardsEl.has(s.name)) addCard(s.name);
  }
  // re-apply the user's saved thumbnail order (new sessions go last)
  const order = loadCardOrder(names);
  for (let i = order.length - 1; i >= 0; i--) {
    const c = cardsEl.get(order[i]);
    if (c) $cards.insertBefore(c.el, $cards.firstChild);
  }
}

function addCard(name) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.name = name;
  el.draggable = true;
  el.innerHTML = `
    <div class="card-head"><span class="card-name"></span>
      <span class="card-controls"><span class="dot live"></span>
        <button class="card-collapse" title="Collapse / expand preview">▾</button></span></div>
    <div class="card-preview"></div>`;
  el.querySelector('.card-name').textContent = name;
  el.addEventListener('click', (e) => {
    // don't focus when clicking the collapse control
    if (e.target.closest('.card-collapse')) return;
    setActive(name);
  });
  const collapseBtn = el.querySelector('.card-collapse');
  const preview = el.querySelector('.card-preview');
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = el.classList.toggle('collapsed');
    collapseBtn.textContent = collapsed ? '▸' : '▾';
    collapseBtn.title = collapsed ? 'Expand preview' : 'Collapse preview';
  });
  // drag to reorder thumbnails (order persisted to localStorage)
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', name);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const from = e.dataTransfer.getData('text/plain');
    if (from && from !== name) el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const from = e.dataTransfer.getData('text/plain');
    if (!from || from === name) return;
    reorderCards(from, name);
  });
  $cards.appendChild(el);
  const card = { el, preview, dot: el.querySelector('.dot'), collapseBtn };
  cardsEl.set(name, card);
  // start live snapshot loop for this session
  pollSnapshot(name);
}

// move the card named `from` to directly before the card named `to`
function reorderCards(from, to) {
  const fromEl = cardsEl.get(from)?.el;
  const toEl = cardsEl.get(to)?.el;
  if (!fromEl || !toEl) return;
  $cards.insertBefore(fromEl, toEl);
  persistCardOrder();
}

function persistCardOrder() {
  const order = [...$cards.children].map((c) => c.dataset.name);
  try { localStorage.setItem('deck-card-order', JSON.stringify(order)); } catch {}
}

function loadCardOrder(names) {
  try {
    const saved = JSON.parse(localStorage.getItem('deck-card-order') || '[]');
    if (!Array.isArray(saved) || !saved.length) return names;
    // keep saved order for known sessions, append any new ones at the end
    const known = new Set(names);
    const ordered = saved.filter((n) => known.has(n));
    for (const n of names) if (!ordered.includes(n)) ordered.push(n);
    return ordered;
  } catch { return names; }
}

function sanitizeSnap(s) {
  // strip ANSI escapes for the thumbnail (plain text preview is fine): CSI
  // (incl. SGR mouse `<...M`), OSC, charset/keypad modes, RIS, AND caret-form
  // escapes that were echoed into a pane as literal text (^[[A / ^[[B / ^[[<..)
  // — plus any leftover control bytes, so previews never show garbage.
  return String(s)
    .replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, '')          // CSI incl. SGR mouse
    .replace(/\x1b\][^\x07]*\x07/g, '')                 // OSC ... BEL
    .replace(/\x1b[()][0-9A-B]/g, '')                   // charset selection
    .replace(/\x1b[=>]/g, '')                           // keypad modes
    .replace(/\x1bc/g, '')                              // RIS
    .replace(/\^\[\[[0-9;?<>]*[a-zA-Z]/g, '')           // caret-form CSI garbage
    .replace(/\^\[[()=]?[0-9A-B]?/g, '')                // caret-form single-byte esc
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');  // other control bytes
}

// Render a FULL terminal thumbnail: the entire captured content (visible screen
// + scrollback) scaled down to fit the card — a true zoomed-out screenshot.
//
// Cross-browser note: Chrome enforces a minimum font size (user setting) and
// would clamp tiny font-size values, overflowing the card, while Safari renders
// them fine. So we render at the normal font and shrink with transform: scale()
// instead — transforms are NOT affected by the min-font-size setting, and they
// scale both axes so the miniature keeps the terminal's aspect ratio.
function renderThumb(card, raw) {
  const outer = card.preview;
  let inner = outer.__inner;
  if (!inner) {
    inner = document.createElement('div');
    inner.style.whiteSpace = 'pre';
    inner.style.transformOrigin = 'top left';
    outer.appendChild(inner);
    outer.__inner = inner;
  }
  const clean = sanitizeSnap(raw).replace(/\s+$/, '');
  inner.textContent = clean;

  // usable card height = box minus the preview's 4px top+bottom padding
  const h = (outer.clientHeight || 96) - 8;
  const lineCount = clean.split('\n').length;
  const BASE = 7; // px, the normal thumbnail font
  const MIN = 1;  // px equivalent, hard readability floor
  const lineH = 1.25; // CSS line-height on .card-preview
  const fit = Math.floor((h / (lineCount * lineH)) * 10) / 10;
  const fs = Math.max(MIN, Math.min(BASE, fit));

  if (fs < BASE) {
    inner.style.fontSize = BASE + 'px';
    inner.style.transform = 'scale(' + (fs / BASE) + ')';
  } else {
    inner.style.fontSize = fs + 'px';
    inner.style.transform = 'none';
  }
}

async function pollSnapshot(name) {
  const loop = async () => {
    const card = cardsEl.get(name);
    if (!card) return; // card removed -> stop
    if (card.el.classList.contains('collapsed')) { setTimeout(loop, SNAP_INTERVAL); return; } // preview hidden -> skip
    send({ t: 'snapshot', session: name });
    setTimeout(loop, SNAP_INTERVAL);
  };
  loop();
}

// ---------- active / main ----------
function setActive(name) {
  state.active = name;
  followState.sentOff = false;
  // NOTE: keep state.tall from the previous attach of this session (if any) so
  // the re-attach can grow xterm tall before the redraws; it's refreshed when
  // the session's hist arrives. Reset only happens on first-ever attach (0).
  $stageEmpty.classList.toggle('hidden', !!name);
  $termEl.classList.toggle('hidden', !name);
  updateCards();
  if (name) {
    ensureTerm();
    $stageTitle.textContent = name;
    $stageMeta.textContent = 'tmux · live';
    $notes.value = state.notes[name] || '';
    attachMain(name);
    refreshProps();
  } else {
    $stageTitle.textContent = '—';
    $stageMeta.textContent = '';
    $notes.value = '';
    if (term) { term.dispose(); term = null; fit = null; }
  }
}

function attachMain(name) {
  // ALWAYS re-attach on activation: a cached token does NOT mean the screen is
  // intact — the xterm buffer gets cleared on switch, and tmux only sends a
  // full redraw to a freshly attached client. Re-sending 'main' makes the
  // server respawn the attach pty so the pane repaints completely.
  const token = 'main:' + name;
  state.tokens[name] = token;
  ensureTerm();
  const attach = () => {
    // fit to the actual panel size first, then attach the pty at that size
    try { fit.fit(); } catch {}
    const cols = Math.max(20, term.cols || 80);
    const rows = Math.max(5, term.rows || 24);
    const gen = ++attachGen;
    send({ t: 'main', token, session: name, cols, rows });
    send({ t: 'resize', token, cols, rows });
    // HOLD the live stream while we inject history, so the injection is the only
    // writer to the xterm buffer (the hold is released once the capture parses).
    // Sent AFTER 'main' so the server's follow handler finds the pty.
    holdLive(token);
    setTimeout(() => { if (gen === attachGen) send({ t: 'history', session: name }); }, 250);
  };
  // First attach: wait a beat for xterm to be open + fitted. Re-activation:
  // the term is already fitted, so attach immediately for snappy switching.
  if (term && term.cols) attach();
  else setTimeout(attach, 80);
}

function sendInput(data) {
  if (!state.active) return;
  send({ t: 'input', token: state.tokens[state.active], data });
}

// ---------- notes (local persistence via localStorage) ----------
$notes.addEventListener('input', () => {
  if (!state.active) return;
  state.notes[state.active] = $notes.value;
  try { localStorage.setItem('deck-notes', JSON.stringify(state.notes)); } catch {}
});
try { state.notes = JSON.parse(localStorage.getItem('deck-notes') || '{}') || {}; } catch { state.notes = {}; }

// ---------- toolbar actions ----------
function updateCards() {
  for (const [n, c] of cardsEl) c.el.classList.toggle('active', n === state.active);
}

$btnNew.addEventListener('click', () => { $modal.classList.remove('hidden'); $newName.focus(); });
$modal.addEventListener('click', (e) => { if (e.target === $modal) $modal.classList.add('hidden'); });
document.getElementById('modal-cancel').addEventListener('click', () => $modal.classList.add('hidden'));
document.getElementById('modal-ok').addEventListener('click', createWork);
$newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') createWork(); });

async function createWork() {
  const name = $newName.value.trim() || ('work-' + (state.sessions.length + 1));
  $modal.classList.add('hidden');
  const r = await fetch(API + '/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const j = await r.json();
  $newName.value = '';
  await refreshSessions();
  setActive(j.name || name);
}

// ---------- rename ----------
$btnRename.addEventListener('click', () => {
  if (!state.active) return;
  $renameInput.value = state.active;
  $modalRename.classList.remove('hidden');
  $renameInput.focus();
  $renameInput.select();
});
$modalRename.addEventListener('click', (e) => { if (e.target === $modalRename) $modalRename.classList.add('hidden'); });
document.getElementById('rename-cancel').addEventListener('click', () => $modalRename.classList.add('hidden'));
document.getElementById('rename-ok').addEventListener('click', doRename);
$renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); });

async function doRename() {
  if (!state.active) return;
  const oldName = state.active;
  const newName = $renameInput.value.trim();
  $modalRename.classList.add('hidden');
  if (!newName || newName === oldName) return;
  const r = await fetch(API + '/api/rename', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old: oldName, news: newName }),
  });
  const j = await r.json();
  if (!j.ok) { alert('Rename failed: ' + (j.error || '')); return; }
  // move token + notes to the new name
  state.tokens[newName] = state.tokens[oldName];
  delete state.tokens[oldName];
  state.notes[newName] = state.notes[oldName];
  delete state.notes[oldName];
  state.active = newName;
  $stageTitle.textContent = newName;
  await refreshSessions(); // rebuilds cards w/ new name
  setActive(newName);
}

function clearDeckBuffer() {
  try { term.clear(); } catch {}
  try { term.scrollToBottom(); } catch {}
  // Force a full canvas repaint on the next frame: after a buffer wipe some
  // GPU compositors keep ghost pixels from the previous content at the bottom
  // rows (renders as faint rows of dots on some machines). refresh() redraws
  // every row from the now-empty buffer, scrubbing the ghosts.
  requestAnimationFrame(() => { if (term) { try { term.refresh(0, term.rows - 1); } catch {} } });
}

// ---------- clear history ----------
// Wipe the focused session: tmux pane history (so it stays gone across
// re-attaches), the deck's injected xterm scrollback, and a C-l to redraw the
// visible frame — shells redraw the prompt, TUIs/REPLs treat C-l as redraw,
// nothing ever executes it as a command.
$btnClear.addEventListener('click', () => {
  if (!state.active || !term) return;
  send({ t: 'clearhist', session: state.active });
  clearDeckBuffer();
  sendInput('\x0c');
});

// ---------- kill ----------
$btnClose.addEventListener('click', async () => {
  if (!state.active) return;
  if (!confirm(`Kill session "${state.active}"? (Work inside will be lost)`)) return;
  const name = state.active;
  await fetch(API + '/api/kill', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  delete state.tokens[name];
  if (cardsEl.has(name)) { cardsEl.get(name).el.remove(); cardsEl.delete(name); }
  setActive(null);
  refreshSessions();
});

// ---------- demo: send a colorful command to show theme/highlight ----------
$btnDemo.addEventListener('click', () => {
  if (!state.active || !state.tokens[state.active]) return;
  const demo = [
    'clear',
    'echo -e "\\e[1;31m█\\e[0m \\e[1;32mterminal\\e[0m \\e[1;33m-deck\\e[0m \\e[1;34mtheme\\e[0m \\e[1;35mdemo\\e[0m"',
    'printf "\\e[38;5;196mred\\e[0m \\e[38;5;46mgreen\\e[0m \\e[38;5;214myellow\\e[0m \\e[38;5;21mblue\\e[0m\\n"',
    'echo -e "  \\e[44m█\\e[44m█\\e[41m█\\e[41m█\\e[42m█\\e[42m█\\e[43m█\\e[43m█\\e[45m█\\e[45m█\\e[46m█\\e[46m█\\e[0m  256-color bar"',
    'ls --color=auto -la',
    'printf "\\n$ "',
  ];
  let i = 0;
  const t = setInterval(() => {
    if (i >= demo.length) { clearInterval(t); return; }
    sendInput(demo[i] + '\r');
    i++;
  }, 400);
});

// ---------- properties panel ----------
$btnProps.addEventListener('click', () => { toggleProps(true); });
$propsClose.addEventListener('click', () => { toggleProps(false); });
function toggleProps(show) {
  const on = show !== undefined ? show : !document.body.classList.contains('show-props');
  document.body.classList.toggle('show-props', on);
  $props.classList.toggle('hidden', !on);
  $btnProps.classList.toggle('active', on);
  if (on && state.active) refreshProps();
}
let propsTimer = null;
function refreshProps() {
  if (!state.active) { clearTimeout(propsTimer); return; }
  fetch(API + '/api/info?name=' + encodeURIComponent(state.active))
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) return;
      document.getElementById('p-work').textContent = j.name;
      document.getElementById('p-pwd').textContent = j.pwd;
      document.getElementById('p-ip').textContent = j.ip;
      document.getElementById('p-host').textContent = j.hostname;
      document.getElementById('p-up').textContent = j.uptime;
      document.getElementById('p-date').textContent = j.date;
      // history: reverse so newest is at the bottom, keep raw-ish
      const lines = (j.history || []).filter((l) => l.trim().length || l === '');
      document.getElementById('p-history').textContent = lines.join('\n').slice(-4000);
    })
    .catch(() => {});
  clearTimeout(propsTimer);
  propsTimer = setTimeout(refreshProps, PROPS_INTERVAL);
}

// ---------- view modes ----------
$btnGrid.addEventListener('click', () => {
  document.body.classList.toggle('grid-only');
  $btnGrid.classList.toggle('active', document.body.classList.contains('grid-only'));
});
$btnZoom.addEventListener('click', () => {
  document.body.classList.toggle('zoom');
  $btnZoom.classList.toggle('active', document.body.classList.contains('zoom'));
});

// ---------- boot ----------
(async function boot() {
  connect();
  applyThemeCss(state.theme);
  await refreshSessions();
  // auto-select first real session if any (DOM order = saved user order)
  if (!state.active && $cards.firstElementChild) setActive($cards.firstElementChild.dataset.name);
})();
