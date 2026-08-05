// attach a pty at a specific size and print the window size tmux gives it
import WebSocket from 'ws';
import { execSync } from 'child_process';

const SESS = process.argv[2] || 'sizetest';
const COLS = parseInt(process.argv[3] || '80', 10);
const ROWS = parseInt(process.argv[4] || '12', 10);

const ws = new WebSocket('ws://localhost:9001/ws');
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'main', token: 'main:' + SESS, session: SESS, cols: COLS, rows: ROWS }));
  ws.send(JSON.stringify({ t: 'resize', token: 'main:' + SESS, cols: COLS, rows: ROWS }));
  setTimeout(() => {
    const out = execSync(
      `export TMUX_TMPDIR=/var/folders/0_/2nfzd8lx4q39l8tqz34tzvh40000gn/T/terminal-deck; tmux -L deck display-message -t ${SESS} -p 'window=#{window_width}x#{window_height} pane=#{pane_width}x#{pane_height}'`,
      { encoding: 'utf8' }
    );
    console.log('requested', COLS + 'x' + ROWS, '->', out.trim());
    process.exit(0);
  }, 1500);
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8000);
