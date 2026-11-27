/* A27: admin endpoints for the SaaS dashboard.
   Needs the database with db/init loaded. Uses temporary users (one of them made admin) and deletes them.
   Location: moodtide-backend/server/test/admin-saas.test.js */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';

const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'a27-test-password';
const users = [];
let admin, plain;   // { id, token, email }

async function newUser(tag) {
  const email = `a27.${tag}.${run}@example.com`;
  const reg = await request(app).post('/api/auth/register').send({ username: `A27 ${tag}`, email, password: PASSWORD });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  users.push(reg.body.user.user_id);
  return { id: reg.body.user.user_id, token: reg.body.token, email };
}
/** Registers a user, makes it an admin in the database, and logs in again so the token carries the new role. */
async function newAdmin(tag) {
  const u = await newUser(tag);
  await query("UPDATE users SET role_id = (SELECT role_id FROM roles WHERE role_name = 'admin') WHERE user_id = @u", { u: u.id });
  const login = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { ...u, token: login.body.token };
}
const as = (u) => ({ Authorization: `Bearer ${u.token}` });
const get = (u, path) => request(app).get(`/api/admin${path}`).set(as(u));
const putPlan = (u, id, body) => request(app).put(`/api/admin/users/${id}/plan`).set(as(u)).send(body);

describe('A27 admin endpoints for SaaS', () => {
  before(async () => { admin = await newAdmin('admin'); plain = await newUser('plain'); });
  after(async () => {
    await query('DELETE FROM users WHERE user_id = ANY(@ids)', { ids: users });
    await closePool();
  });

  test('a normal user gets 403 and no login gets 401 on every endpoint', async () => {
    const calls = [
      ['get', '/users'], ['get', '/usage'], ['get', '/subscriptions'], ['get', '/metrics'],
      ['put', `/users/${plain.id}/plan`],
    ];
    for (const [method, path] of calls) {
      const url = `/api/admin${path}`;
      const noToken = method === 'put' ? await request(app).put(url).send({ plan_id: 'plan_premium' }) : await request(app).get(url);
      assert.equal(noToken.status, 401, `${method} ${path} without a login`);
      const asUser = method === 'put' ? await request(app).put(url).set(as(plain)).send({ plan_id: 'plan_premium' }) : await request(app).get(url).set(as(plain));
      assert.equal(asUser.status, 403, `${method} ${path} as a normal user`);
    }
    assert.equal((await query("SELECT count(*) AS n FROM subscriptions WHERE user_id = @u AND plan_id = 'plan_premium'", { u: plain.id }))[0].n, 0, 'the 403 must not change anything');
  });

  test('GET /users: plan and last login, no password hash, search and paging', async () => {
    const r = await get(admin, '/users?limit=200');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Number.isInteger(r.body.total) && r.body.total >= 2);
    const me = r.body.users.find((u) => u.user_id === plain.id) ?? (await get(admin, `/users?q=${encodeURIComponent(plain.email)}`)).body.users[0];
    assert.equal(me.plan_id, 'plan_free');
    assert.equal(me.plan, 'Free');
    assert.equal(me.role, 'user');
    assert.ok('last_login' in me && 'created_at' in me && 'tz' in me);
    assert.ok(!r.body.users.some((u) => 'password_hash' in u), 'no password hash in the answer');

    const one = await get(admin, `/users?q=${encodeURIComponent(`a27.plain.${run}`)}`);
    assert.equal(one.body.total, 1);
    assert.equal(one.body.users[0].user_id, plain.id);
    assert.equal((await get(admin, '/users?limit=1')).body.users.length, 1);
    assert.equal((await get(admin, '/users?q=%25')).body.total, 0, 'a % in the search is not a wildcard');
    assert.equal((await get(admin, '/users?limit=0')).status, 400);
    assert.equal((await get(admin, '/users?limit=abc')).status, 400);
    assert.equal((await get(admin, '/users?offset=-1')).status, 400);
    assert.equal((await query("SELECT role_name FROM roles r JOIN users u ON u.role_id = r.role_id WHERE u.user_id = @u", { u: admin.id }))[0].role_name, 'admin');
    assert.equal((await get(admin, `/users?q=${encodeURIComponent(admin.email)}`)).body.users[0].role, 'admin');
  });

  test('PUT /users/:id/plan: Premium for 30 days with no invoice, then back to Free', async () => {
    const u = await newUser('grant');
    const g = await putPlan(admin, u.id, { plan_id: 'plan_premium' });
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal(g.body.changed, true);
    assert.equal(g.body.plan_id, 'plan_premium');
    const days = (new Date(g.body.ends_at) - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days <= 30, `${days} days`);

    const mine = await request(app).get('/api/me/plan').set(as(u));
    assert.equal(mine.body.plan.plan_id, 'plan_premium', "the user's own view agrees");
    assert.equal(mine.body.limits.skips, null);
    assert.equal((await query("SELECT count(*) AS n FROM subscriptions WHERE user_id = @u AND status = 'active'", { u: u.id }))[0].n, 1);
    assert.equal((await query('SELECT count(*) AS n FROM invoices WHERE user_id = @u', { u: u.id }))[0].n, 0, 'a grant is not a sale');
    const log = await query("SELECT user_id, new_data::text AS d FROM audit_log WHERE table_name = 'Subscriptions' AND record_id = @r", { r: g.body.subscription_id });
    assert.equal(log.length, 1);
    assert.equal(log[0].user_id, admin.id, 'the audit row names the admin');

    const again = await putPlan(admin, u.id, { plan_id: 'plan_premium' });
    assert.equal(again.body.changed, false, 'same plan again changes nothing');
    assert.equal((await query('SELECT count(*) AS n FROM subscriptions WHERE user_id = @u', { u: u.id }))[0].n, 2);

    const back = await putPlan(admin, u.id, { plan_id: 'plan_free' });
    assert.equal(back.status, 200);
    assert.equal(back.body.changed, true);
    assert.equal(back.body.ends_at, null, 'Free has no end date');
    assert.equal((await request(app).get('/api/me/plan').set(as(u))).body.plan.plan_id, 'plan_free');
    const subs = await query('SELECT plan_id, status FROM subscriptions WHERE user_id = @u', { u: u.id });
    assert.equal(subs.filter((s) => s.status === 'active').length, 1, 'exactly one active subscription');
  });

  test('PUT /users/:id/plan also ends a cancelled-but-running Premium, and refuses bad input', async () => {
    const u = await newUser('cancelled');
    await putPlan(admin, u.id, { plan_id: 'plan_premium' });
    await request(app).post('/api/billing/cancel').set(as(u));
    assert.equal((await request(app).get('/api/me/plan').set(as(u))).body.plan.plan_id, 'plan_premium');
    assert.equal((await putPlan(admin, u.id, { plan_id: 'plan_free' })).status, 200);
    assert.equal((await request(app).get('/api/me/plan').set(as(u))).body.plan.plan_id, 'plan_free', 'Free right away');

    assert.equal((await putPlan(admin, u.id, {})).status, 400);
    assert.equal((await putPlan(admin, u.id, { plan_id: 42 })).status, 400);
    assert.equal((await putPlan(admin, u.id, { plan_id: 'plan_gold' })).status, 404);
    assert.equal((await putPlan(admin, 'usr_does_not_exist', { plan_id: 'plan_free' })).status, 404);
  });

  test('GET /subscriptions: filters, paging and the in_force flag', async () => {
    const u = await newUser('subs');
    await putPlan(admin, u.id, { plan_id: 'plan_premium' });
    const all = await get(admin, `/subscriptions?user_id=${u.id}`);
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.equal(all.body.total, 2);
    const prem = all.body.subscriptions.find((s) => s.plan_id === 'plan_premium');
    assert.equal(prem.status, 'active');
    assert.equal(prem.in_force, true);
    assert.equal(prem.email, u.email);
    assert.equal(prem.plan, 'Premium');
    const free = all.body.subscriptions.find((s) => s.plan_id === 'plan_free');
    assert.equal(free.status, 'cancelled');
    assert.equal(free.in_force, false);
    assert.ok(!all.body.subscriptions.some((s) => 'password_hash' in s));

    assert.equal((await get(admin, `/subscriptions?user_id=${u.id}&status=active`)).body.total, 1);
    assert.equal((await get(admin, `/subscriptions?user_id=${u.id}&status=cancelled&plan_id=plan_free`)).body.total, 1);
    assert.equal((await get(admin, `/subscriptions?user_id=${u.id}&status=expired`)).body.total, 0);
    assert.equal((await get(admin, `/subscriptions?user_id=${u.id}&limit=1`)).body.subscriptions.length, 1);
    assert.equal((await get(admin, '/subscriptions?status=bogus')).status, 400);
  });

  test('GET /usage: totals by day and metric, with date checks', async () => {
    const u = await newUser('usage');
    await query(`INSERT INTO usage_counters (user_id, day, metric, count) VALUES
      (@u, current_date, 'skips', 4), (@u, current_date, 'refreshes', 2), (@u, current_date - 1, 'skips', 7)`, { u: u.id });
    const r = await get(admin, `/usage?user_id=${u.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [today] = await query('SELECT current_date::text AS d, (current_date - 1)::text AS y');
    assert.deepEqual(r.body.map((x) => [x.day, x.metric, x.total, x.users]), [
      [today.d, 'refreshes', 2, 1], [today.d, 'skips', 4, 1], [today.y, 'skips', 7, 1],
    ]);
    const onlyToday = await get(admin, `/usage?user_id=${u.id}&from=${today.d}&to=${today.d}`);
    assert.equal(onlyToday.body.length, 2);

    assert.equal((await get(admin, '/usage')).status, 200, 'the default window works without filters');
    assert.equal((await get(admin, '/usage?from=2026-13-40&to=2026-11-27')).status, 400);
    assert.equal((await get(admin, '/usage?from=yesterday')).status, 400);
    assert.equal((await get(admin, '/usage?from=2026-11-27&to=2026-11-01')).status, 400);
    assert.equal((await get(admin, '/usage?from=2020-01-01&to=2026-11-27')).status, 400, 'more than 366 days');
  });

  test('GET /metrics: users, active users in 7 days, Premium users, mock revenue this month', async () => {
    const u = await newUser('metrics');
    const [{ song_id }] = await query('SELECT song_id FROM songs LIMIT 1');
    assert.equal((await request(app).post('/api/plays').set(as(u)).send({ songId: song_id, listenedSec: 200, completed: true })).status, 201);
    await putPlan(admin, u.id, { plan_id: 'plan_premium' });
    await query("INSERT INTO invoices (invoice_id, user_id, amount_mock, status) VALUES ('inv_a27_' || @r, @u, 499, 'paid')", { r: run, u: u.id });

    const r = await get(admin, '/metrics');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body).sort(), ['active_users_7d', 'premium_users', 'revenue_month_mock', 'users_total']);
    for (const v of Object.values(r.body)) assert.ok(Number.isInteger(v) && v >= 0, JSON.stringify(r.body));
    // other test files run at the same time, so these are lower bounds, not exact counts
    assert.ok(r.body.users_total >= 4);
    assert.ok(r.body.active_users_7d >= 1, 'a user who just played is active');
    assert.ok(r.body.premium_users >= 1);
    assert.ok(r.body.revenue_month_mock >= 499);
  });
});
