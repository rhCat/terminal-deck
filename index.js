import { createServer } from 'http';
import { app, attachTo } from './server.js';

const server = createServer(app);
attachTo(server);

const PORT = process.env.PORT || 8787;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`terminal-deck listening on http://0.0.0.0:${PORT}`);
});
