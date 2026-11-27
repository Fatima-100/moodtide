/* A23: similar songs, track reports and tester feedback.
   Needs the database with db/init loaded (including 07_reports_feedback.sql) and the dev sample songs.
   Temporary songs, tags, a genre and a user are created and deleted, so your catalog is not touched.
   Location: moodtide-backend/server/test/similar-reports-feedback.test.js */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';

const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const email = `a23.test.${run}@example.com`;
const password = 'a23-test-password';
const T = (name) => `a23t_${name}_${run}`;           // temporary ids
const ids = { artist: T('artist'), genre: T('genre'), seed: T('seed'), twin: T('twin'), mid: T('mid'),
  hidden: T('hidden'), islamic: T('islamic'), bare: T('bare') };
const tag = (n) => `a23t-${n}-${run}`;               // tag names that no real song uses
let token = null;
let userId = null;

const as = (req) => req.set({ Authorization: `Bearer ${token}` });
const similar = (id, qs = '') => request(app).get(`/api/songs/${id}/similar${qs}`);
const report = (body) => as(request(app).post('/api/reports')).send(body);
const feedback = (body) => as(request(app).post('/api/feedback')).send(body);
const countFor = async (table) => (await query(`SELECT count(*) AS n FROM ${table} WHERE user_id = @u`, { u: userId }))[0].n;

async function addSong(id, { type = 'music', active = true, features = [0.5, 0.5, 100], tags = {}, genre = true } = {}) {
  await query(
    `INSERT INTO songs (song_id, artist_id, title, duration_sec, popularity, is_active, source, content_type, region)
     VALUES (@id, @a, @t, 200, 50, @act, 'demo', @ct, 'international')`,
    { id, a: ids.artist, t: `A23 ${id}`, act: active, ct: type });
  if (features) {
    await query('INSERT INTO song_features (song_id, energy, happiness, tempo, danceability, acousticness) VALUES (@id, @e, @h, @t, 0.5, 0.5)',
      { id, e: features[0], h: features[1], t: features[2] });
  }
  for (const [name, weight] of Object.entries(tags)) {
    await query('INSERT INTO song_tags (song_id, tag, weight) VALUES (@id, @tag, @w)', { id, tag: name, w: weight });
  }
  if (genre) await query('INSERT INTO song_genres (song_id, genre_id) VALUES (@id, @g)', { id, g: ids.genre });
}

describe('A23 similar songs, reports, feedback', () => {
  before(async () => {
    await query("INSERT INTO artists (artist_id, name, source) VALUES (@a, 'A23 Test Artist', 'demo')", { a: ids.artist });
    await query('INSERT INTO genres (genre_id, name) VALUES (@g, @n)', { g: ids.genre, n: `A23 test genre ${run}` });
    const seedTags = { [tag('one')]: 80, [tag('two')]: 60 };
    await addSong(ids.seed, { tags: seedTags });                                       // the song we ask about
    await addSong(ids.twin, { tags: seedTags });                                       // identical features, tags and genre
    await addSong(ids.mid, { features: [0.7, 0.5, 100], tags: { [tag('one')]: 80, [tag('three')]: 40 } });
    await addSong(ids.hidden, { active: false, tags: seedTags });                      // taken down: never listed
    await addSong(ids.islamic, { type: 'islamic', tags: seedTags });                   // other section: never listed for music
    await addSong(ids.bare, { features: null });                                       // no audio features: cannot be measured
  });

  after(async () => {
    await query('DELETE FROM artists WHERE artist_id = @a', { a: ids.artist });  // cascades to songs, features, tags, genres, reports
    await query('DELETE FROM genres WHERE genre_id = @g', { g: ids.genre });
    await query('DELETE FROM users WHERE email = @e', { e: email });
    await closePool();
  });

  describe('GET /api/songs/:id/similar', () => {
    test('needs no login and returns songs with the usual song fields', async () => {
      const res = await similar(ids.seed);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok(Array.isArray(res.body) && res.body.length > 0);
      assert.ok(res.body.every((s) => s.song_id && s.title && s.artist));
    });

    test('ranks by distance, shared tags and genre: the twin first, then the nearer-in-tags song', async () => {
      const res = await similar(ids.seed);
      assert.equal(res.body[0].song_id, ids.twin);
      assert.equal(res.body[1].song_id, ids.mid);
      const [twin, mid] = res.body;
      assert.equal(twin.distance, 0);
      assert.equal(twin.similarity, 1);                       // 0.6 + 0.25 + 0.15
      assert.deepEqual(twin.shared_tags, [tag('one'), tag('two')]);
      assert.equal(twin.same_genre, true);
      assert.equal(mid.distance, 0.1155);                     // sqrt((0.2^2) / 3)
      assert.equal(mid.similarity, 0.7918);                   // 0.6*(1-0.11547) + 0.25*(80/180) + 0.15
      assert.deepEqual(mid.shared_tags, [tag('one')]);
      assert.equal(mid.same_genre, true);
    });

    test('is sorted best first, never lists the song itself, and gives 10 by default', async () => {
      const res = await similar(ids.seed);
      assert.ok(res.body.length <= 10);
      assert.equal(res.body.length, 10, 'needs at least 10 other music songs (sample data has 14)');
      assert.ok(res.body.every((s) => s.song_id !== ids.seed));
      for (let i = 1; i < res.body.length; i++) assert.ok(res.body[i - 1].similarity >= res.body[i].similarity, `row ${i} is out of order`);
    });

    test('leaves out taken-down songs, other sections, and songs without audio features', async () => {
      const listed = (await similar(ids.seed, '?limit=20')).body.map((s) => s.song_id);
      for (const id of [ids.hidden, ids.islamic, ids.bare]) assert.ok(!listed.includes(id), `${id} should not be listed`);
    });

    test('?limit picks the count (1 to 20); a bad value falls back to 10', async () => {
      assert.equal((await similar(ids.seed, '?limit=2')).body.length, 2);
      assert.ok((await similar(ids.seed, '?limit=99')).body.length <= 20);
      assert.equal((await similar(ids.seed, '?limit=abc')).body.length, 10);
    });

    test('an islamic song only gets islamic songs', async () => {
      const res = await similar(ids.islamic);
      assert.equal(res.status, 200);
      assert.ok(res.body.every((s) => s.content_type === 'islamic'), 'a music song leaked into the islamic list');
    });

    test('unknown or taken-down song gives 404; a song without features gives an empty list', async () => {
      assert.equal((await similar('no_such_song')).status, 404);
      assert.equal((await similar(ids.hidden)).status, 404);
      const bare = await similar(ids.bare);
      assert.equal(bare.status, 200);
      assert.deepEqual(bare.body, []);
    });
  });

  describe('POST /api/reports', () => {
    test('needs a login', async () => {
      assert.equal((await request(app).post('/api/reports').send({ songId: ids.seed, reason: 'cannot_play' })).status, 401);
    });

    test('register a temporary user', async () => {
      const reg = await request(app).post('/api/auth/register').send({ username: 'A23 Test', email, password });
      assert.equal(reg.status, 201, JSON.stringify(reg.body));
      token = reg.body.token;
      userId = reg.body.user.user_id;
    });

    test('bad input is refused with 400 and nothing is saved', async () => {
      const bad = [
        {}, { songId: ids.seed }, { reason: 'cannot_play' }, { songId: 5, reason: 'cannot_play' },
        { songId: ids.seed, reason: 'bogus' }, { songId: ids.seed, reason: 'toString' },
        { songId: ids.seed, reason: 'other' }, { songId: ids.seed, reason: 'other', note: '   ' },
        { songId: ids.seed, reason: 'cannot_play', note: 5 },
        { songId: ids.seed, reason: 'cannot_play', note: 'x'.repeat(501) },
      ];
      for (const body of bad) assert.equal((await report(body)).status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(await countFor('track_reports'), 0);
    });

    test('an unknown song gives 404', async () => {
      assert.equal((await report({ songId: 'no_such_song', reason: 'cannot_play' })).status, 404);
      assert.equal(await countFor('track_reports'), 0);
    });

    test('saves the report (note trimmed, status open) and writes an audit row', async () => {
      const res = await report({ songId: ids.seed, reason: 'wrong_info', note: '  wrong artist name  ' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.body.report_id, /^rep_/);
      const [row] = await query('SELECT song_id, user_id, reason, note, status FROM track_reports WHERE report_id = @r', { r: res.body.report_id });
      assert.deepEqual(row, { song_id: ids.seed, user_id: userId, reason: 'wrong_info', note: 'wrong artist name', status: 'open' });
      const audit = await query("SELECT 1 FROM audit_log WHERE table_name = 'Track_Reports' AND record_id = @r", { r: res.body.report_id });
      assert.equal(audit.length, 1);
    });

    test('the same open report sent twice is saved once (200, same id)', async () => {
      const first = await report({ songId: ids.seed, reason: 'cannot_play' });
      const again = await report({ songId: ids.seed, reason: 'cannot_play', note: 'still broken' });
      assert.equal(first.status, 201);
      assert.equal(again.status, 200);
      assert.equal(again.body.already_reported, true);
      assert.equal(again.body.report_id, first.body.report_id);
      const rows = await query("SELECT 1 FROM track_reports WHERE user_id = @u AND song_id = @s AND reason = 'cannot_play'", { u: userId, s: ids.seed });
      assert.equal(rows.length, 1);
    });

    test('another reason on the same song is a new report; a closed report can be filed again', async () => {
      assert.equal((await report({ songId: ids.seed, reason: 'copyright' })).status, 201);
      await query("UPDATE track_reports SET status = 'resolved' WHERE user_id = @u AND reason = 'cannot_play'", { u: userId });
      assert.equal((await report({ songId: ids.seed, reason: 'cannot_play' })).status, 201);
    });

    test('"other" works when it has a note', async () => {
      assert.equal((await report({ songId: ids.twin, reason: 'other', note: 'plays the wrong song' })).status, 201);
    });
  });

  describe('POST /api/feedback', () => {
    test('needs a login', async () => {
      assert.equal((await request(app).post('/api/feedback').send({ page: 'home', rating: 5 })).status, 401);
    });

    test('bad input is refused with 400 and nothing is saved', async () => {
      const bad = [
        {}, { page: 'home' }, { rating: 5 },
        { page: 'home', rating: 0 }, { page: 'home', rating: 6 }, { page: 'home', rating: 3.5 },
        { page: 'home', rating: '4' }, { page: 'home', rating: null },
        { page: '', rating: 4 }, { page: '   ', rating: 4 }, { page: 5, rating: 4 }, { page: 'p'.repeat(101), rating: 4 },
        { page: 'home', rating: 4, text: 5 }, { page: 'home', rating: 4, text: 't'.repeat(2001) },
      ];
      for (const body of bad) assert.equal((await feedback(body)).status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(await countFor('tester_feedback'), 0);
    });

    test('saves page, rating and text (trimmed)', async () => {
      const res = await feedback({ page: ' home ', rating: 4, text: '  Suggestions felt right.  ' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.body.feedback_id, /^fb_/);
      const [row] = await query('SELECT user_id, page, rating, feedback_text FROM tester_feedback WHERE feedback_id = @f', { f: res.body.feedback_id });
      assert.deepEqual(row, { user_id: userId, page: 'home', rating: 4, feedback_text: 'Suggestions felt right.' });
    });

    test('the text is optional, and the audit log never holds the text', async () => {
      const res = await feedback({ page: 'player', rating: 1 });
      assert.equal(res.status, 201);
      const [row] = await query('SELECT feedback_text FROM tester_feedback WHERE feedback_id = @f', { f: res.body.feedback_id });
      assert.equal(row.feedback_text, null);
      const secret = `private-words-${run}`;
      const withText = await feedback({ page: 'player', rating: 5, text: secret });
      const [log] = await query("SELECT new_data FROM audit_log WHERE table_name = 'Tester_Feedback' AND record_id = @r", { r: withText.body.feedback_id });
      assert.ok(log, 'audit row missing');
      assert.ok(!JSON.stringify(log.new_data).includes(secret));
    });
  });
});
