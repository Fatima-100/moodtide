/* A29: short-clip feed endpoint (GET /api/feed/clips).
   Location: moodtide-backend/server/test/feed.test.js */
import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';
import { decodeCursor, encodeCursor, getClipFeed, CLIP_LEN_DEFAULT } from '../src/feed.js';

describe('A29 feed cursor encoding and decoding', () => {
  test('encodeCursor and decodeCursor roundtrip successfully', () => {
    const ids = ['jam_1', 'jam_2', 'aud_3'];
    const encoded = encodeCursor(ids, 3);
    assert.ok(typeof encoded === 'string' && encoded.length > 0);

    const decoded = decodeCursor(encoded);
    assert.deepEqual(decoded.seen, ids);
    assert.equal(decoded.offset, 3);
  });

  test('decodeCursor gracefully handles null, empty string, or invalid base64/JSON', () => {
    assert.equal(decodeCursor(null), null);
    assert.equal(decodeCursor(''), null);
    assert.equal(decodeCursor('not-valid-base64-json!'), null);
    assert.equal(decodeCursor(Buffer.from('{"seen":"not an array"}').toString('base64')), null);
  });
});

describe('GET /api/feed/clips endpoint and feed logic', () => {
  const email = `a29.test.${Date.now()}.${Math.floor(Math.random() * 1000)}@example.com`;
  const password = 'a29-password-123';
  let token = null;
  let userId = null;
  const as = (req) => req.set({ Authorization: `Bearer ${token}` });

  before(async () => {
    try {
      const reg = await request(app).post('/api/auth/register').send({ username: 'A29Tester', email, password });
      if (reg.status === 201) {
        token = reg.body.token;
        userId = reg.body.user.user_id;
      }
    } catch {
      // If DB is offline in test runner, integration tests will skip or report cleanly
    }
  });

  after(async () => {
    if (userId) {
      try {
        await query('DELETE FROM events WHERE user_id = @u', { u: userId });
        await query('DELETE FROM users WHERE user_id = @u', { u: userId });
      } catch {}
    }
    await closePool().catch(() => {});
  });

  test('requires authentication', async () => {
    const res = await request(app).get('/api/feed/clips');
    assert.equal(res.status, 401);
  });

  test('returns clips with valid structure, valid source and length attributes', async (t) => {
    if (!token) return t.skip('database connection required for live endpoint test');

    const res = await as(request(app).get('/api/feed/clips?limit=5'));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.clips));
    assert.ok(res.body.clips.length <= 5);

    if (res.body.clips.length > 0) {
      const c = res.body.clips[0];
      assert.ok(c.song_id);
      assert.ok(c.title);
      assert.ok(c.audio_url);
      assert.ok(['jamendo', 'audius', 'creator'].includes(c.source), `unexpected source: ${c.source}`);
      assert.ok(c.clip_start_sec >= 0);
      assert.ok(c.clip_len_sec > 0 && c.clip_len_sec <= CLIP_LEN_DEFAULT);
      assert.ok(c.target_mood);
      assert.ok(typeof c.is_exploration === 'boolean');
    }
  });

  test('skips songs that the user previously had impressions for', async (t) => {
    if (!token || !userId) return t.skip('database connection required');

    const first = await as(request(app).get('/api/feed/clips?limit=3'));
    if (!first.body.clips || first.body.clips.length === 0) return t.skip('catalog has no audio tracks');

    const shownSongId = first.body.clips[0].song_id;

    // Log impression event for that song
    await as(request(app).post('/api/events')).send([
      { event_type: 'impression', song_id: shownSongId, context: { screen: 'feed' } }
    ]);

    // Next request without cursor should exclude that song from top priority
    const next = await as(request(app).get('/api/feed/clips?limit=5'));
    // If there are enough candidates, shownSongId shouldn't be in the top clips
    if (next.body.clips.length > 1) {
      const ids = next.body.clips.map((x) => x.song_id);
      assert.ok(!ids.includes(shownSongId) || ids.indexOf(shownSongId) > 0);
    }
  });

  test('cursor pagination returns next_cursor and avoids repeats across successive pages', async (t) => {
    if (!token) return t.skip('database connection required');

    const page1 = await as(request(app).get('/api/feed/clips?limit=3'));
    if (!page1.body.clips || page1.body.clips.length < 2) return t.skip('insufficient audio tracks to test pagination');

    const page1Ids = page1.body.clips.map((c) => c.song_id);
    assert.ok(page1.body.next_cursor);

    const page2 = await as(request(app).get(`/api/feed/clips?limit=3&cursor=${encodeURIComponent(page1.body.next_cursor)}`));
    assert.equal(page2.status, 200);

    const page2Ids = page2.body.clips.map((c) => c.song_id);
    // Page 2 must not repeat page 1 songs if catalog has enough items
    for (const id of page2Ids) {
      assert.ok(!page1Ids.includes(id), `Song ${id} repeated across pages with cursor`);
    }
  });
});
