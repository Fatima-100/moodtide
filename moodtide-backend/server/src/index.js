import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter, requireAuth } from './auth.js';
import { api, admin } from './routes.js';
import { query } from './db.js';

const app = express();
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',') }));
app.use(express.json());

app.get('/api/health', async (_req, res) => {
try { await query('SELECT 1 AS ok'); res.json({ ok: true, db: 'connected' }); }
  catch (e) { res.status(500).json({ ok: false, db: e.message }); }
});
app.use('/api/auth', authRouter);
app.use('/api/admin', requireAuth, admin);
app.use('/api', api);

// PostgreSQL error codes -> friendly HTTP errors
app.use((err, _req, res, _next) => {
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists (unique/primary key violation)', detail: err.message });
  if (err.code === '23503') return res.status(400).json({ error: 'Constraint violation (foreign key)', detail: err.message });
  if (err.code === '23514' || err.code === '23502') return res.status(400).json({ error: 'Constraint violation (CHECK or NOT NULL)', detail: err.message });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid input format', detail: err.message });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`MoodTide API on http://localhost:${port}`));
