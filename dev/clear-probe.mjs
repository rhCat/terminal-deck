// Probe: what does the deck's pty stream actually contain when `clear` runs?
// Attach to a scratch session, build history, run clear, dump the byte stream.
import WebSocket from 'ws';
import { execSync } from 'child_process';

const SESS = process.env.PROBE_SESS || 'cleartest';
const TMP = process.env.TMUX_TMPDIR || '/var/folders/0_/2nfzd8lx4q39l8tqz34tzvh40000gn/T/terminal-deck';
const T = (args) => execSync(`TMUX_TMPDIR="${TMP}" tmux -L deck ${args}`, { encoding: 'utf8' }).trim();

const ws = new WebSocket('ws://127.0.0.1:9000/ws');
const chunks = [];
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'main', token: 'main:probe', session: SESS, cols: 100, rows: 26 }));
  ws.send(JSON.stringify({ t: 'resize', token: 'main:probe', cols: 100, rows: 26 }));
  ws.send(JSON.stringify({ t: 'history', session: SESS }));
  setTimeout(() => {
    console.log('--- building history: seq 1 80 ---');
    T(`send-keys -t ${SESS} 'seq 1 80' Enter`);
  }, 600);
});
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'data') chunks.push(m.data);
  if (m.t === 'hist') chunks.push(''); // ignore capture content for this probe
});
setTimeout(() => {
  console.log('--- running clear ---');
  T(`send-keys -t ${SESS} 'clear' Enter`);
}, 2500);
setTimeout(() => {
  console.log('--- running clear -x (also erases scrollback per terminfo) ---');
  T(`send-keys -t ${SESS} 'clear -x' Enter`);
}, 5000);
setTimeout(() => {
  let saw2J = 0, saw3J = 0, sawRIS = 0, saw1049 = 0;
  const sample = [];
  for (const c of chunks) {
    if (c.includes('\x1b[2J')) saw2J++;
    if (c.includes('\x1b[3J')) saw3J++;
    if (c.includes('\x1bc')) sawRIS++;
    if (c.includes('\x1b[?1049')) saw1049++;
    if (c.includes('\x1b[2J') || c.includes('\x1b[3J')) sample.push(c.replace(/\x1b/g, '^[').slice(0, 200));
  }
  console.log('=== RESULT ===');
  console.log(JSON.stringify({ chunks: chunks.length, saw2J, saw3J, sawRIS, saw1049, samples: sample.slice(0, 5) }, null, 1));
  process.exit(0);
}, 8000);
