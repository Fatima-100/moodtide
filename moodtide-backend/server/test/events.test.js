/* A18: the event log (POST /api/events). Needs the database; one temporary user is created and deleted.
   Location: moodtide-backend/server/test/events.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';
import { parseEvents, EVENT_TYPES, MAX_BATCH } from '../src/events.js';

const email = `a18.test.${Date.now()}.${Math.floor(Math.random() * 1000)}@example.com`;
let token = null, userId = null;
const auth = () => ({ Authorization: `Bearer ${token}` });
const post = (body) => request(app).post('/api/events').set(auth()).send(body);
const countEvents = async () => (await query('SELECT count(*) AS n FROM events WHERE user_id = @u', { u: userId }))[0].n;
const ev = (type, extra = {}) => ({ event_type: type, song_id: 'dev_s_01', session_id: 'sess-a18', ...extra });

describe('parseEvents (validation only)', () => {
  test('accepts an array or { events }, snake_case or camelCase, and fills defaults', () => {
    const a = parseEvents([{ eventType: 'like', songId: 's1', suggestionId: 'sg1', value: 1 }]);
    assert.deepEqual(a[0], { session_id: null, event_type: 'like', song_id: 's1', suggestion_id: 'sg1', position: null, value: 1, context: '{}', at: null });
    const b = parseEvents({ session_id: 'abc', events: [{ event_type: 'checkin', context: { mood: 'sad' } }] });
    assert.equal(b[0].session_id, 'abc');
    assert.equal(b[0].song_id, null);          // a check-in has no song
    assert.equal(b[0].context, '{"mood":"sad"}');
  });

  test('rejects unknown types, a missing song, an empty or oversized batch, and bad fields', () => {
    const fails = (body, re) => assert.throws(() => parseEvents(body), (e) => e.status === 400 && re.test(e.message), JSON.stringify(body).slice(0, 60));
    fails([{ event_type: 'purchase', song_id: 's' }], /event 0: event_type "purchase" is not allowed/);
    fails([ev('like'), { event_type: 'skip' }], /event 1: song_id is required for skip/);
    fails([], /empty/);
    fails(Array.from({ length: MAX_BATCH + 1 }, () => ev('skip')), /At most 50/);
    fails('nope', /JSON array/);
    fails([5], /must be an object/);
    fails([ev('skip', { position: -1 })], /position/);
    fails([ev('skip', { position: 1.5 })], /position/);
    fails([ev('skip', { value: 'long' })], /value must be a number/);
    fails([ev('skip', { context: [1] })], /context must be an object/);
    fails([ev('skip', { context: { x: 'y'.repeat(2000) } })], /context is too large/);
    fails([ev('skip', { session_id: 'x'.repeat(65) })], /session_id/);
    fails([ev('skip', { at: 'not a date' })], /valid time/);
  });

  test('the device time is used only when it is plausible', () => {
    const now = Date.parse('2026-12-01T12:00:00Z');
    const at = (t) => parseEvents([ev('skip', { at: t })], now)[0].at;
    assert.equal(at('2026-12-01T11:59:00Z'), '2026-12-01T11:59:00.000Z');
    assert.equal(at('2026-12-01T12:03:00Z'), '2026-12-01T12:03:00.000Z');   // 3 minutes ahead: clock skew, accepted
    assert.equal(at('2026-12-01T13:00:00Z'), null);                          // an hour ahead: ignored
    assert.equal(at('2026-11-01T12:00:00Z'), null);                          // a month old: ignored
  });

  test('all ten event types are allowed', () => assert.equal(EVENT_TYPES.length, 10));
});

describe('POST /api/events', () => {
  after(async () => { await query('DELETE FROM users WHERE email = @e', { e: email }); await closePool(); });

  test('needs a login', async () => {
    const res = await request(app).post('/api/events').send([ev('skip')]);
    assert.equal(res.status, 401);
  });

  test('a batch is saved in one request, in order, with every field', async () => {
    const reg = await request(app).post('/api/auth/register').send({ username: 'A18 Test', email, password: 'a18-test-password' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    token = reg.body.token;
    [{ user_id: userId }] = await query('SELECT user_id FROM users WHERE email = @e', { e: email });

    const res = await post([
      ev('impression', { position: 0, suggestion_id: 'sug_x', context: { screen: 'home' } }),
      ev('play_start', { position: 0, context: { source: 'suggestion' } }),
      ev('play_end', { value: 187.5, context: { completed: true } }),
      { event_type: 'checkin', session_id: 'sess-a18', value: 2, context: { mood: 'sad' } },
    ]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.accepted, 4);

    const rows = await query('SELECT * FROM events WHERE user_id = @u ORDER BY event_id', { u: userId });
    assert.deepEqual(rows.map((r) => r.event_type), ['impression', 'play_start', 'play_end', 'checkin']);
    assert.equal(rows[0].position, 0);
    assert.equal(rows[0].suggestion_id, 'sug_x');
    assert.deepEqual(rows[0].context, { screen: 'home' });
    assert.equal(rows[2].value, 187.5);
    assert.equal(rows[3].song_id, null);
    assert.ok(rows.every((r) => r.session_id === 'sess-a18' && r.created_at instanceof Date));
  });

  test('one unknown type rejects the whole batch: nothing is saved', async () => {
    const before = await countEvents();
    const res = await post([ev('like'), ev('teleport'), ev('skip')]);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /event 1: event_type "teleport"/);
    assert.equal(await countEvents(), before);
  });

  test('51 events are refused, 50 are accepted', async () => {
    const before = await countEvents();
    assert.equal((await post(Array.from({ length: 51 }, () => ev('impression')))).status, 400);
    assert.equal(await countEvents(), before);
    const ok = await post(Array.from({ length: 50 }, (_, i) => ev('impression', { position: i })));
    assert.equal(ok.status, 201);
    assert.equal(ok.body.accepted, 50);
    assert.equal(await countEvents(), before + 50);
  });

  test('a plausible device time is stored as created_at', async () => {
    const t = new Date(Date.now() - 3600 * 1000).toISOString();
    assert.equal((await post([ev('skip', { value: 4, at: t })])).status, 201);
    const [row] = await query(`SELECT created_at FROM events WHERE user_id = @u AND event_type = 'skip' ORDER BY event_id DESC LIMIT 1`, { u: userId });
    assert.equal(row.created_at.toISOString(), t);
  });

  test('deleting a user deletes their events', async () => {
    assert.ok(await countEvents() > 0);
    await query('DELETE FROM users WHERE user_id = @u', { u: userId });
    assert.equal(await countEvents(), 0);
  });
});
