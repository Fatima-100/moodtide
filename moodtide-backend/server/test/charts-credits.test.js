/* Song credit fields and the Pakistan chart (needs the database; test rows are removed afterwards). */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';

describe('song credits and Pakistan chart', () => {
  let saved = [];
  before(async () => {
    saved = await query(`SELECT * FROM chart_tracks WHERE country = 'Pakistan'`);
    await query(`DELETE FROM chart_tracks WHERE country = 'Pakistan'`);
    await query(`INSERT INTO artists (artist_id, name, source) VALUES ('credit_a', 'Credit Artist', 'jamendo')`);
    await query(`INSERT INTO songs (song_id, artist_id, title, duration_sec, source, license, attribution_text, source_url, length_class)
      VALUES ('credit_on', 'credit_a', 'Credit Song', 200, 'jamendo', 'CC BY 4.0', 'Credit line', 'https://example.com/t', 'standard')`);
    await query(`INSERT INTO songs (song_id, artist_id, title, duration_sec, is_active) VALUES ('credit_off', 'credit_a', 'Hidden Song', 200, false)`);
  });
  after(async () => {
    await query(`DELETE FROM chart_tracks WHERE country = 'Pakistan'`);
    for (const r of saved) {
      await query(`INSERT INTO chart_tracks (country, position, title, artist, lastfm_url, song_id, fetched_at)
        VALUES (@country, @position, @title, @artist, @lastfm_url, @song_id, @fetched_at)`, r);
    }
    await query(`DELETE FROM artists WHERE artist_id = 'credit_a'`);
    await closePool();
  });

  test('a song carries its credit fields', async () => {
    const res = await request(app).get('/api/songs/credit_on');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'jamendo');
    assert.equal(res.body.license, 'CC BY 4.0');
    assert.equal(res.body.attribution_text, 'Credit line');
    assert.equal(res.body.source_url, 'https://example.com/t');
    assert.equal(res.body.length_class, 'standard');
  });

  test('an empty chart answers with an empty list and no login', async () => {
    const res = await request(app).get('/api/charts/pakistan');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { country: 'Pakistan', source: 'Last.fm', fetched_at: null, tracks: [] });
  });

  test('the chart is ordered, limited, and hides the id of a hidden song', async () => {
    await query(`INSERT INTO chart_tracks (country, position, title, artist, lastfm_url, song_id) VALUES
      ('Pakistan', 2, 'Two', 'B', 'https://last.fm/2', 'credit_off'),
      ('Pakistan', 1, 'One', 'A', 'https://last.fm/1', 'credit_on'),
      ('Pakistan', 3, 'Three', 'C', NULL, NULL)`);
    const res = await request(app).get('/api/charts/pakistan?limit=2');
    assert.deepEqual(res.body.tracks.map((t) => [t.position, t.song_id]), [[1, 'credit_on'], [2, null]]);
    assert.ok(res.body.fetched_at);
  });
});
