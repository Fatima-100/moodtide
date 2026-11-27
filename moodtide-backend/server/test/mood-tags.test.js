/* A20: mood from tags. Needs the database with db/init loaded (including 05_tag_mood.sql) and some songs.
   Every test runs inside a transaction that is rolled back, so nothing is left in your database.
   Location: moodtide-backend/server/test/mood-tags.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withTx, closePool } from '../src/db.js';
import { MOOD_COORDINATES, tagScores, moodMatch, detectMood, generateSuggestions } from '../src/engine.js';

const stamp = `${Date.now()}.${Math.floor(Math.random() * 1000)}`;
const id = (name) => `a20_${name}_${stamp}`;

after(closePool);

class Rollback extends Error {}
async function inRolledBackTx(fn) {
  await assert.rejects(() => withTx(async (tx) => { await fn(tx); throw new Rollback(); }), Rollback);
}

// two songs with the SAME audio features; only their tags differ
async function addTwinSongs(tx) {
  await query("INSERT INTO artists (artist_id, name) VALUES (@a, 'A20 test artist')", { a: id('artist') }, tx);
  for (const [name, tag] of [['blue', 'sad'], ['loud', 'party'], ['plain', null]]) {
    await query("INSERT INTO songs (song_id, artist_id, title, duration_sec) VALUES (@s, @a, @t, 200)",
      { s: id(name), a: id('artist'), t: `A20 ${name}` }, tx);
    await query(`INSERT INTO song_features (song_id, energy, happiness, tempo, danceability, acousticness)
                 VALUES (@s, 0.5, 0.5, 100, 0.5, 0.5)`, { s: id(name) }, tx);
    // "pakistani" is not in tag_mood_map, so it must not change the score
    for (const t of [tag, 'pakistani'].filter(Boolean)) {
      await query("INSERT INTO song_tags (song_id, tag, weight, source) VALUES (@s, @t, 100, 'lastfm_track')", { s: id(name), t }, tx);
    }
  }
}

// a new mood-aware (cohort B) user checks in, and gets a batch of suggestions
async function suggestFor(mood, energy, tx) {
  const userId = id(`user_${mood}`);
  await query(`INSERT INTO users (user_id, role_id, username, email, password_hash, experiment_group)
               VALUES (@u, 'rol_2', 'A20 test', @e, 'not-a-real-hash', 'B')`, { u: userId, e: `${userId}@example.com` }, tx);
  await query('INSERT INTO mood_checkins (checkin_id, user_id, mood_label, energy_level) VALUES (@c, @u, @m, @e)',
    { c: id(`checkin_${mood}`), u: userId, m: mood, e: energy }, tx);
  assert.equal((await detectMood(userId, tx)).detected_mood, mood);
  const batchId = await generateSuggestions(userId, tx);
  return query(`SELECT s.song_id, s.mood_match_score, f.energy, f.happiness
                FROM suggestions s JOIN song_features f ON f.song_id = s.song_id
                WHERE s.batch_id = @b ORDER BY s.rank_position`, { b: batchId }, tx);
}

describe('tag_mood_map', () => {
  test('has about 60 tags covering the five moods', async () => {
    const rows = await query('SELECT mood, count(*) AS n FROM tag_mood_map GROUP BY mood');
    assert.deepEqual(rows.map((r) => r.mood).sort(), Object.keys(MOOD_COORDINATES).sort());
    const [{ n }] = await query('SELECT count(DISTINCT tag) AS n FROM tag_mood_map');
    assert.ok(n >= 55, `only ${n} tags`);
  });
});

describe('mood match', () => {
  test('moodMatch blends features and tags, and ignores missing tags', () => {
    const target = { energy: 0.5, happiness: 0.5 };
    const song = { energy: 0.5, happiness: 0.5 };                       // feature score 1
    assert.equal(moodMatch(song, target, undefined, 0.4), 1);
    assert.ok(Math.abs(moodMatch(song, target, 0.5, 0.4) - 0.8) < 1e-9); // 0.6 * 1 + 0.4 * 0.5
    assert.equal(moodMatch(song, target, 0, 0), 1);                      // w_tag 0 = features only
  });

  test('songs with identical features are separated by their tags', async () => {
    await inRolledBackTx(async (tx) => {
      await addTwinSongs(tx);
      const sad = await tagScores('sad', tx);
      const energetic = await tagScores('energetic', tx);
      assert.equal(sad.get(id('blue')), 1);
      assert.equal(sad.get(id('loud')), 0);
      assert.equal(energetic.get(id('loud')), 1);
      assert.equal(energetic.get(id('blue')), 0);
      assert.equal(sad.has(id('plain')), false);

      const song = { energy: 0.5, happiness: 0.5 };
      const match = (mood, name, scores) => moodMatch(song, MOOD_COORDINATES[mood], scores.get(id(name)), 0.4);
      assert.ok(match('sad', 'blue', sad) > match('sad', 'loud', sad));
      assert.ok(match('energetic', 'loud', energetic) > match('energetic', 'blue', energetic));
    });
  });
});

describe('suggestions', () => {
  test('sad and energetic suggestions visibly differ', async () => {
    await inRolledBackTx(async (tx) => {
      const sad = await suggestFor('sad', 2, tx);
      const energetic = await suggestFor('energetic', 5, tx);
      assert.ok(sad.length >= 5 && energetic.length >= 5, 'not enough songs: load db/dev/dev_sample_data.sql');

      const top = (list) => list.slice(0, 5);
      assert.notDeepEqual(top(sad).map((s) => s.song_id), top(energetic).map((s) => s.song_id));
      const average = (list, key) => top(list).reduce((a, s) => a + s[key], 0) / top(list).length;
      assert.ok(average(energetic, 'energy') - average(sad, 'energy') > 0.1,
        `top 5 energy: sad ${average(sad, 'energy')}, energetic ${average(energetic, 'energy')}`);
    });
  });

  test('the stored mood score uses the w_tag weight from scoring_weights', async () => {
    await inRolledBackTx(async (tx) => {
      await addTwinSongs(tx);
      // with w_tag = 1 the stored mood score of a tagged song must be exactly its tag score
      await query("UPDATE scoring_weights SET weight_value = 1 WHERE weight_name = 'w_tag'", {}, tx);
      const batch = await suggestFor('sad', 2, tx);
      const scores = await tagScores('sad', tx);
      const tagged = batch.filter((x) => scores.has(x.song_id));
      assert.ok(tagged.length > 0, 'no tagged song in the batch');
      for (const x of tagged) assert.ok(Math.abs(x.mood_match_score - scores.get(x.song_id)) <= 0.0051, JSON.stringify(x));
    });
  });
});
