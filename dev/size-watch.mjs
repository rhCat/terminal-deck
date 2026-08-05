// attach and STAY attached; print window size on demand via SIGUSR1-free polling
import WebSocket from 'ws';
import { execSync } from 'child_process';

const SESS = process.argv[2] || 'mac';
const COLS = parseInt(process.argv[3] || '100', 10);
const ROWS = parseInt(process.argv[4] || '20', 10);

const ws = new WebSocket('ws://localhost:9001/ws');
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'main', token: 'main:' + SESS, session: SESS, cols: COLS, rows: ROWS }));
  ws.send(JSON.stringify({ t: 'resize', token: 'main:' + SESS, cols: COLS, rows: ROWS }));
  setTimeout(() => ws.send(JSON.stringify({ t: 'history', session: SESS })), 300);
  console.log('attached', COLS + 'x' + ROWS, '— staying connected');
});
ws.on('message', (d) => {
  const msg = JSON.parse(d.toString());
  if (msg.t === 'hist') {
    console.log('READY', execSync(
      `export TMUX_TMPDIR=/var/folders/0_/2nfzd8lx4q39l8tqz34tzvh40000gn/T/terminal-deck; tmux -L deck display-message -t ${SESS} -p 'window=#{window_width}x#{window_height}'`, { encoding: 'utf8' }).trim());
  }
});
// poll window size every second
setInterval(() => {
  const out = execSync(
    `export TMUX_TMPDIR=/var/folders/0_/2nfzd8lx4q39l8tqz34tzvh40000gn/T/terminal-deck; tmux -L deck display-message -t ${SESS} -p '#{window_width}x#{window_height}'`, { encoding: 'utf8' }).trim();
  console.log('WINDOW', out);
}, 1000);
setTimeout(() => process.exit(0), 12000);
