import { createServer } from 'http';
import { app, attachTo } from './server.js';

const server = createServer(app);
attachTo(server);

const PORT = process.env.PORT || 9000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`terminal-deck listening on http://127.0.0.1:${PORT}`);
});
