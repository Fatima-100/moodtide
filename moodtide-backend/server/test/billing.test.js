/* A26: mock billing (checkout, cancel, invoices) and GET /api/me/plan.
   Needs the database with db/init loaded (including 08_plans.sql). Uses temporary users and deletes them.
   Location: moodtide-backend/server/test/billing.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, withTx, closePool } from '../src/db.js';
import { checkAndCount } from '../src/plans.js';

const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const users = [];
const GOOD = { card_number: '4242 4242 4242 4242', expiry: '12/45', cvc: '123' };

async function newUser(tag) {
  const reg = await request(app).post('/api/auth/register')
    .send({ username: `A26 ${tag}`, email: `a26.${tag}.${run}@example.com`, password: 'a26-test-password' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  users.push(reg.body.user.user_id);
  return { id: reg.body.user.user_id, token: reg.body.token };
}
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
const checkout = (u, extra = {}) => request(app).post('/api/billing/checkout').set(auth(u)).send({ plan_id: 'plan_premium', ...GOOD, ...extra });
const myPlan = async (u) => (await request(app).get('/api/me/plan').set(auth(u))).body;

describe('A26 mock billing', () => {
  after(async () => {
    await query('DELETE FROM users WHERE user_id = ANY(@ids)', { ids: users });
    await closePool();
  });

  test('everything needs a login', async () => {
    assert.equal((await request(app).post('/api/billing/checkout').send({})).status, 401);
    assert.equal((await request(app).post('/api/billing/cancel')).status, 401);
    assert.equal((await request(app).get('/api/billing/invoices')).status, 401);
    assert.equal((await request(app).get('/api/me/plan')).status, 401);
  });

  test('GET /api/me/plan for a new user: Free, its limits and zero usage', async () => {
    const u = await newUser('free');
    const p = await myPlan(u);
    assert.equal(p.plan.plan_id, 'plan_free');
    assert.equal(p.subscription.status, 'active');
    assert.equal(p.subscription.cancel_at_period_end, false);
    assert.deepEqual(p.limits, { refreshes: 5, skips: 10, journeys: 2, playlists: 3 });
    assert.deepEqual(p.usage, { refreshes: 0, skips: 0, journeys: 0, playlists: 0 });
    await request(app).post('/api/playlists').set(auth(u)).send({ name: 'One' });
    assert.equal((await myPlan(u)).usage.playlists, 1, "today's usage is counted");
  });

  test('upgrade: the test card makes a paid invoice and a Premium subscription for 30 days', async () => {
    const u = await newUser('upgrade');
    const r = await checkout(u);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.invoice.invoice_id, /^inv_/);
    assert.equal(r.body.invoice.status, 'paid');
    assert.equal(r.body.invoice.amount_mock, 499);
    assert.equal(r.body.subscription.plan_id, 'plan_premium');
    const days = (new Date(r.body.subscription.ends_at) - new Date(r.body.subscription.started_at)) / 86400000;
    assert.ok(Math.abs(days - 30) < 0.01, `period is ${days} days`);

    const p = await myPlan(u);
    assert.equal(p.plan.plan_id, 'plan_premium');
    assert.deepEqual(p.limits, { refreshes: null, skips: null, journeys: null, playlists: null });
    const subs = await query('SELECT plan_id, status FROM subscriptions WHERE user_id = @u ORDER BY started_at', { u: u.id });
    assert.deepEqual(subs.map((s) => `${s.plan_id}:${s.status}`).sort(), ['plan_free:cancelled', 'plan_premium:active']);
    assert.equal(subs.filter((s) => s.status === 'active').length, 1);
  });

  test('a second upgrade while Premium is refused with 409', async () => {
    const u = await newUser('twice');
    assert.equal((await checkout(u)).status, 201);
    assert.equal((await checkout(u)).status, 409);
    assert.equal((await query('SELECT count(*) AS n FROM invoices WHERE user_id = @u', { u: u.id }))[0].n, 1);
  });

  test('only documented test cards, a valid expiry and cvc are accepted', async () => {
    const u = await newUser('cards');
    const bad = async (extra, status = 400) => assert.equal((await checkout(u, extra)).status, status, JSON.stringify(extra));
    await bad({ card_number: '4111 1111 1111 1111' });      // a real-looking card that is not a test card
    await bad({ card_number: '4242 4242 4242 4241' });      // fails the Luhn check
    await bad({ card_number: 'abcd' });
    await bad({ card_number: undefined });
    await bad({ expiry: '01/20' });                         // in the past
    await bad({ expiry: '13/45' });
    await bad({ expiry: '2045-12' });
    await bad({ cvc: '12' });
    await bad({ cvc: 'abc' });
    await bad({ plan_id: 'plan_free' });                    // checkout is for paid plans
    await bad({ plan_id: 'plan_gold' }, 404);
    await bad({ plan_id: undefined });
    assert.equal((await myPlan(u)).plan.plan_id, 'plan_free', 'nothing changed');
    assert.equal((await query('SELECT count(*) AS n FROM invoices WHERE user_id = @u', { u: u.id }))[0].n, 0);
    assert.equal((await checkout(u, { card_number: '4242424242424242', expiry: '12/2045' })).status, 201, 'no spaces and a 4-digit year are fine');
  });

  test('the declined test card gives 402 CARD_DECLINED, a failed invoice and no upgrade', async () => {
    const u = await newUser('declined');
    const r = await checkout(u, { card_number: '4000 0000 0000 0002' });
    assert.equal(r.status, 402);
    assert.equal(r.body.code, 'CARD_DECLINED');
    assert.equal(r.body.invoice.status, 'failed');
    assert.equal((await myPlan(u)).plan.plan_id, 'plan_free');
    const inv = await request(app).get('/api/billing/invoices').set(auth(u));
    assert.deepEqual(inv.body.map((i) => i.status), ['failed']);
    assert.equal((await checkout(u)).status, 201, 'the good card works afterwards');
  });

  test('cancel keeps Premium until the period ends, and cannot be done twice', async () => {
    const u = await newUser('cancel');
    assert.equal((await request(app).post('/api/billing/cancel').set(auth(u))).status, 400, 'a Free user has nothing to cancel');
    await checkout(u);
    const c = await request(app).post('/api/billing/cancel').set(auth(u));
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.cancel_at_period_end, true);
    const p = await myPlan(u);
    assert.equal(p.plan.plan_id, 'plan_premium', 'still Premium until the end');
    assert.equal(p.subscription.cancel_at_period_end, true);
    assert.equal(await withTx((tx) => checkAndCount(tx, u.id, 'skips')).then((r) => r.limit), null, 'limits are still unlimited');
    assert.equal((await request(app).post('/api/billing/cancel').set(auth(u))).status, 409);
    assert.equal((await checkout(u)).status, 409, 'cannot buy again while the paid period is still running');
  });

  test('after the paid period ends the user is on Free, and can upgrade again', async () => {
    const u = await newUser('expiry');
    await checkout(u);
    await request(app).post('/api/billing/cancel').set(auth(u));
    await query("UPDATE subscriptions SET started_at = now() - interval '60 days', ends_at = now() - interval '1 day' WHERE user_id = @u AND plan_id = 'plan_premium'", { u: u.id });
    const p = await myPlan(u);
    assert.equal(p.plan.plan_id, 'plan_free');
    assert.equal(p.subscription, null);
    assert.equal((await withTx((tx) => checkAndCount(tx, u.id, 'journeys'))).limit, 2);
    assert.equal((await checkout(u)).status, 201);
    assert.equal((await myPlan(u)).plan.plan_id, 'plan_premium');
  });

  test('an active Premium row past its end date is also Free, and a new checkout replaces it', async () => {
    const u = await newUser('lapsed');
    await checkout(u);
    await query("UPDATE subscriptions SET started_at = now() - interval '60 days', ends_at = now() - interval '1 day' WHERE user_id = @u AND plan_id = 'plan_premium'", { u: u.id });
    assert.equal((await myPlan(u)).plan.plan_id, 'plan_free');
    assert.equal((await checkout(u)).status, 201);
    assert.equal((await query("SELECT count(*) AS n FROM subscriptions WHERE user_id = @u AND status = 'active'", { u: u.id }))[0].n, 1);
  });

  test('invoices: newest first, and only your own', async () => {
    const a = await newUser('inv-a');
    const b = await newUser('inv-b');
    await checkout(a, { card_number: '4000000000000002' });
    await checkout(a);
    await checkout(b);
    const list = (await request(app).get('/api/billing/invoices').set(auth(a))).body;
    assert.deepEqual(list.map((i) => i.status), ['paid', 'failed']);
    assert.deepEqual(Object.keys(list[0]).sort(), ['amount_mock', 'created_at', 'invoice_id', 'status']);
    assert.equal((await request(app).get('/api/billing/invoices').set(auth(b))).body.length, 1);
  });

  test('no card number or cvc appears in the logs, the database or the answers', async () => {
    const u = await newUser('secret');
    const seen = [];
    const originals = {};
    for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
      originals[k] = console[k];
      console[k] = (...args) => seen.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    }
    const answers = [];
    try {
      const secret = { card_number: '4242 4242 4242 4242', expiry: '12/45', cvc: '987' };
      answers.push((await checkout(u, secret)).text);
      answers.push((await checkout(u, secret)).text);                                  // 409 path
      answers.push((await checkout(u, { ...secret, card_number: '4000000000000002' })).text);
      answers.push((await checkout(u, { ...secret, cvc: '98' })).text);                // 400 path
      answers.push((await request(app).post('/api/billing/checkout').set(auth(u)).set('Content-Type', 'application/json').send('{"card_number": "4242424242424242", oops')).text);
    } finally {
      for (const k of Object.keys(originals)) console[k] = originals[k];
    }
    const dump = [
      ...(await query('SELECT row_to_json(i)::text AS t FROM invoices i WHERE user_id = @u', { u: u.id })),
      ...(await query('SELECT row_to_json(s)::text AS t FROM subscriptions s WHERE user_id = @u', { u: u.id })),
      ...(await query('SELECT COALESCE(old_data::text, \'\') || COALESCE(new_data::text, \'\') AS t FROM audit_log WHERE user_id = @u', { u: u.id })),
    ].map((r) => r.t).concat(seen, answers).join('\n');
    for (const needle of ['4242424242424242', '4242 4242 4242 4242', '4000000000000002', '4000 0000 0000 0002']) {
      assert.ok(!dump.includes(needle), `found "${needle}" in logs, database rows or answers`);
    }
  });
});
