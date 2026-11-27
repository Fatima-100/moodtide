/* A19: user time zones. Needs the database; temporary users are created and deleted.
   Location: moodtide-backend/server/test/tz.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, withTx, closePool } from '../src/db.js';
import { detectMood } from '../src/engine.js';
import { DEFAULT_TZ, normalizeTimeZone, tryNormalizeTimeZone, localHour, timeOfDayForHour } from '../src/tz.js';

const stamp = `${Date.now()}.${Math.floor(Math.random() * 1000)}`;
const emails = [];
const password = 'a19-test-password';
const register = async (name, extra = {}) => {
  const email = `a19.${name}.${stamp}@example.com`;
  emails.push(email);
  const res = await request(app).post('/api/auth/register').send({ username: `A19 ${name}`, email, password, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, token: res.body.token, id: res.body.user.user_id, user: res.body.user };
};
const storedTz = async (id) => (await query('SELECT tz FROM users WHERE user_id = @u', { u: id }))[0].tz;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

after(async () => {
  for (const e of emails) await query('DELETE FROM users WHERE email = @e', { e });
  await closePool();
});

describe('hour and time of day', () => {
  test('the same moment is a different hour in two time zones', async () => {
    const moment = '2026-12-01T03:00:00Z';                            // 03:00 UTC
    assert.equal(await localHour('Asia/Karachi', moment), 8);          // UTC+5
    assert.equal(await localHour('America/Los_Angeles', moment), 19);  // UTC-8 in December, the evening before
    assert.equal(await localHour('Asia/Tokyo', moment), 12);           // UTC+9
    assert.equal(await localHour('UTC', moment), 3);
  });
  test('daylight saving is handled (New York is UTC-5 in winter, UTC-4 in summer)', async () => {
    assert.equal(await localHour('America/New_York', '2026-01-15T12:00:00Z'), 7);
    assert.equal(await localHour('America/New_York', '2026-07-15T12:00:00Z'), 8);
  });
  test('without a time zone the default is Asia/Karachi', async () => {
    assert.equal(DEFAULT_TZ, 'Asia/Karachi');
    assert.equal(await localHour(null, '2026-12-01T03:00:00Z'), 8);
  });
  test('without a fixed moment it uses the current time', async () => {
    const h = await localHour('Asia/Karachi');
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 23);
  });
  test('the time-of-day buckets keep the old cut-offs (5, 12, 17, 22)', () => {
    const expected = { 0: 'night', 4: 'night', 5: 'morning', 11: 'morning', 12: 'afternoon', 16: 'afternoon', 17: 'evening', 21: 'evening', 22: 'night', 23: 'night' };
    for (const [h, name] of Object.entries(expected)) assert.equal(timeOfDayForHour(Number(h)), name, `hour ${h}`);
  });
});

describe('time zone names', () => {
  test('normalizeTimeZone fixes the spelling and refuses nonsense', async () => {
    assert.equal(await normalizeTimeZone('asia/karachi'), 'Asia/Karachi');
    assert.equal(await normalizeTimeZone(' America/New_York '), 'America/New_York');
    for (const bad of ['Mars/Olympus', 'Karachi', 'UTC+5', '', '   ', 42, null, 'x'.repeat(100)]) {
      await assert.rejects(() => normalizeTimeZone(bad), (e) => e.status === 400, String(bad));
      assert.equal(await tryNormalizeTimeZone(bad), null);
    }
  });
});

describe('detectMood uses the user\'s clock (the A19 bug)', () => {
  test('two users in two time zones get different time_of_day at the same moment', async () => {
    const lahore = await register('lahore', { tz: 'Asia/Karachi' });
    const la = await register('la', { tz: 'America/Los_Angeles' });
    const moment = '2026-12-01T03:00:00Z';     // 08:00 in Lahore, 19:00 in Los Angeles
    const detect = (id) => withTx((tx) => detectMood(id, tx, { preferCheckin: false, now: moment }));
    const a = await detect(lahore.id);
    const b = await detect(la.id);
    assert.equal(a.time_of_day, 'morning');
    assert.equal(b.time_of_day, 'evening');
    assert.notEqual(a.time_of_day, b.time_of_day);
    // what is stored is the same as what is returned
    const [row] = await query('SELECT time_of_day FROM mood_scores WHERE score_id = @s', { s: b.score_id });
    assert.equal(row.time_of_day, 'evening');
  });
});

describe('tz at register, login and PUT /api/preferences', () => {
  test('register stores the zone (spelling fixed); an unknown or missing zone gives the default and never blocks sign-up', async () => {
    const a = await register('reg1', { tz: 'asia/tokyo' });
    assert.equal(a.user.tz, 'Asia/Tokyo');
    assert.equal(await storedTz(a.id), 'Asia/Tokyo');
    const b = await register('reg2', { tz: 'Mars/Olympus' });
    assert.equal(await storedTz(b.id), 'Asia/Karachi');
    const c = await register('reg3');
    assert.equal(await storedTz(c.id), 'Asia/Karachi');
  });

  test('login with a valid tz updates it; an unknown tz is ignored and the login still works', async () => {
    const u = await register('login');
    const ok = await request(app).post('/api/auth/login').send({ email: u.email, password, tz: 'Europe/London' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.tz, 'Europe/London');
    assert.equal(await storedTz(u.id), 'Europe/London');
    const junk = await request(app).post('/api/auth/login').send({ email: u.email, password, tz: 'Nowhere/Land' });
    assert.equal(junk.status, 200);
    assert.equal(junk.body.user.tz, 'Europe/London');
    const none = await request(app).post('/api/auth/login').send({ email: u.email, password });
    assert.equal(none.body.user.tz, 'Europe/London');
  });

  test('PUT /api/preferences saves tz, GET returns it, bad input is refused, region-only still works', async () => {
    const u = await register('prefs');
    const put = await request(app).put('/api/preferences').set(auth(u.token)).send({ tz: 'america/los_angeles' });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.tz, 'America/Los_Angeles');
    assert.equal((await request(app).get('/api/preferences').set(auth(u.token))).body.tz, 'America/Los_Angeles');

    const bad = await request(app).put('/api/preferences').set(auth(u.token)).send({ tz: 'Mars/Olympus' });
    assert.equal(bad.status, 400);
    assert.equal(await storedTz(u.id), 'America/Los_Angeles');

    assert.equal((await request(app).put('/api/preferences').set(auth(u.token)).send({})).status, 400);

    const region = await request(app).put('/api/preferences').set(auth(u.token)).send({ region: 'pakistani' });
    assert.equal(region.status, 200);
    assert.equal(region.body.region, 'pakistani');
    assert.equal(region.body.tz, 'America/Los_Angeles');   // unchanged
  });
});
