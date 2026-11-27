// Mock billing (task A26): a believable upgrade flow without real money.
// No card data is ever stored, logged, audited or sent back: the card fields are read in checkout() and
// checked there, and they are never passed to a query, to audit() or to console.
import { Router } from 'express';
import { query, withTx } from './db.js';
import { HttpError, audit, newId, wrap } from './util.js';
import { IN_FORCE, FREE_PLAN_ID, PREMIUM_PLAN_ID } from './plans.js';

export const billing = Router();   // mounted by routes.js at /api/billing, after requireAuth

const METRICS = ['refreshes', 'skips', 'journeys', 'playlists'];
export const PERIOD_DAYS = 30;

// The documented test cards (Stripe's published test numbers). Anything else is refused.
const TEST_CARD_OK = '4242424242424242';        // payment succeeds
const TEST_CARD_DECLINED = '4000000000000002';  // payment is declined: a failed invoice, no upgrade
const TEST_CARDS = [TEST_CARD_OK, TEST_CARD_DECLINED];

const luhnOk = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

/** MM/YY or MM/YYYY, and the card is valid through the END of that month. */
function expiryOk(text) {
  const m = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/.exec(String(text ?? '').trim());
  if (!m) return false;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return Date.now() < Date.UTC(year, Number(m[1]), 1);   // first moment of the NEXT month
}

/** Checks the card fields. Returns 'ok' or 'declined'. Throws 400 for anything that is not a documented test card. */
function checkCard({ card_number, expiry, cvc }) {
  const digits = String(card_number ?? '').replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(digits) || !luhnOk(digits)) throw new HttpError(400, 'card_number is not a valid card number');
  if (!TEST_CARDS.includes(digits)) throw new HttpError(400, 'This is a demo: use the test card 4242 4242 4242 4242');
  if (!expiryOk(expiry)) throw new HttpError(400, 'expiry must be MM/YY and in the future');
  if (!/^\d{3}$/.test(String(cvc ?? ''))) throw new HttpError(400, 'cvc must be 3 digits');
  return digits === TEST_CARD_OK ? 'ok' : 'declined';
}

const invoiceOut = (r) => ({ invoice_id: r.invoice_id, amount_mock: r.amount_mock, status: r.status, created_at: r.created_at });

/** POST /api/billing/checkout  { plan_id, card_number, expiry, cvc } */
billing.post('/checkout', wrap(async (req, res) => {
  const body = req.body || {};
  const planId = body.plan_id;
  const cardResult = checkCard(body);      // the card fields stop here
  if (typeof planId !== 'string' || !planId) throw new HttpError(400, 'plan_id required');
  const userId = req.user.id;

  const out = await withTx(async (tx) => {
    const [plan] = await query('SELECT plan_id, name, price_pkr_mock FROM plans WHERE plan_id = @p', { p: planId }, tx);
    if (!plan) throw new HttpError(404, 'Unknown plan');
    if (plan.plan_id === FREE_PLAN_ID || plan.price_pkr_mock <= 0) throw new HttpError(400, 'Checkout is only for paid plans');

    // an "active" row that is past its end date is over: mark it, so it cannot block the new one
    await query("UPDATE subscriptions SET status = 'expired' WHERE user_id = @u AND status = 'active' AND ends_at IS NOT NULL AND ends_at <= now()", { u: userId }, tx);
    const [current] = await query(`SELECT s.plan_id, s.ends_at FROM subscriptions s WHERE s.user_id = @u AND ${IN_FORCE} AND s.plan_id = @p`, { u: userId, p: plan.plan_id }, tx);
    if (current) throw new HttpError(409, `You already have ${plan.name} until ${current.ends_at.toISOString().slice(0, 10)}`);

    const invoiceId = newId('inv');
    if (cardResult === 'declined') {
      const [inv] = await query(
        "INSERT INTO invoices (invoice_id, user_id, amount_mock, status) VALUES (@i, @u, @a, 'failed') RETURNING invoice_id, amount_mock, status, created_at",
        { i: invoiceId, u: userId, a: plan.price_pkr_mock }, tx);
      await audit(tx, userId, 'Invoices', invoiceId, 'INSERT', null, { plan: plan.plan_id, status: 'failed' });
      return { declined: true, invoice: inv };
    }

    // the Free row ends now (kept as history); the paid period starts now
    await query("UPDATE subscriptions SET status = 'cancelled', ends_at = now() WHERE user_id = @u AND status = 'active'", { u: userId }, tx);
    const subId = newId('sub');
    const [sub] = await query(
      `INSERT INTO subscriptions (subscription_id, user_id, plan_id, status, started_at, ends_at)
       VALUES (@s, @u, @p, 'active', now(), now() + make_interval(days => @d))
       RETURNING subscription_id, plan_id, status, started_at, ends_at`,
      { s: subId, u: userId, p: plan.plan_id, d: PERIOD_DAYS }, tx);
    const [inv] = await query(
      "INSERT INTO invoices (invoice_id, user_id, amount_mock, status) VALUES (@i, @u, @a, 'paid') RETURNING invoice_id, amount_mock, status, created_at",
      { i: invoiceId, u: userId, a: plan.price_pkr_mock }, tx);
    await audit(tx, userId, 'Subscriptions', subId, 'INSERT', null, { plan: plan.plan_id, invoice: invoiceId });
    await audit(tx, userId, 'Invoices', invoiceId, 'INSERT', null, { plan: plan.plan_id, status: 'paid' });
    return { declined: false, invoice: inv, subscription: sub };
  });

  if (out.declined) {
    return res.status(402).json({ error: 'Your card was declined', code: 'CARD_DECLINED', invoice: invoiceOut(out.invoice) });
  }
  res.status(201).json({ invoice: invoiceOut(out.invoice), subscription: out.subscription });
}));

/** POST /api/billing/cancel: Premium stays until the end of the paid period, then the user is on Free. */
billing.post('/cancel', wrap(async (req, res) => {
  const userId = req.user.id;
  const out = await withTx(async (tx) => {
    const [sub] = await query(
      `SELECT s.subscription_id, s.status, s.ends_at FROM subscriptions s
       WHERE s.user_id = @u AND ${IN_FORCE} AND s.plan_id <> @free ORDER BY s.started_at DESC LIMIT 1`,
      { u: userId, free: FREE_PLAN_ID }, tx);
    if (!sub) throw new HttpError(400, 'You have no paid subscription to cancel');
    if (sub.status === 'cancelled') throw new HttpError(409, 'Your subscription is already cancelled');
    await query("UPDATE subscriptions SET status = 'cancelled' WHERE subscription_id = @s", { s: sub.subscription_id }, tx);
    await audit(tx, userId, 'Subscriptions', sub.subscription_id, 'UPDATE', { status: 'active' }, { status: 'cancelled' });
    return sub;
  });
  res.json({ status: 'cancelled', cancel_at_period_end: true, ends_at: out.ends_at });
}));

/** GET /api/billing/invoices: the user's own invoices, newest first. */
billing.get('/invoices', wrap(async (req, res) => {
  res.json(await query(
    'SELECT invoice_id, amount_mock, status, created_at FROM invoices WHERE user_id = @u ORDER BY created_at DESC, invoice_id', { u: req.user.id }));
}));

/** GET /api/me/plan: the plan in force, its limits (null = unlimited) and today's usage (the user's own day). */
export async function getMyPlan(userId) {
  const [row] = await query(
    `SELECT u.user_id,
            (now() AT TIME ZONE COALESCE(u.tz, 'Asia/Karachi'))::date::text AS day,
            sub.subscription_id, sub.status, sub.started_at, sub.ends_at,
            p.plan_id, p.name, p.price_pkr_mock
     FROM users u
     LEFT JOIN LATERAL (SELECT s.* FROM subscriptions s WHERE s.user_id = u.user_id AND ${IN_FORCE}
                        ORDER BY s.started_at DESC LIMIT 1) sub ON true
     JOIN plans p ON p.plan_id = COALESCE(sub.plan_id, @free)
     WHERE u.user_id = @u`, { u: userId, free: FREE_PLAN_ID });
  if (!row) throw new HttpError(404, 'User not found');

  const limitRows = await query('SELECT metric, limit_value FROM plan_limits WHERE plan_id = @p', { p: row.plan_id });
  const usageRows = await query("SELECT metric, count FROM usage_counters WHERE user_id = @u AND day = @d::date", { u: userId, d: row.day });
  const limits = {}, usage = {};
  for (const m of METRICS) {
    limits[m] = limitRows.find((r) => r.metric === m)?.limit_value ?? null;
    usage[m] = usageRows.find((r) => r.metric === m)?.count ?? 0;
  }
  return {
    plan: { plan_id: row.plan_id, name: row.name, price_pkr_mock: row.price_pkr_mock },
    subscription: row.subscription_id
      ? { status: row.status, started_at: row.started_at, ends_at: row.ends_at, cancel_at_period_end: row.status === 'cancelled' }
      : null,
    limits, usage, day: row.day,
  };
}
