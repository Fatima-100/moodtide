/* A15: the shared save function never creates duplicates (needs the database).
   Location: moodtide-backend/server/test/importer-save.test.js
   Everything runs inside a transaction that is rolled back, so the database is left untouched. */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, closePool } from '../src/db.js';
import { loadCatalogIndex } from '../scripts/lib/dedupe.js';
import { saveSong } from '../scripts/lib/save.js';

const song = (over = {}) => ({
  source: 'youtube', externalId: 'a15test001', title: 'A15 Test Song (Official Video)', durationSec: 200,
  artist: { name: 'A15 Test Artist', country: 'PK' }, album: { title: 'A15 Test Song', cover: null },
  year: 2020, popularity: 50, contentType: 'music', region: 'pakistani',
  sourceUrl: 'https://www.youtube.com/watch?v=a15test001', externalUrl: 'https://www.youtube.com/watch?v=a15test001',
  features: { energy: 0.5, happiness: 0.5, tempo: 100, danceability: 0.5, acousticness: 0.5 }, featureSource: 'estimated',
  genreIds: [], ...over,
});

describe('saveSong (rolled back after each test)', () => {
  let client;
  before(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  after(async () => { await client.query('ROLLBACK').catch(() => {}); client.release(); await closePool(); });

  test('a second run updates the song and creates no duplicate', async () => {
    const index = await loadCatalogIndex(client);
    const first = await saveSong(client, index, song());
    assert.equal(first.action, 'inserted');
    const second = await saveSong(client, index, song());
    assert.equal(second.action, 'updated');
    assert.equal(second.songId, first.songId);
    // a fresh index (as a new run would load it) gives the same answer
    const again = await saveSong(client, await loadCatalogIndex(client), song());
    assert.equal(again.action, 'updated');
    const [{ n }] = await query(`SELECT count(*) AS n FROM songs WHERE source = 'youtube' AND external_id = 'a15test001'`, {}, client);
    assert.equal(n, 1);
  });

  test('length_class, source_url and content_type are saved', async () => {
    const [row] = await query(`SELECT length_class, source_url, content_type, region FROM songs WHERE external_id = 'a15test001'`, {}, client);
    assert.equal(row.length_class, 'standard');
    assert.equal(row.source_url, 'https://www.youtube.com/watch?v=a15test001');
    assert.equal(row.content_type, 'music');
    assert.equal(row.region, 'pakistani');
  });

  test('the same artist and title under another video id is a duplicate', async () => {
    const index = await loadCatalogIndex(client);
    const r = await saveSong(client, index, song({ externalId: 'a15test002', title: 'A15 Test Song [Lyrics]' }));
    assert.equal(r.action, 'duplicate');
    const [{ n }] = await query(`SELECT count(*) AS n FROM songs WHERE external_id = 'a15test002'`, {}, client);
    assert.equal(n, 0);
  });

  test('an Islamic item is not turned into music', async () => {
    const index = await loadCatalogIndex(client);
    const r = await saveSong(client, index, song({ contentType: 'islamic' }));
    assert.equal(r.action, 'skipped');
  });

  test('a short song gets length_class short', async () => {
    const index = await loadCatalogIndex(client);
    const r = await saveSong(client, index, song({ externalId: 'a15test003', title: 'Another A15 Clip', durationSec: 60 }));
    assert.equal(r.action, 'inserted');
    const [row] = await query(`SELECT length_class FROM songs WHERE song_id = @id`, { id: r.songId }, client);
    assert.equal(row.length_class, 'short');
  });
});
