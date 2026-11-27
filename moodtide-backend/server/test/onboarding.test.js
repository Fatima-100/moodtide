/* A31: onboarding makes the first suggestions personal. Needs the database; temporary users are deleted.
   Location: moodtide-backend/server/test/onboarding.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';
import { regionFromLanguages, LANGUAGES } from '../src/onboarding-rules.js';

const stamp = `${Date.now()}.${Math.floor(Math.random() * 1000)}`;
const emails = [];
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const post = (u, body) => request(app).post('/api/onboarding').set(auth(u.token)).send(body);

// a new user. cohort A (taste only) makes the ranking depend on taste alone, so the test is exact
const newUser = async (name, group = 'A') => {
  const email = `a31.${name}.${stamp}@example.com`;
  emails.push(email);
  const res = await request(app).post('/api/auth/register').send({ username: `A31 ${name}`, email, password: 'a31-test-password' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await query('UPDATE users SET experiment_group = @g WHERE email = @e', { g: group, e: email });
  return { token: res.body.token, id: res.body.user.user_id };
};
const taste = async (id) => new Map((await query('SELECT genre_id, affinity_score, play_count FROM user_taste_profile WHERE user_id = @u', { u: id }))
  .map((r) => [r.genre_id, r]));
// the genres that songs are filed under (the engine uses the first genre of each song), most songs first
const genresWithSongs = async () => (await query(
  `SELECT gx.genre_id, count(*) AS n
   FROM songs s JOIN song_features f ON f.song_id = s.song_id
   JOIN LATERAL (SELECT sg.genre_id FROM song_genres sg WHERE sg.song_id = s.song_id ORDER BY sg.genre_id LIMIT 1) gx ON true
   WHERE s.is_active AND s.content_type = 'music' AND left(gx.genre_id, 8) <> 'gen_isl_'
     AND gx.genre_id <> 'gen_1'   -- the engine files songs with no genre under gen_1, so keep it out of the test
   GROUP BY gx.genre_id ORDER BY count(*) DESC, gx.genre_id`)).map((r) => r.genre_id);

after(async () => {
  for (const e of emails) await query('DELETE FROM users WHERE email = @e', { e });
  await closePool();
});

describe('region from languages', () => {
  test('one language gives its region, Asian languages give asian, a mix gives all, none gives null', () => {
    assert.equal(regionFromLanguages(['urdu']), 'pakistani');
    assert.equal(regionFromLanguages(['punjabi']), 'punjabi');
    assert.equal(regionFromLanguages(['english']), 'international');
    assert.equal(regionFromLanguages(['hindi', 'korean']), 'asian');
    assert.equal(regionFromLanguages(['korean', 'japanese', 'hindi']), 'asian');
    assert.equal(regionFromLanguages(['urdu', 'english']), 'all');
    assert.equal(regionFromLanguages(['urdu', 'punjabi']), 'all');
    assert.equal(regionFromLanguages([]), null);
    assert.ok(LANGUAGES.every((l) => regionFromLanguages([l])));
  });
});

describe('POST /api/onboarding', () => {
  test('needs a login', async () => {
    assert.equal((await request(app).post('/api/onboarding').send({ languages: ['urdu'] })).status, 401);
  });

  test('malformed bodies return 400 with a readable message', async () => {
    const u = await newUser('bad');
    const fails = async (body, re) => {
      const res = await post(u, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(res.body.error, re);
    };
    await fails({}, /at least one language or one genre/);
    await fails({ languages: [], genres: [] }, /at least one language or one genre/);
    await fails({ languages: ['klingon'] }, /languages/);
    await fails({ languages: 'urdu' }, /languages/);
    await fails({ genres: [5] }, /genres/);
    await fails({ genres: ['gen_does_not_exist'] }, /unknown genre id gen_does_not_exist/);
    await fails({ languages: ['urdu'], listening_times: ['teatime'] }, /listening_times/);
    await fails({ genres: Array.from({ length: 31 }, (_, i) => `g${i}`) }, /genres/);
    assert.equal((await query('SELECT count(*) AS n FROM user_taste_profile WHERE user_id = @u', { u: u.id }))[0].n, 0, 'a refused request must save nothing');
  });

  test('saves the answers and the region, and GET /api/onboarding reports it', async () => {
    const u = await newUser('answers');
    const before = await request(app).get('/api/onboarding').set(auth(u.token));
    assert.deepEqual(before.body, { completed: false });
    const [g1] = await genresWithSongs();
    const res = await post(u, { languages: ['urdu'], genres: [g1], listening_times: ['evening', 'night'] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.region, 'pakistani');
    assert.ok(res.body.batch_id);
    const prefs = await request(app).get('/api/preferences').set(auth(u.token));
    assert.equal(prefs.body.region, 'pakistani');
    const after = await request(app).get('/api/onboarding').set(auth(u.token));
    assert.equal(after.body.completed, true);
    assert.deepEqual(after.body.languages, ['urdu']);
    assert.deepEqual(after.body.genres, [g1]);
    assert.deepEqual(after.body.listening_times, ['evening', 'night']);
  });

  test('genres only: the saved region is left alone; mixed languages give all', async () => {
    const u = await newUser('region');
    await request(app).put('/api/preferences').set(auth(u.token)).send({ region: 'korean' });
    const [g1] = await genresWithSongs();
    assert.equal((await post(u, { genres: [g1] })).body.region, 'korean');
    assert.equal((await post(u, { languages: ['urdu', 'english'] })).body.region, 'all');
  });

  test('seeds the taste profile: 4 for the chosen genres, 2.5 for every other music genre, nothing for Islamic ones', async () => {
    const u = await newUser('taste');
    const [g1, g2] = await genresWithSongs();
    const res = await post(u, { genres: [g1, g2, g1] });          // a repeated id is counted once
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const t = await taste(u.id);
    const musicGenres = (await query(`SELECT genre_id FROM genres WHERE left(genre_id, 8) <> 'gen_isl_'`)).map((g) => g.genre_id);
    assert.equal(t.size, musicGenres.length, 'one row for every music genre');
    for (const id of musicGenres) {
      assert.equal(t.get(id).affinity_score, id === g1 || id === g2 ? 4 : 2.5, id);
      assert.equal(t.get(id).play_count, 0);
    }
    assert.ok([...t.keys()].every((id) => !id.startsWith('gen_isl_')));
  });

  test("a new user's first batch favours the chosen genres", async () => {
    const u = await newUser('batch');
    const [g1, g2] = await genresWithSongs();
    const res = await post(u, { genres: [g1, g2] });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const got = await request(app).get('/api/suggestions').set(auth(u.token));
    assert.equal(got.body.batch.batch_id, res.body.batch_id, 'the onboarding batch is the latest one');
    const sugs = got.body.suggestions;                              // in rank order
    assert.ok(sugs.length > 0, 'the first batch is empty');
    const chosen = sugs.map((s, i) => ([g1, g2].includes(s.genre_id) ? i : -1)).filter((i) => i >= 0);
    const others = sugs.map((s, i) => ([g1, g2].includes(s.genre_id) ? -1 : i)).filter((i) => i >= 0);
    assert.ok(chosen.length > 0, 'no song of the chosen genres in the first batch');
    if (others.length) assert.ok(Math.max(...chosen) < Math.min(...others), 'a song of another genre ranks above a chosen one');
  });

  test('answering again changes seeded rows but never overwrites real listening history', async () => {
    const u = await newUser('again');
    const [g1, g2, g3] = await genresWithSongs();
    await post(u, { genres: [g1, g2] });
    // pretend the user really listened to g1: a learned value, with plays
    await query('UPDATE user_taste_profile SET affinity_score = 3.3, play_count = 2 WHERE user_id = @u AND genre_id = @g', { u: u.id, g: g1 });
    assert.equal((await post(u, { genres: [g3] })).status, 201);
    const t = await taste(u.id);
    assert.equal(t.get(g1).affinity_score, 3.3, 'learned affinity was overwritten');
    assert.equal(t.get(g1).play_count, 2);
    assert.equal(t.get(g2).affinity_score, 2.5, 'a genre no longer chosen goes back to 2.5');
    assert.equal(t.get(g3).affinity_score, 4);
  });
});
