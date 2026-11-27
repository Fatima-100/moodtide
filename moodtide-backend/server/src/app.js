// The Express app, without starting a server. index.js starts it; the tests (supertest) import it.
import { config } from './config.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter, requireAuth } from './auth.js';
import { api, admin } from './routes.js';
import { query } from './db.js';

export const app = express();
// Behind a hosting proxy (Render, etc.) the real visitor address is in a header; needed for rate limiting later (A30).
app.set('trust proxy', config.isProduction ? 1 : false);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })); // safe default headers, removes X-Powered-By
app.use(cors({ origin: config.clientOrigins }));                             // only your own website may call the API from a browser
app.use(express.json({ limit: '100kb' }));                                   // refuse huge request bodies

app.get('/api/health', async (_req, res) => {
  try { await query('SELECT 1 AS ok'); res.json({ ok: true, db: 'connected' }); }
  catch (e) { res.status(500).json({ ok: false, db: config.isProduction ? 'unreachable' : e.message }); }
});
app.use('/api/auth', authRouter);
app.use('/api/admin', requireAuth, admin);
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// PostgreSQL error codes -> friendly HTTP errors (details are shown only outside production)
app.use((err, _req, res, _next) => {
  const detail = config.isProduction ? undefined : err.message;
  if (err.code === 'LIMIT_REACHED') return res.status(err.status).json(err.body); // A25: 402 { error, code, metric, limit, used }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists (unique/primary key violation)', detail });
  if (err.code === '23503') return res.status(400).json({ error: 'Constraint violation (foreign key)', detail });
  if (err.code === '23514' || err.code === '23502') return res.status(400).json({ error: 'Constraint violation (CHECK or NOT NULL)', detail });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid input format', detail });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 && config.isProduction ? 'Server error' : (err.message || 'Server error') });
});
