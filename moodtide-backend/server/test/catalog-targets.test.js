/* A35: target counts and catalog cleanup (needs the database; everything is rolled back).
   Location: moodtide-backend/server/test/catalog-targets.test.js */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pool, query, closePool } from '../src/db.js';
import { loadCatalogIndex } from '../scripts/lib/dedupe.js';
import { saveSong } from '../scripts/lib/save.js';
import { CORE_CATEGORIES, collectTargets, renderTargets } from '../scripts/lib/targets.js';
import { findDuplicates, hideDuplicates, findUnplayable, checkVideos, videoProblem, hiddenSql } from '../scripts/lib/clean.js';

describe('A35 catalog targets and cleanup (rolled back after the tests)', () => {
  let client;
  before(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  after(async () => { await client.query('ROLLBACK').catch(() => {}); client.release(); await closePool(); });

  const add = async (id, extra = {}) => {
    const index = await loadCatalogIndex(client);
    const r = await saveSong(client, index, {
      source: 'youtube', externalId: id, title: `A35 ${id}`, durationSec: 200, artist: { name: 'A35 Artist' },
      features: { energy: 0.75, happiness: 0.85, tempo: 124, danceability: 0.5, acousticness: 0.5 },
      genreIds: ['gen_kpop'], ...extra,
    });
    assert.equal(r.action, 'inserted');
    return r.songId;
  };
  const read = (opts) => collectTargets({ tx: client, ...opts });
  const kpop = (d) => d.categories.find((c) => c.genre_id === 'gen_kpop').tracks;
  const happy = (d) => d.moods.find((m) => m.mood === 'happy').candidates;

  test('all 15 categories exist and a new song is counted in total, category and mood', async () => {
    const a = await read();
    assert.equal(CORE_CATEGORIES.length, 15);
    assert.ok(a.categories.every((c) => !c.name.includes('not in the database')));
    await add('a35count');
    const b = await read();
    assert.equal(b.tracks, a.tracks + 1);
    assert.equal(kpop(b), kpop(a) + 1);
    assert.equal(happy(b), happy(a) + 1);
    assert.equal(b.moods.length, 5);
  });

  test('targets pass or fail as set, and demo songs never count', async () => {
    const [{ n }] = await query(`SELECT count(*)::int AS n FROM songs WHERE is_active AND source <> 'demo'`, {}, client);
    const d = await read({ total: n + 1 });
    assert.equal(d.tracks, n);
    assert.equal(d.totalOk, false);
    assert.equal(d.ok, false);
    assert.match(renderTargets(d), /not met yet/);
    assert.equal((await read({ total: n })).totalOk, true);
  });

  test('duplicates: one copy is kept and receives the genres; a remix is not a duplicate', async () => {
    const keep = await add('a35dupA', { title: 'A35 Twin', popularity: 90 });
    const copy = await add('a35dupB', { title: 'A35 Other', popularity: 10, genreIds: ['gen_jpop'] });
    const remix = await add('a35dupC', { title: 'A35 Third' });
    await query(`UPDATE songs SET title = 'a35  TWIN!' WHERE song_id = @id`, { id: copy }, client);
    await query(`UPDATE songs SET title = 'A35 Twin (Remix)' WHERE song_id = @id`, { id: remix }, client);
    const mine = (await findDuplicates(client)).filter((g) => g.keep.artist === 'A35 Artist');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].keep.song_id, keep);
    assert.deepEqual(mine[0].hide.map((s) => s.song_id), [copy]);
    assert.deepEqual(await hideDuplicates(mine, client), [copy]);
    const genres = await query('SELECT genre_id FROM song_genres WHERE song_id = @id ORDER BY genre_id', { id: keep }, client);
    assert.deepEqual(genres.map((g) => g.genre_id), ['gen_jpop', 'gen_kpop']);
    assert.match(await hiddenSql(client), new RegExp(`'${copy}'`));
    assert.doesNotMatch(await hiddenSql(client), new RegExp(`'${keep}'`));
  });

  test('a jamendo song without a stream address is unplayable', async () => {
    const id = await add('a35nourl', { source: 'jamendo', title: 'A35 No Url', license: 'CC BY 4.0' });
    assert.ok((await findUnplayable(client)).some((s) => s.song_id === id));
  });

  test('video problems', () => {
    const ok = { status: { privacyStatus: 'public', embeddable: true }, contentDetails: { duration: 'PT3M' } };
    assert.equal(videoProblem(ok), null);
    assert.match(videoProblem(undefined), /removed/);
    assert.match(videoProblem({ ...ok, status: { embeddable: false } }), /embedding/);
    assert.match(videoProblem({ ...ok, contentDetails: { duration: 'PT3M', regionRestriction: { blocked: ['PK'] } } }), /blocked/);
    assert.match(videoProblem({ ...ok, contentDetails: { duration: 'PT3M', regionRestriction: { allowed: ['US'] } } }), /blocked/);
  });

  test('checkVideos reports missing videos and throws when YouTube fails', async () => {
    let fail = false;
    const server = http.createServer((req, res) => {
      res.writeHead(fail ? 403 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fail ? { error: { message: 'quota' } }
        : { items: [{ id: 'here', status: { embeddable: true }, contentDetails: { duration: 'PT2M' } }] }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const songs = [{ song_id: '1', external_id: 'here' }, { song_id: '2', external_id: 'gone' }];
      assert.deepEqual((await checkVideos(songs, { key: 'k', base })).map((s) => s.song_id), ['2']);
      fail = true;
      await assert.rejects(checkVideos(songs, { key: 'k', base }), /403/);
    } finally { server.close(); }
  });
});
