// Probe v2: dump EVERY chunk with a cat -v preview so we can see the clear redraw.
import WebSocket from 'ws';
import { execSync } from 'child_process';

const SESS = process.env.PROBE_SESS || 'cleartest';
const TMP = process.env.TMUX_TMPDIR || '/var/folders/0_/2nfzd8lx4q39l8tqz34tzvh40000gn/T/terminal-deck';
const T = (args) => execSync(`TMUX_TMPDIR="${TMP}" tmux -L deck ${args}`, { encoding: 'utf8' }).trim();

const ws = new WebSocket('ws://127.0.0.1:9000/ws');
let n = 0;
const seen = [];
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'main', token: 'main:probe2', session: SESS, cols: 100, rows: 26 }));
  ws.send(JSON.stringify({ t: 'resize', token: 'main:probe2', cols: 100, rows: 26 }));
  setTimeout(() => T(`send-keys -t ${SESS} 'seq 1 80' Enter`), 500);
});
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'data') {
    n++;
    const clean = m.data.replace(/\x1b/g, '^[').replace(/[^\x20-\x7e^]/g, '.');
    seen.push(`#${n} [${m.data.length}B] ${clean.slice(0, 160)}`);
  }
});
setTimeout(() => T(`send-keys -t ${SESS} 'clear' Enter`), 2000);
setTimeout(() => T(`send-keys -t ${SESS} 'clear -x' Enter`), 5000);
setTimeout(() => {
  console.log(seen.join('\n---\n'));
  process.exit(0);
}, 8000);
