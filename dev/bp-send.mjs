// send a bracketed paste through the deck's real input path into the pane
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9001/ws');
let attached = false;

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'main', token: 'main:bptest', session: "bptest", cols: 132, rows: 43 }));
  // request the capture; the attach hold releases after it parses
  setTimeout(() => ws.send(JSON.stringify({ t: 'history', session: "bptest" })), 300);
});
ws.on('message', (d) => {
  const msg = JSON.parse(d.toString());
  if (msg.t === 'hist' && !attached) {
    attached = true;
    // bracketed paste, exactly what xterm now sends
    const text = 'echo start\n    -v one \\\n    -v two \\\n    -e THREE=three \\\n    end';
    const payload = '\x1b[200~' + text.replace(/\r?\n/g, '\r') + '\x1b[201~';
    ws.send(JSON.stringify({ t: 'input', token: 'main:bptest', data: payload }));
    console.log('sent bracketed paste, bytes:', payload.length);
    setTimeout(() => { ws.close(); process.exit(0); }, 1200);
  }
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8000);
