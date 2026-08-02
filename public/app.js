// terminal-deck — browser-side app.
// Talks to the Node backend over one WebSocket. Sessions (works) live in
// persistent tmux; this page is just a viewer/controller.

const API = '';
const SNAP_INTERVAL = 1200; // ms between live thumbnail snapshots

const state = {
  sessions: [],      // [{name}]
  active: null,      // currently focused session name
  notes: {},         // session -> notes text (local, could be persisted server-side)
  tokens: {},        // session -> main terminal token
};

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
const $modal = document.getElementById('modal');
const $newName = document.getElementById('new-name');

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
    theme: { background: '#000', foreground: '#d7dce6' },
    scrollback: 4000,
  });
  fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($termEl);
  term.onData((d) => sendInput(d));
  requestAnimationFrame(() => fit.fit());
}
window.addEventListener('resize', () => { if (fit) fit.fit(); });

// ---------- WebSocket ----------
let ws = null;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => { if (state.active) attachMain(state.active); };
  ws.onclose = () => setTimeout(connect, 1500);
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === 'data' && msg.token === state.active) {
      if (term) term.write(msg.data);
    } else if (msg.t === 'bye') {
      // session ended
      if (msg.token === state.active) setActive(null);
    } else if (msg.t === 'snap') {
      const card = cardsEl.get(msg.session);
      if (card) card.preview.textContent = sanitizeSnap(msg.data).slice(0, cardPreviewChars(card));
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
}

function addCard(name) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.name = name;
  el.innerHTML = `
    <div class="card-head"><span class="card-name"></span>
      <span class="dots"><span class="dot live"></span></span></div>
    <div class="card-preview"></div>`;
  el.querySelector('.card-name').textContent = name;
  el.addEventListener('click', () => setActive(name));
  $cards.appendChild(el);
  const card = { el, preview: el.querySelector('.card-preview'), dot: el.querySelector('.dot') };
  cardsEl.set(name, card);
  // start live snapshot loop for this session
  pollSnapshot(name);
}

function cardPreviewChars(card) {
  const w = card.preview.clientWidth || 200;
  const h = card.preview.clientHeight || 96;
  return Math.floor((w / 4.2) * (h / 9) * 2); // rough, tiny mono font
}

function sanitizeSnap(s) {
  // strip ANSI escapes for the thumbnail (plain text preview is fine)
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

async function pollSnapshot(name) {
  const loop = async () => {
    if (!cardsEl.has(name)) return; // card removed -> stop
    send({ t: 'snapshot', session: name });
    setTimeout(loop, SNAP_INTERVAL);
  };
  loop();
}

// ---------- active / main ----------
function setActive(name) {
  state.active = name;
  $stageEmpty.classList.toggle('hidden', !!name);
  $termEl.classList.toggle('hidden', !name);
  updateCards();
  if (name) {
    ensureTerm();
    $stageTitle.textContent = name;
    $stageMeta.textContent = 'tmux · live';
    $notes.value = state.notes[name] || '';
    attachMain(name);
  } else {
    $stageTitle.textContent = '—';
    $stageMeta.textContent = '';
    $notes.value = '';
    if (term) { term.dispose(); term = null; fit = null; }
  }
}

function attachMain(name) {
  if (state.tokens[name]) { if (term) term.clear(); return; }
  const token = 'main:' + name;
  state.tokens[name] = token;
  ensureTerm();
  // a touch of delay for the xterm to be open
  setTimeout(() => {
    send({ t: 'main', token, session: name, cols: term.cols, rows: term.rows });
    if (term) term.clear();
  }, 60);
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
  await refreshSessions();
  // auto-select first real session if any
  if (!state.active && cardsEl.size) setActive(cardsEl.keys().next().value);
})();
