/* =====================================================================
   A11: first automated tests (node:test + supertest)
   Location: moodtide-backend/server/test/api.test.js
   Run from the server folder:   npm test

   Needs: the database running with the schema, the seed and db/dev/dev_sample_data.sql loaded.
   The API does NOT need to be running: supertest starts the app itself.
   One temporary user is created and deleted at the end, so your demo accounts are not touched.
   Keep this the only file in test/ (the runner treats every .js file there as a test).
   ===================================================================== */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';

const email = `a11.test.${Date.now()}.${Math.floor(Math.random() * 1000)}@example.com`;
const password = 'a11-test-password';

let token = null;     // set by test 1
let userId = null;
let first = null;     // top suggestion from the check-in (test 6)
let genreId = null;   // genre of that song

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const near = (a, b) => Math.abs(Number(a) - b) < 0.001;
const taste = async () => (await query(
  'SELECT affinity_score, play_count FROM user_taste_profile WHERE user_id = @u AND genre_id = @g',
  { u: userId, g: genreId }))[0];
const needToken = () => assert.ok(token, 'test 1 (register) must pass first');
const needSong = () => assert.ok(first, 'test 6 (check-in) must pass first');

describe('MoodTide API', () => {
  after(async () => {
    await query('DELETE FROM users WHERE email = @e', { e: email });
    await closePool();
  });

  // ---- 1-3: accounts
  test('1. register returns 201 and a token', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'A11 Test', email, password });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(typeof res.body.token, 'string');
    token = res.body.token;
    // cohort B (mood-aware) makes the check-in test predictable
    await query("UPDATE users SET experiment_group = 'B' WHERE email = @e", { e: email });
    [{ user_id: userId }] = await query('SELECT user_id FROM users WHERE email = @e', { e: email });
  });

  test('2. login with the right password returns a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(typeof res.body.token, 'string');
  });

  test('3. login with a wrong password returns 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'not-the-password' });
    assert.equal(res.status, 401);
  });

  // ---- 4-5: catalog
  test('4. songs list returns music songs with artist, genre and numeric features', async () => {
    const res = await request(app).get('/api/songs');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body) && res.body.length > 0, 'no songs: load db/dev/dev_sample_data.sql');
    assert.ok(res.body.every((s) => s.content_type === 'music'), 'a non-music song in the default list');
    assert.ok(res.body[0].artist && res.body[0].genre, 'artist or genre missing');
    assert.equal(typeof res.body[0].energy, 'number');
  });

  test('5. song search is case-insensitive, respects limit, and finds nothing for nonsense', async () => {
    const hit = await request(app).get('/api/songs?q=SAMPLE&limit=3');
    assert.equal(hit.status, 200);
    assert.equal(hit.body.length, 3);
    const none = await request(app).get('/api/songs?q=zzzz-nothing');
    assert.equal(none.status, 200);
    assert.equal(none.body.length, 0);
  });

  // ---- 6: check-in
  test('6. check-in returns 201 with a batch id and the detected mood', async () => {
    needToken();
    const bad = await request(app).post('/api/checkins').set(auth(token)).send({ mood: 'angry', energy: 3 });
    assert.equal(bad.status, 400);

    const res = await request(app).post('/api/checkins').set(auth(token)).send({ mood: 'sad', energy: 2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.batch_id, 'no batch id');
    assert.equal(res.body.detected.detected_mood, 'sad');

    const sugs = await request(app).get('/api/suggestions').set(auth(token));
    assert.equal(sugs.status, 200);
    assert.ok(sugs.body.suggestions.length >= 8, `only ${sugs.body.suggestions.length} suggestions`);
    first = sugs.body.suggestions[0];
    [{ genre_id: genreId }] = await query(
      'SELECT genre_id FROM song_genres WHERE song_id = @s ORDER BY genre_id LIMIT 1', { s: first.song_id });
  });

  // ---- 7-8: taste profile
  test('7. plays change the taste profile (skip lowers it, a full play raises it)', async () => {
    needToken(); needSong();
    const play = (body) => request(app).post('/api/plays').set(auth(token))
      .send({ songId: first.song_id, source: 'suggestion', suggestionId: first.suggestion_id, ...body });

    const skip = await play({ listenedSec: 5, completed: false });
    assert.equal(skip.status, 201, JSON.stringify(skip.body));
    assert.equal(skip.body.signal, 'skip');
    let t = await taste();
    assert.ok(t && near(t.affinity_score, 2.9) && t.play_count === 1, `after skip: ${JSON.stringify(t)}`);

    const full = await play({ listenedSec: 200, completed: true });
    assert.equal(full.status, 201, JSON.stringify(full.body));
    assert.equal(full.body.signal, 'full_play');
    t = await taste();
    assert.ok(near(t.affinity_score, 3.0) && t.play_count === 2, `after full play: ${JSON.stringify(t)}`);

    const history = await request(app).get('/api/history').set(auth(token));
    assert.equal(history.body.length, 2);
  });

  test('8. a 5-star rating raises the taste profile by 0.4 and is listed', async () => {
    needToken(); needSong();
    const bad = await request(app).post('/api/ratings').set(auth(token)).send({ songId: first.song_id, stars: 6 });
    assert.equal(bad.status, 400);

    const before = await taste();
    const res = await request(app).post('/api/ratings').set(auth(token))
      .send({ songId: first.song_id, stars: 5, suggestionId: first.suggestion_id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const after = await taste();
    assert.ok(near(after.affinity_score, Number(before.affinity_score) + 0.4),
      `affinity ${before.affinity_score} -> ${after.affinity_score}, expected +0.4`);

    const list = await request(app).get('/api/ratings').set(auth(token));
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].stars, 5);
  });

  // ---- 9: playlists
  test('9. playlist: create, add a song, duplicate add returns 409, remove, delete', async () => {
    needToken(); needSong();
    const created = await request(app).post('/api/playlists').set(auth(token)).send({ name: 'A11 test list' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.playlist_id;

    const added = await request(app).post(`/api/playlists/${id}/songs`).set(auth(token)).send({ songId: first.song_id });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.position, 1);

    const dup = await request(app).post(`/api/playlists/${id}/songs`).set(auth(token)).send({ songId: first.song_id });
    assert.equal(dup.status, 409);

    const removed = await request(app).delete(`/api/playlists/${id}/songs/${first.song_id}`).set(auth(token));
    assert.equal(removed.status, 200);
    const afterRemove = await request(app).get(`/api/playlists/${id}`).set(auth(token));
    assert.equal(afterRemove.body.songs.length, 0);

    const deleted = await request(app).delete(`/api/playlists/${id}`).set(auth(token));
    assert.equal(deleted.status, 200);
    const gone = await request(app).get(`/api/playlists/${id}`).set(auth(token));
    assert.equal(gone.status, 404);
  });

  // ---- 10: permissions
  test('10. a normal user gets 403 on /api/admin/weights, and no token gets 401', async () => {
    needToken();
    const normal = await request(app).get('/api/admin/weights').set(auth(token));
    assert.equal(normal.status, 403);
    const anonymous = await request(app).get('/api/admin/weights');
    assert.equal(anonymous.status, 401);
  });
});
