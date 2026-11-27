/* A22: "not my mood". Needs the database with db/init loaded (including 06_mood_corrections.sql) and some songs.
   A temporary user is created and deleted.
   Location: moodtide-backend/server/test/mood-correct.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, withTx, closePool } from '../src/db.js';
import { detectMood } from '../src/engine.js';

const email = `a22.test.${Date.now()}.${Math.floor(Math.random() * 1000)}@example.com`;
const password = 'a22-test-password';
let token = null;
let userId = null;

const as = (req) => req.set({ Authorization: `Bearer ${token}` });
const correct = (body) => as(request(app).post('/api/mood/correct')).send(body);
const count = async (table) => (await query(`SELECT count(*) AS n FROM ${table} WHERE user_id = @u`, { u: userId }))[0].n;

describe('POST /api/mood/correct', () => {
  after(async () => {
    await query('DELETE FROM users WHERE email = @e', { e: email });
    await closePool();
  });

  test('needs a login', async () => {
    assert.equal((await request(app).post('/api/mood/correct').send({ mood: 'sad' })).status, 401);
  });

  test('returns a new batch built for the corrected mood', async () => {
    const reg = await request(app).post('/api/auth/register').send({ username: 'A22 Test', email, password });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    token = reg.body.token;
    userId = reg.body.user.user_id;
    await query("UPDATE users SET experiment_group = 'B' WHERE user_id = @u", { u: userId });

    const checkin = await as(request(app).post('/api/checkins')).send({ mood: 'energetic', energy: 5 });
    assert.equal(checkin.status, 201, JSON.stringify(checkin.body));

    const res = await correct({ mood: 'sad' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.batch.target_mood, 'sad');
    assert.equal(res.body.detected.detected_mood, 'sad');
    assert.notEqual(res.body.batch.batch_id, checkin.body.batch_id);
    assert.ok(res.body.suggestions.length > 0, 'no songs: load db/dev/dev_sample_data.sql');
    assert.ok(res.body.suggestions.every((s) => s.title && Array.isArray(s.reasons)));

    const latest = await as(request(app).get('/api/suggestions'));
    assert.equal(latest.body.batch.batch_id, res.body.batch.batch_id);
    assert.equal(latest.body.batch.target_mood, 'sad');
  });

  test('saves the correction and one not_my_mood event', async () => {
    const rows = await query('SELECT previous_mood, corrected_mood, score_id FROM mood_corrections WHERE user_id = @u', { u: userId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].previous_mood, 'energetic');
    assert.equal(rows[0].corrected_mood, 'sad');
    assert.ok(rows[0].score_id);
    const events = await query("SELECT context FROM events WHERE user_id = @u AND event_type = 'not_my_mood'", { u: userId });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].context, { mood: 'energetic', corrected_mood: 'sad' });
    assert.equal(await count('mood_checkins'), 1, 'a correction is not a check-in');
  });

  test('the correction wins over the older check-in for later suggestions', async () => {
    assert.equal((await as(request(app).post('/api/suggestions/generate'))).status, 201);
    assert.equal((await as(request(app).get('/api/suggestions'))).body.batch.target_mood, 'sad');
  });

  test('a newer check-in wins over the correction', async () => {
    const res = await as(request(app).post('/api/checkins')).send({ mood: 'happy', energy: 4 });
    assert.equal(res.body.detected.detected_mood, 'happy', JSON.stringify(res.body));
  });

  test('a correction older than 6 hours is ignored', async () => {
    await query("UPDATE mood_checkins SET checked_at = now() - interval '8 hours' WHERE user_id = @u", { u: userId });
    await query("UPDATE mood_corrections SET created_at = now() - interval '7 hours' WHERE user_id = @u", { u: userId });
    const detected = await withTx((tx) => detectMood(userId, tx));
    assert.ok(!/corrected|told us/.test(detected.rule), detected.rule);
  });

  test('a bad mood is refused and nothing is saved', async () => {
    const before = [await count('mood_corrections'), await count('events'), await count('suggestion_batches')];
    for (const body of [{}, { mood: 'angry' }, { mood: 'toString' }, { mood: 5 }]) {
      assert.equal((await correct(body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual([await count('mood_corrections'), await count('events'), await count('suggestion_batches')], before);
  });
});
