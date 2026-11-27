/* A25: limit enforcement (checkAndCount).
   Needs the database with db/init loaded (including 08_plans.sql). Uses temporary users and deletes them.
   Location: moodtide-backend/server/test/limits.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, withTx, closePool } from '../src/db.js';
import { checkAndCount } from '../src/plans.js';
import { newId } from '../src/util.js';

const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const users = [];

async function newUser(tag) {
  const email = `a25.${tag}.${run}@example.com`;
  const reg = await request(app).post('/api/auth/register').send({ username: `A25 ${tag}`, email, password: 'a25-test-password' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const id = reg.body.user.user_id;
  users.push(id);
  return { id, token: reg.body.token };
}
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
const makePremium = (id) => query("UPDATE subscriptions SET plan_id = 'plan_premium' WHERE user_id = @u AND status = 'active'", { u: id });
const usedToday = async (id, metric) => (await query(
  `SELECT COALESCE(SUM(count), 0) AS n FROM usage_counters WHERE user_id = @u AND metric = @m`, { u: id, m: metric }))[0].n;

describe('A25 limit enforcement', () => {
  after(async () => {
    await query('DELETE FROM users WHERE user_id = ANY(@ids)', { ids: users });
    await closePool();
  });

  test('Free: the 10th skip works, the 11th is 402 with the documented body, and it is not applied', async () => {
    const u = await newUser('skips');
    const [{ song_id }] = await query('SELECT song_id FROM songs LIMIT 1');
    const skip = () => request(app).post('/api/plays').set(auth(u)).send({ songId: song_id, listenedSec: 3, completed: false });
    for (let i = 1; i <= 10; i++) assert.equal((await skip()).status, 201, `skip ${i}`);
    const blocked = await skip();
    assert.equal(blocked.status, 402);
    assert.equal(blocked.body.code, 'LIMIT_REACHED');
    assert.equal(blocked.body.metric, 'skips');
    assert.equal(blocked.body.limit, 10);
    assert.equal(blocked.body.used, 10);
    assert.ok(blocked.body.error);
    assert.equal(await usedToday(u.id, 'skips'), 10, 'the blocked skip must not be counted');
    assert.equal((await query('SELECT count(*) AS n FROM listening_history WHERE user_id = @u', { u: u.id }))[0].n, 10, 'the blocked skip must not be saved');
  });

  test('a full play is never counted as a skip', async () => {
    const u = await newUser('fullplay');
    const [{ song_id }] = await query('SELECT song_id FROM songs LIMIT 1');
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post('/api/plays').set(auth(u)).send({ songId: song_id, listenedSec: 200, completed: true });
      assert.equal(r.status, 201);
    }
    assert.equal(await usedToday(u.id, 'skips'), 0);
  });

  test('Premium is never blocked (but its use is still counted)', async () => {
    const u = await newUser('premium');
    await makePremium(u.id);
    const [{ song_id }] = await query('SELECT song_id FROM songs LIMIT 1');
    for (let i = 1; i <= 12; i++) {
      const r = await request(app).post('/api/plays').set(auth(u)).send({ songId: song_id, listenedSec: 3, completed: false });
      assert.equal(r.status, 201, `skip ${i}`);
    }
    assert.equal(await usedToday(u.id, 'skips'), 12);
  });

  test('refreshes: 5 allowed, the 6th is 402', async () => {
    const u = await newUser('refresh');
    for (let i = 1; i <= 5; i++) {
      assert.equal((await request(app).post('/api/suggestions/generate').set(auth(u))).status, 201, `refresh ${i}`);
    }
    const blocked = await request(app).post('/api/suggestions/generate').set(auth(u));
    assert.equal(blocked.status, 402);
    assert.deepEqual({ ...blocked.body, error: undefined }, { error: undefined, code: 'LIMIT_REACHED', metric: 'refreshes', limit: 5, used: 5 });
    assert.equal(await usedToday(u.id, 'refreshes'), 5);
  });

  test('playlists: 3 allowed, the 4th is 402 and creates nothing', async () => {
    const u = await newUser('playlists');
    for (let i = 1; i <= 3; i++) {
      assert.equal((await request(app).post('/api/playlists').set(auth(u)).send({ name: `P${i}` })).status, 201);
    }
    const blocked = await request(app).post('/api/playlists').set(auth(u)).send({ name: 'P4' });
    assert.equal(blocked.status, 402);
    assert.equal(blocked.body.metric, 'playlists');
    assert.equal((await query('SELECT count(*) AS n FROM playlists WHERE user_id = @u', { u: u.id }))[0].n, 3);
  });

  test('journeys: 2 allowed, the 3rd is 402; a journey does not use a playlist slot', async () => {
    const u = await newUser('journeys');
    const journey = () => request(app).post('/api/playlists/journey').set(auth(u)).send({ from: 'sad', to: 'energetic' });
    assert.equal((await journey()).status, 201);
    assert.equal((await journey()).status, 201);
    const blocked = await journey();
    assert.equal(blocked.status, 402);
    assert.equal(blocked.body.metric, 'journeys');
    assert.equal(await usedToday(u.id, 'playlists'), 0);
  });

  test('a bad request does not use up the allowance (the count rolls back)', async () => {
    const u = await newUser('rollback');
    const bad = await request(app).post('/api/playlists/journey').set(auth(u)).send({ from: 'nonsense', to: 'sad' });
    assert.equal(bad.status, 400);
    assert.equal(await usedToday(u.id, 'journeys'), 0);
  });

  test('a user with no active subscription is treated as Free', async () => {
    const id = newId('usr');
    await query("INSERT INTO users (user_id, role_id, username, email, password_hash) VALUES (@id, 'rol_2', 'A25 Bare', @e, 'x')",
      { id, e: `a25.bare.${run}@example.com` });
    users.push(id);
    const hit = () => withTx((tx) => checkAndCount(tx, id, 'journeys'));
    assert.deepEqual(await hit(), { used: 1, limit: 2 });
    await hit();
    await assert.rejects(hit(), (e) => e.status === 402 && e.body.limit === 2);
  });

  test('an expired Premium subscription falls back to Free', async () => {
    const id = newId('usr');
    await query("INSERT INTO users (user_id, role_id, username, email, password_hash) VALUES (@id, 'rol_2', 'A25 Expired', @e, 'x')",
      { id, e: `a25.expired.${run}@example.com` });
    users.push(id);
    await query("INSERT INTO subscriptions (subscription_id, user_id, plan_id, status, started_at, ends_at) VALUES (@s, @u, 'plan_premium', 'active', now() - interval '60 days', now() - interval '1 day')",
      { s: newId('sub'), u: id });
    assert.equal((await withTx((tx) => checkAndCount(tx, id, 'playlists'))).limit, 3);
  });

  test("counters are one row per user, day and metric", async () => {
    const u = await newUser('day');
    await withTx((tx) => checkAndCount(tx, u.id, 'playlists'));
    await withTx((tx) => checkAndCount(tx, u.id, 'playlists'));
    const rows = await query("SELECT day, count FROM usage_counters WHERE user_id = @u AND metric = 'playlists'", { u: u.id });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 2);
  });
});
