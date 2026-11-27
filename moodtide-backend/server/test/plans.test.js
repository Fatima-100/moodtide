/* A24: plan tables and the Free subscription at registration.
   Needs the database with db/init loaded (including 08_plans.sql).
   Temporary users are created and deleted, so your demo accounts are not touched.
   Location: moodtide-backend/server/test/plans.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, withTx, closePool } from '../src/db.js';
import { startFreeSubscription } from '../src/plans.js';
import { newId } from '../src/util.js';

const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const email = `a24.test.${run}@example.com`;
const password = 'a24-test-password';
let userId = null;
const extraUsers = [];

/** A user inserted directly (no registration), so it starts without a subscription. */
async function bareUser(tag) {
  const id = newId('usr');
  await query(
    `INSERT INTO users (user_id, role_id, username, email, password_hash)
     VALUES (@id, 'rol_2', 'A24 Bare', @e, 'x')`, { id, e: `a24.${tag}.${run}@example.com` });
  extraUsers.push(id);
  return id;
}
const rejects = async (fn, code) => {
  await assert.rejects(fn, (e) => { assert.equal(e.code, code, e.message); return true; });
};

describe('A24 plans', () => {
  after(async () => {
    await query('DELETE FROM users WHERE email = @e OR user_id = ANY(@ids)', { e: email, ids: extraUsers });
    await closePool();
  });

  test('Free and Premium exist, with the limits of the task book', async () => {
    const plans = await query('SELECT plan_id, name, price_pkr_mock FROM plans ORDER BY plan_id');
    assert.deepEqual(plans.map((p) => p.name), ['Free', 'Premium']);
    assert.equal(plans.find((p) => p.name === 'Free').price_pkr_mock, 0);

    const limits = async (plan) => Object.fromEntries(
      (await query('SELECT metric, limit_value FROM plan_limits WHERE plan_id = @p', { p: plan })).map((r) => [r.metric, r.limit_value]));
    assert.deepEqual(await limits('plan_free'), { refreshes: 5, skips: 10, journeys: 2, playlists: 3 });
    assert.deepEqual(await limits('plan_premium'), { refreshes: null, skips: null, journeys: null, playlists: null }, 'null means unlimited');
  });

  test('the demo users from the seed were given an active Free subscription', async () => {
    const rows = await query(
      "SELECT user_id, plan_id FROM subscriptions WHERE status = 'active' AND user_id IN ('usr_admin', 'usr_fatima', 'usr_marcus') ORDER BY user_id");
    assert.deepEqual(rows, [
      { user_id: 'usr_admin', plan_id: 'plan_free' },
      { user_id: 'usr_fatima', plan_id: 'plan_free' },
      { user_id: 'usr_marcus', plan_id: 'plan_free' },
    ]);
  });

  test('a newly registered user has exactly one active Free subscription', async () => {
    const reg = await request(app).post('/api/auth/register').send({ username: 'A24 Test', email, password });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    userId = reg.body.user.user_id;

    const subs = await query('SELECT subscription_id, plan_id, status, started_at, ends_at FROM subscriptions WHERE user_id = @u', { u: userId });
    assert.equal(subs.length, 1);
    assert.equal(subs[0].plan_id, 'plan_free');
    assert.equal(subs[0].status, 'active');
    assert.equal(subs[0].ends_at, null);
    assert.ok(Math.abs(Date.now() - subs[0].started_at.getTime()) < 60000, 'started_at should be now');
    assert.match(subs[0].subscription_id, /^sub_/);
    const log = await query("SELECT 1 FROM audit_log WHERE table_name = 'Subscriptions' AND record_id = @r", { r: subs[0].subscription_id });
    assert.equal(log.length, 1, 'audit row missing');
  });

  test('a failed registration leaves no subscription behind (same transaction)', async () => {
    const id = newId('usr');
    await assert.rejects(withTx(async (tx) => {
      await query("INSERT INTO users (user_id, role_id, username, email, password_hash) VALUES (@id, 'rol_2', 'A24 Roll', @e, 'x')",
        { id, e: `a24.roll.${run}@example.com` }, tx);
      await startFreeSubscription(tx, id);
      throw new Error('something after the subscription fails');
    }), /something after/);
    assert.equal((await query('SELECT count(*) AS n FROM subscriptions WHERE user_id = @u', { u: id }))[0].n, 0);
    assert.equal((await query('SELECT count(*) AS n FROM users WHERE user_id = @u', { u: id }))[0].n, 0);
  });

  test('a user can have only one ACTIVE subscription, but old ones can stay as history', async () => {
    const id = await bareUser('one-active');
    await query("INSERT INTO subscriptions (subscription_id, user_id, plan_id) VALUES (@s, @u, 'plan_free')", { s: newId('sub'), u: id });
    await rejects(() => query("INSERT INTO subscriptions (subscription_id, user_id, plan_id) VALUES (@s, @u, 'plan_premium')", { s: newId('sub'), u: id }), '23505');
    await query("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = @u", { u: id });
    await query("INSERT INTO subscriptions (subscription_id, user_id, plan_id) VALUES (@s, @u, 'plan_premium')", { s: newId('sub'), u: id });
    assert.equal((await query('SELECT count(*) AS n FROM subscriptions WHERE user_id = @u', { u: id }))[0].n, 2);
  });

  test('a subscription needs a real plan, a known status and an end date after the start', async () => {
    const id = await bareUser('sub-checks');
    const insert = (plan, status, ends) => query(
      `INSERT INTO subscriptions (subscription_id, user_id, plan_id, status, ends_at)
       VALUES (@s, @u, @p, @st, @e)`, { s: newId('sub'), u: id, p: plan, st: status, e: ends });
    await rejects(() => insert('plan_gold', 'active', null), '23503');
    await rejects(() => insert('plan_free', 'paused', null), '23514');
    await rejects(() => insert('plan_free', 'active', new Date(Date.now() - 86400000)), '23514');
    await insert('plan_premium', 'active', new Date(Date.now() + 30 * 86400000));   // a real Premium month works
  });

  test('usage_counters: one row per user, day and metric; the A25 upsert counts up', async () => {
    const id = await bareUser('counters');
    const hit = async (metric) => (await query(
      `INSERT INTO usage_counters (user_id, day, metric, count) VALUES (@u, current_date, @m, 1)
       ON CONFLICT (user_id, day, metric) DO UPDATE SET count = usage_counters.count + 1 RETURNING count`,
      { u: id, m: metric }))[0].count;
    assert.equal(await hit('skips'), 1);
    assert.equal(await hit('skips'), 2);
    assert.equal(await hit('refreshes'), 1, 'another metric has its own counter');
    await rejects(() => query("INSERT INTO usage_counters (user_id, day, metric) VALUES (@u, current_date, 'skips')", { u: id }), '23505');
    await rejects(() => hit('teleports'), '23514');
    await rejects(() => query("INSERT INTO usage_counters (user_id, day, metric, count) VALUES (@u, current_date - 1, 'skips', -1)", { u: id }), '23514');
  });

  test('invoices start pending; a negative amount or unknown status is refused', async () => {
    const id = await bareUser('invoices');
    const [inv] = await query("INSERT INTO invoices (invoice_id, user_id, amount_mock) VALUES (@i, @u, 499) RETURNING status, created_at", { i: newId('inv'), u: id });
    assert.equal(inv.status, 'pending');
    assert.ok(inv.created_at instanceof Date);
    await rejects(() => query('INSERT INTO invoices (invoice_id, user_id, amount_mock) VALUES (@i, @u, -1)', { i: newId('inv'), u: id }), '23514');
    await rejects(() => query("INSERT INTO invoices (invoice_id, user_id, amount_mock, status) VALUES (@i, @u, 1, 'refunded')", { i: newId('inv'), u: id }), '23514');
  });

  test('plan_limits refuses an unknown metric and a negative limit; a plan in use cannot be deleted', async () => {
    await rejects(() => query("INSERT INTO plan_limits (plan_id, metric, limit_value) VALUES ('plan_free', 'teleports', 1)"), '23514');
    await rejects(() => query("UPDATE plan_limits SET limit_value = -1 WHERE plan_id = 'plan_free' AND metric = 'skips'"), '23514');
    await rejects(() => query("DELETE FROM plans WHERE plan_id = 'plan_free'"), '23503');
  });

  test('deleting a user deletes their subscription, counters and invoices', async () => {
    const id = await bareUser('cascade');
    await query("INSERT INTO subscriptions (subscription_id, user_id, plan_id) VALUES (@s, @u, 'plan_free')", { s: newId('sub'), u: id });
    await query("INSERT INTO usage_counters (user_id, day, metric, count) VALUES (@u, current_date, 'skips', 1)", { u: id });
    await query('INSERT INTO invoices (invoice_id, user_id, amount_mock) VALUES (@i, @u, 0)', { i: newId('inv'), u: id });
    await query('DELETE FROM users WHERE user_id = @u', { u: id });
    for (const table of ['subscriptions', 'usage_counters', 'invoices']) {
      assert.equal((await query(`SELECT count(*) AS n FROM ${table} WHERE user_id = @u`, { u: id }))[0].n, 0, table);
    }
  });
});
