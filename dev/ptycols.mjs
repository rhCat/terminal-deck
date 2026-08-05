import pty from 'node-pty';
const p = pty.spawn('/bin/zsh', [], { cols: 80, rows: 24, name: 'xterm-256color' });
console.log('spawned cols=', p.cols, 'rows=', p.rows);
p.resize(100, 20);
console.log('after resize cols=', p.cols, 'rows=', p.rows);
p.kill();
process.exit(0);
