/* A17: the catalog report numbers add up (needs the database; everything is rolled back).
   Location: moodtide-backend/server/test/catalog-report.test.js */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, closePool } from '../src/db.js';
import { loadCatalogIndex } from '../scripts/lib/dedupe.js';
import { saveSong } from '../scripts/lib/save.js';
import { collect, render, streamsToCheck, markDead } from '../scripts/lib/report.js';

const sum = (rows, key) => rows.reduce((n, r) => n + Number(r[key]), 0);

describe('catalog report (rolled back after the tests)', () => {
  let client;
  before(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  after(async () => { await client.query('ROLLBACK').catch(() => {}); client.release(); await closePool(); });

  test('the counts add up', async () => {
    const d = await collect({ tx: client });
    assert.equal(sum(d.bySource, 'total'), d.totals.total);
    assert.equal(sum(d.bySource, 'active'), d.totals.active);
    assert.equal(sum(d.byRegion, 'tracks'), d.totals.active);
    assert.equal(sum(d.byLength, 'tracks'), d.totals.active);
    assert.ok(d.noFeaturesCount >= 0 && d.noGenre >= 0);
    assert.ok(d.byGenre.some((g) => g.genre_id.startsWith('gen_isl_')), 'Islamic categories (03_genres.sql) are missing');
    if (d.tags.available) assert.ok(d.tags.threePlus + d.tags.noTagsCount <= d.totals.active);
  });

  test('a song with no features, no tags and no genre shows up in the lists', async () => {
    const index = await loadCatalogIndex(client);
    const r = await saveSong(client, index, {
      source: 'jamendo', externalId: 'a17test1', title: 'A17 Report Song', durationSec: 200,
      artist: { name: 'A17 Report Artist' }, audioUrl: 'https://example.invalid/a17.mp3', license: 'CC BY 4.0',
    });
    assert.equal(r.action, 'inserted');
    const d = await collect({ tx: client, listLimit: 500 });
    assert.ok(d.noFeatures.some((s) => s.song_id === r.songId), 'missing from the "no features" list');
    if (d.tags.available) assert.ok(d.tags.noTags.some((s) => s.song_id === r.songId), 'missing from the "no tags" list');
    assert.match(render(d), /By genre/);
    assert.match(render(d), /Songs with NO features/);
  });

  test('the stream list holds jamendo and audius songs only, and markDead hides one', async () => {
    const streams = await streamsToCheck(['jamendo', 'audius'], client);
    assert.ok(streams.every((s) => ['jamendo', 'audius'].includes(s.source) && s.url));
    const mine = streams.find((s) => s.title === 'A17 Report Song');
    assert.ok(mine, 'the test song is not in the stream list');
    assert.deepEqual(await markDead([mine.song_id], client), [mine.song_id]);
    assert.deepEqual(await markDead([mine.song_id], client), [], 'a hidden song is not hidden twice');
    const [row] = await query('SELECT is_active FROM songs WHERE song_id = @id', { id: mine.song_id }, client);
    assert.equal(row.is_active, false);
    assert.ok(!(await streamsToCheck(['jamendo'], client)).some((s) => s.song_id === mine.song_id));
  });
});
