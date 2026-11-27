// Admin endpoints for the SaaS dashboard (task A27).
// Mounted by routes.js inside the admin router, so every route here is already behind requireAuth + requireAdmin.
import { Router } from 'express';
import { query, withTx } from './db.js';
import { HttpError, audit, newId, wrap } from './util.js';
import { IN_FORCE, FREE_PLAN_ID } from './plans.js';
import { PERIOD_DAYS } from './billing.js';

export const adminSaas = Router();

const STATUSES = ['active', 'cancelled', 'expired'];

const intParam = (value, fallback, lo, hi) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, `must be a whole number from ${lo} to ${hi}`);
  return n;
};
const pageOf = (req) => ({ n: intParam(req.query.limit, 50, 1, 200), o: intParam(req.query.offset, 0, 0, 1e9) });
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

/** GET /api/admin/users?q=&limit=&offset=  : every user with the plan in force and the last login */
adminSaas.get('/users', wrap(async (req, res) => {
  const { n, o } = pageOf(req);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const pat = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : '%';
  const [{ total }] = await query('SELECT count(*) AS total FROM users u WHERE u.username ILIKE @pat OR u.email ILIKE @pat', { pat });
  const users = await query(
    `SELECT u.user_id, u.username, u.email, r.role_name AS role, u.experiment_group, u.tz, u.created_at, u.last_login,
            p.plan_id, p.name AS plan, sub.status AS subscription_status, sub.ends_at AS plan_ends_at
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     LEFT JOIN LATERAL (SELECT s.* FROM subscriptions s WHERE s.user_id = u.user_id AND ${IN_FORCE}
                        ORDER BY s.started_at DESC LIMIT 1) sub ON true
     JOIN plans p ON p.plan_id = COALESCE(sub.plan_id, @free)
     WHERE u.username ILIKE @pat OR u.email ILIKE @pat
     ORDER BY u.created_at DESC, u.user_id
     LIMIT @n OFFSET @o`, { pat, free: FREE_PLAN_ID, n, o });
  res.json({ total, limit: n, offset: o, users });
}));

/** GET /api/admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&user_id=  : uses per day and metric (default: the last 14 days) */
adminSaas.get('/usage', wrap(async (req, res) => {
  const [today] = await query('SELECT current_date::text AS d, (current_date - 13)::text AS d14');
  const from = req.query.from ?? today.d14, to = req.query.to ?? today.d;
  if (!isDay(from) || !isDay(to)) throw new HttpError(400, 'from and to must be dates like 2026-11-27');
  if (from > to) throw new HttpError(400, 'from must not be after to');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw new HttpError(400, 'at most 366 days at a time');
  const userId = typeof req.query.user_id === 'string' && req.query.user_id ? req.query.user_id : null;
  const rows = await query(
    `SELECT day::text AS day, metric, SUM(count) AS total, COUNT(DISTINCT user_id) AS users
     FROM usage_counters
     WHERE day BETWEEN @from::date AND @to::date AND (@uid::text IS NULL OR user_id = @uid::text)
     GROUP BY day, metric ORDER BY day DESC, metric`, { from, to, uid: userId });
  res.json(rows);
}));

/** GET /api/admin/subscriptions?status=&plan_id=&user_id=&limit=&offset= */
adminSaas.get('/subscriptions', wrap(async (req, res) => {
  const { n, o } = pageOf(req);
  const status = req.query.status ?? 'any';
  if (status !== 'any' && !STATUSES.includes(status)) throw new HttpError(400, `status must be any or one of ${STATUSES.join(', ')}`);
  const plan = typeof req.query.plan_id === 'string' && req.query.plan_id ? req.query.plan_id : 'any';
  const uid = typeof req.query.user_id === 'string' && req.query.user_id ? req.query.user_id : 'any';
  const where = `(@status = 'any' OR s.status = @status) AND (@plan = 'any' OR s.plan_id = @plan) AND (@uid = 'any' OR s.user_id = @uid)`;
  const [{ total }] = await query(`SELECT count(*) AS total FROM subscriptions s WHERE ${where}`, { status, plan, uid });
  const subscriptions = await query(
    `SELECT s.subscription_id, s.user_id, u.username, u.email, s.plan_id, p.name AS plan, s.status, s.started_at, s.ends_at,
            ${IN_FORCE} AS in_force
     FROM subscriptions s JOIN users u ON u.user_id = s.user_id JOIN plans p ON p.plan_id = s.plan_id
     WHERE ${where}
     ORDER BY s.started_at DESC, s.subscription_id LIMIT @n OFFSET @o`, { status, plan, uid, n, o });
  res.json({ total, limit: n, offset: o, subscriptions });
}));

/**
 * PUT /api/admin/users/:id/plan  { plan_id }  : put a user on a plan (an admin grant: no invoice, no card).
 * The plan in force ends now (kept as history); Free has no end date, a paid plan runs for the usual 30 days.
 */
adminSaas.put('/users/:id/plan', wrap(async (req, res) => {
  const planId = req.body?.plan_id;
  if (typeof planId !== 'string' || !planId) throw new HttpError(400, 'plan_id required');
  const out = await withTx(async (tx) => {
    const [user] = await query('SELECT user_id FROM users WHERE user_id = @u', { u: req.params.id }, tx);
    if (!user) throw new HttpError(404, 'User not found');
    const [plan] = await query('SELECT plan_id, name, price_pkr_mock FROM plans WHERE plan_id = @p', { p: planId }, tx);
    if (!plan) throw new HttpError(404, 'Unknown plan');

    await query("UPDATE subscriptions SET status = 'expired' WHERE user_id = @u AND status = 'active' AND ends_at IS NOT NULL AND ends_at <= now()", { u: user.user_id }, tx);
    const [current] = await query(`SELECT s.subscription_id, s.plan_id, s.status, s.ends_at FROM subscriptions s WHERE s.user_id = @u AND ${IN_FORCE} ORDER BY s.started_at DESC LIMIT 1`, { u: user.user_id }, tx);
    const before = current?.plan_id ?? FREE_PLAN_ID;
    // already on this plan and running normally: nothing to do
    if (current && current.plan_id === plan.plan_id && current.status === 'active') {
      return { changed: false, plan_id: plan.plan_id, ends_at: current.ends_at, subscription_id: current.subscription_id };
    }
    // whatever is in force ends now (kept as history), then the new plan starts now
    await query(`UPDATE subscriptions s SET status = 'cancelled', ends_at = now() WHERE s.user_id = @u AND ${IN_FORCE}`, { u: user.user_id }, tx);
    const subId = newId('sub');
    const paid = plan.price_pkr_mock > 0;
    const [sub] = await query(
      `INSERT INTO subscriptions (subscription_id, user_id, plan_id, status, started_at, ends_at)
       VALUES (@s, @u, @p, 'active', now(), CASE WHEN @paid THEN now() + make_interval(days => @d) END)
       RETURNING subscription_id, ends_at`,
      { s: subId, u: user.user_id, p: plan.plan_id, paid, d: PERIOD_DAYS }, tx);
    await audit(tx, req.user.id, 'Subscriptions', subId, 'INSERT', { plan: before }, { user: user.user_id, plan: plan.plan_id, by: 'admin' });
    return { changed: true, plan_id: plan.plan_id, ends_at: sub.ends_at, subscription_id: sub.subscription_id };
  });
  res.json(out);
}));

/** GET /api/admin/metrics  : users, active users in 7 days, Premium users, mock revenue this month */
adminSaas.get('/metrics', wrap(async (_req, res) => {
  const [m] = await query(
    `SELECT (SELECT count(*) FROM users) AS users_total,
            (SELECT count(*) FROM users u WHERE u.last_login >= now() - interval '7 days'
               OR EXISTS (SELECT 1 FROM listening_history h WHERE h.user_id = u.user_id AND h.played_at >= now() - interval '7 days')) AS active_users_7d,
            (SELECT count(DISTINCT s.user_id) FROM subscriptions s JOIN plans p ON p.plan_id = s.plan_id
               WHERE p.price_pkr_mock > 0 AND ${IN_FORCE}) AS premium_users,
            (SELECT COALESCE(SUM(amount_mock), 0) FROM invoices WHERE status = 'paid' AND created_at >= date_trunc('month', now())) AS revenue_month_mock`);
  res.json(m);
}));
