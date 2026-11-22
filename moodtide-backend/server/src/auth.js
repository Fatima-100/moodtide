import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { query, withTx } from './db.js';
import { HttpError, audit, newId, sha256, wrap } from './util.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const SESSION_DAYS = 7;

/** Reads "Authorization: Bearer <token>", checks JWT + that the session row is not revoked/expired. */
export const requireAuth = wrap(async (req, _res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Missing token');
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch { throw new HttpError(401, 'Invalid or expired token'); }
  const [session] = await query(
    `SELECT session_id FROM Auth_Sessions
     WHERE token_hash = @h AND is_revoked = 0 AND expires_at > SYSUTCDATETIME()`,
    { h: sha256(token) }
  );
  if (!session) throw new HttpError(401, 'Session revoked or expired');
  req.user = { id: payload.sub, role: payload.role };
  req.token = token;
  next();
});

export const requireAdmin = (req, _res, next) =>
  req.user?.role === 'admin' ? next() : next(new HttpError(403, 'Admin only'));

async function startSession(userId, role) {
  const token = jwt.sign({ sub: userId, role }, SECRET, { expiresIn: `${SESSION_DAYS}d` });
  await query(
    `INSERT INTO Auth_Sessions (session_id, user_id, token_hash, created_at, expires_at, is_revoked)
     VALUES (@id, @u, @h, SYSUTCDATETIME(), DATEADD(DAY, @d, SYSUTCDATETIME()), 0)`,
    { id: newId('ses'), u: userId, h: sha256(token), d: SESSION_DAYS }
  );
  return token;
}

const publicUser = (u) => ({
  user_id: u.user_id, username: u.username, email: u.email,
  role: u.role_name, experiment_group: u.experiment_group,
});

export const authRouter = Router();

authRouter.post('/register', wrap(async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password || password.length < 6)
    throw new HttpError(400, 'username, email and a password of 6+ characters are required');
  const userId = newId('usr');
  const group = Math.random() < 0.5 ? 'A' : 'B';
  await withTx(async (tx) => {
    await query(
      `INSERT INTO Users (user_id, role_id, username, email, password_hash, experiment_group, created_at)
       VALUES (@id, 'rol_2', @n, @e, @p, @g, SYSUTCDATETIME())`,
      { id: userId, n: username, e: email.toLowerCase(), p: bcrypt.hashSync(password, 10), g: group }, tx
    );
    await audit(tx, userId, 'Users', userId, 'INSERT', null, { email, group });
  });
  const token = await startSession(userId, 'user');
  res.status(201).json({ token, user: { user_id: userId, username, email, role: 'user', experiment_group: group } });
}));

authRouter.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const [u] = await query(
    `SELECT u.*, r.role_name FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.email = @e`,
    { e: String(email || '').toLowerCase() }
  );
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    throw new HttpError(401, 'Invalid email or password');
  await query('UPDATE Users SET last_login = SYSUTCDATETIME() WHERE user_id = @u', { u: u.user_id });
  const token = await startSession(u.user_id, u.role_name);
  res.json({ token, user: publicUser(u) });
}));

authRouter.post('/logout', requireAuth, wrap(async (req, res) => {
  await query('UPDATE Auth_Sessions SET is_revoked = 1 WHERE token_hash = @h', { h: sha256(req.token) });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, wrap(async (req, res) => {
  const [u] = await query(
    `SELECT u.*, r.role_name FROM Users u JOIN Roles r ON r.role_id = u.role_id WHERE u.user_id = @u`,
    { u: req.user.id }
  );
  res.json(publicUser(u));
}));
