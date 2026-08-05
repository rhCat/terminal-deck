// stale-client safety check: attach without ever requesting 'history'.
// The server must release the attach hold after ~3s so live output flows.
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:9000/ws');
let got = 0;
let first = null;
const t0 = Date.now();
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'main', token: 'main:staletest', session: 'mac', cols: 80, rows: 26 }));
  ws.send(JSON.stringify({ t: 'resize', token: 'main:staletest', cols: 80, rows: 26 }));
  console.log('sent main (no history request) — waiting for 3s release timeout...');
});
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'data') {
    got += m.data.length;
    if (!first) first = m.data.slice(0, 40);
  }
});
setTimeout(() => {
  const dt = Date.now() - t0;
  console.log(`${dt}ms elapsed; data received: ${got} bytes`);
  console.log(got > 0 ? 'PASS — stale client unfrozen (live output flowed)' : 'FAIL — still held, terminal would be frozen');
  process.exit(got > 0 ? 0 : 1);
}, 4500);
