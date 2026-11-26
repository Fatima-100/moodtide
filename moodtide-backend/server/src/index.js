import { config } from './config.js';
import { app } from './app.js';
import { closePool } from './db.js';

process.on('unhandledRejection', (reason) => console.error('[unhandled rejection]', reason));

const server = app.listen(config.port, () => console.log(`MoodTide API on http://localhost:${config.port}`));

// close cleanly when the host or you stop the server
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => closePool().finally(() => process.exit(0))));
}
