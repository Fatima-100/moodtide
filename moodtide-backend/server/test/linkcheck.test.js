/* A17: the stream link check (no database needed).
   Location: moodtide-backend/server/test/linkcheck.test.js
   A tiny local web server plays the part of Jamendo/Audius. */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { classify, probe, checkAll, looksLikeOutage } from '../scripts/lib/linkcheck.js';

let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const send = (status, type) => { res.writeHead(status, type ? { 'content-type': type } : {}); res.end(req.method === 'HEAD' ? undefined : 'x'); };
    if (path === '/ok') return send(200, 'audio/mpeg');
    if (path === '/gone') return send(404, 'text/plain');
    if (path === '/nohead') return req.method === 'HEAD' ? send(405) : send(206, 'audio/mpeg');   // refuses HEAD, answers GET
    if (path === '/page') return send(200, 'text/html; charset=utf-8');                         // an error page, not audio
    if (path === '/busy') return send(503, 'text/plain');
    if (path === '/forbidden') return send(403, 'text/plain');
    return send(404);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const fast = { retries: 0, retryDelayMs: 0, timeoutMs: 3000 };

describe('classify', () => {
  test('200 and 206 with audio are ok, a text page is dead', () => {
    assert.equal(classify(200, 'audio/mpeg').state, 'ok');
    assert.equal(classify(206, '').state, 'ok');
    assert.equal(classify(200, 'text/html; charset=utf-8').state, 'dead');
  });
  test('404, 410, 401 and 403 are dead; 429 and 5xx are only unverified', () => {
    for (const s of [404, 410, 401, 403]) assert.equal(classify(s).state, 'dead', String(s));
    for (const s of [429, 500, 502, 503]) assert.equal(classify(s).state, 'unverified', String(s));
  });
});

describe('probe', () => {
  test('a good link is ok', async () => assert.equal((await probe(`${base}/ok`, fast)).state, 'ok'));
  test('a missing link is dead', async () => assert.equal((await probe(`${base}/gone`, fast)).state, 'dead'));
  test('a server that refuses HEAD but answers GET is ok', async () => assert.equal((await probe(`${base}/nohead`, fast)).state, 'ok'));
  test('an error page served as 200 is dead', async () => assert.equal((await probe(`${base}/page`, fast)).state, 'dead'));
  test('403 is dead, a busy 503 is unverified (never hidden)', async () => {
    assert.equal((await probe(`${base}/forbidden`, fast)).state, 'dead');
    assert.equal((await probe(`${base}/busy`, fast)).state, 'unverified');
  });
  test('a closed port is dead, so a removed host is caught', async () => {
    // find a port that is free right now: open a server, note its port, close it
    const tmp = http.createServer();
    await new Promise((res) => tmp.listen(0, '127.0.0.1', res));
    const port = tmp.address().port;
    await new Promise((res) => tmp.close(res));
    const r = await probe(`http://127.0.0.1:${port}/x.mp3`, fast);
    assert.equal(r.state, 'dead', r.reason);
  });
});

describe('checkAll and the outage rule', () => {
  test('checks many links and keeps the extra fields', async () => {
    const items = ['ok', 'gone', 'nohead', 'busy', 'ok', 'gone'].map((p, i) => ({ song_id: `s${i}`, url: `${base}/${p}` }));
    const out = await checkAll(items, { concurrency: 3, ...fast });
    assert.deepEqual(out.map((r) => r.state), ['ok', 'dead', 'ok', 'unverified', 'ok', 'dead']);
    assert.deepEqual(out.map((r) => r.song_id), ['s0', 's1', 's2', 's3', 's4', 's5']);
  });
  test('a big share of failures looks like an outage, a few does not, a tiny sample never does', () => {
    assert.equal(looksLikeOutage(40, 100), true);
    assert.equal(looksLikeOutage(3, 100), false);
    assert.equal(looksLikeOutage(4, 4), false);
  });
});
