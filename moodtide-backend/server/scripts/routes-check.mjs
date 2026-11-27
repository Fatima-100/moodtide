/* =====================================================================
   A7 check: do the ported routes work on PostgreSQL?
   Location: moodtide-backend/server/scripts/routes-check.mjs

   Before you run it:
     1. The database is up and dev sample data is loaded (db/dev/dev_sample_data.sql).
     2. The API is running in another window:   npm run dev
   Then, from the server folder:
        $env:DEMO_ADMIN_PASSWORD = "your-admin-demo-password"    (adds the admin checks)
        node scripts/routes-check.mjs

   Routes that need engine.js (plays, ratings, check-ins, generating suggestions, journeys,
   adding a song to a playlist, similarity) are tested in task A8, not here.
   A temporary user is created and deleted at the end.
   ===================================================================== */
import { query, closePool } from '../src/db.js';

const API = process.env.API_URL || 'http://localhost:4000/api';
const email = `a7.check.${Date.now()}@example.com`;
const password = 'a7-check-password';
const results = [];
let token = null;
let adminToken = null;

async function call(method, path, body, bearer) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
async function check(name, fn) {
  try { results.push(['PASS', name, (await fn()) ?? '']); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const ok = (r, want = 200) => assert(r.status === want, `expected ${want}, got ${r.status}: ${JSON.stringify(r.json)?.slice(0, 200)}`);

// ---- set up a temporary user
{
  const r = await call('POST', '/auth/register', { username: 'A7 Check', email, password });
  token = r.json?.token;
  if (!token) { console.log('Could not register the temporary user. Is the API running?', r.status, r.json); await closePool(); process.exit(1); }
}

// ---- public catalog
let firstSong = null;
await check('GET /genres returns the music genres (8 or more)', async () => {
  const r = await call('GET', '/genres'); ok(r);
  assert(Array.isArray(r.json) && r.json.length >= 8, `got ${r.json?.length}`);
  assert(r.json.every((g) => !g.genre_id.startsWith('gen_isl_')), 'an Islamic genre appeared in the music list');
  return `${r.json.length} genres`;
});
await check('GET /genres?type=islamic returns only Islamic genres', async () => {
  const r = await call('GET', '/genres?type=islamic'); ok(r);
  assert(r.json.every((g) => g.genre_id.startsWith('gen_isl_')), 'a non-Islamic genre appeared');
  return `${r.json.length} (0 means the dev sample data is not loaded)`;
});
await check('GET /songs returns songs with genre and numeric features', async () => {
  const r = await call('GET', '/songs'); ok(r);
  assert(Array.isArray(r.json), 'not an array');
  assert(r.json.length > 0, 'no songs: load db/dev/dev_sample_data.sql first');
  firstSong = r.json[0];
  assert(typeof firstSong.energy === 'number', `energy is ${typeof firstSong.energy}, expected number`);
  assert(firstSong.artist && firstSong.genre, 'artist or genre missing');
  assert(r.json.every((s) => s.content_type === 'music'), 'a non-music song in the default list');
  return `${r.json.length} songs`;
});
await check('search is case-insensitive and limit works', async () => {
  const r = await call('GET', '/songs?q=SAMPLE&limit=3'); ok(r);
  assert(r.json.length === 3, `expected 3, got ${r.json.length}`);
  const none = await call('GET', '/songs?q=zzzz-nothing'); ok(none);
  assert(none.json.length === 0, 'expected no results');
});
await check('region filter works, and "asian" groups indian + korean + japanese', async () => {
  const p = await call('GET', '/songs?region=pakistani'); ok(p);
  assert(p.json.length > 0 && p.json.every((s) => s.region === 'pakistani'), 'wrong regions for pakistani');
  const a = await call('GET', '/songs?region=asian'); ok(a);
  assert(a.json.length > 0 && a.json.every((s) => ['indian', 'korean', 'japanese'].includes(s.region)), 'wrong regions for asian');
});
await check('type=islamic returns only Islamic content', async () => {
  const r = await call('GET', '/songs?type=islamic'); ok(r);
  assert(r.json.every((s) => s.content_type === 'islamic'), 'a music song in the Islamic list');
  return `${r.json.length} songs`;
});
await check('every sort option runs without an error', async () => {
  for (const sort of ['popular', 'newest', 'oldest', 'title', 'artist']) {
    const r = await call('GET', `/songs?sort=${sort}&limit=5`); ok(r);
  }
});
await check('genre, artist and year filters run', async () => {
  const r = await call('GET', `/songs?genre=${firstSong.genre_id}&artist=${firstSong.artist_id}&year=${firstSong.release_year ?? 2020}`); ok(r);
  assert(Array.isArray(r.json), 'not an array');
});
await check('GET /artists returns song counts as numbers', async () => {
  const r = await call('GET', '/artists'); ok(r);
  assert(r.json.length > 0 && typeof r.json[0].song_count === 'number', `song_count is ${typeof r.json[0]?.song_count}`);
});
await check('GET /songs/:id returns the song, and an unknown id returns 404', async () => {
  const r = await call('GET', `/songs/${firstSong.song_id}`); ok(r);
  assert(r.json.song_id === firstSong.song_id, 'wrong song');
  const nf = await call('GET', '/songs/does-not-exist'); ok(nf, 404);
});

// ---- logged-in routes
await check('protected routes return 401 without a token', async () => {
  for (const p of ['/preferences', '/history', '/ratings', '/mood/current', '/playlists', '/suggestions']) {
    const r = await call('GET', p); assert(r.status === 401, `${p} gave ${r.status}`);
  }
});
await check('preferences: default is "all", save works, invalid value returns 400', async () => {
  const g = await call('GET', '/preferences', null, token); ok(g);
  assert(g.json.region === 'all', `default was ${g.json.region}`);
  const put = await call('PUT', '/preferences', { region: 'pakistani' }, token); ok(put);
  const g2 = await call('GET', '/preferences', null, token);
  assert(g2.json.region === 'pakistani', 'region was not saved');
  const bad = await call('PUT', '/preferences', { region: 'mars' }, token); ok(bad, 400);
});
await check('empty lists for a new user: history, ratings, mood, checkins, suggestions', async () => {
  for (const p of ['/history', '/ratings', '/mood/history', '/mood/checkins']) {
    const r = await call('GET', p, null, token); ok(r);
    assert(Array.isArray(r.json) && r.json.length === 0, `${p} should be an empty list`);
  }
  const cur = await call('GET', '/mood/current', null, token); ok(cur);
  assert(cur.json === null, 'mood/current should be null');
  const s = await call('GET', '/suggestions', null, token); ok(s);
  assert(s.json.batch === null && s.json.suggestions.length === 0, 'suggestions should be empty');
});
await check('playlists: create, list (song_count is a number), get, delete, then 404', async () => {
  const c = await call('POST', '/playlists', { name: 'A7 test list', description: 'temporary' }, token); ok(c, 201);
  const id = c.json.playlist_id;
  const l = await call('GET', '/playlists', null, token); ok(l);
  assert(l.json.length === 1 && l.json[0].song_count === 0, `list was ${JSON.stringify(l.json).slice(0, 150)}`);
  const g = await call('GET', `/playlists/${id}`, null, token); ok(g);
  assert(Array.isArray(g.json.songs) && g.json.songs.length === 0, 'songs should be an empty list');
  const tooLong = await call('POST', '/playlists', { name: 'x'.repeat(101) }, token); ok(tooLong, 400);
  const d = await call('DELETE', `/playlists/${id}`, null, token); ok(d);
  const again = await call('GET', `/playlists/${id}`, null, token); ok(again, 404);
});
await check('a normal user gets 403 on admin routes', async () => {
  const r = await call('GET', '/admin/weights', null, token);
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

// ---- admin
if (process.env.DEMO_ADMIN_PASSWORD) {
  const r = await call('POST', '/auth/login', { email: 'admin@moodtide.com', password: process.env.DEMO_ADMIN_PASSWORD });
  adminToken = r.json?.token;
}
if (adminToken) {
  await check('admin: GET /admin/weights returns 6 numeric weights', async () => {
    const r = await call('GET', '/admin/weights', null, adminToken); ok(r);
    assert(r.json.length === 6 && r.json.every((w) => typeof w.weight_value === 'number'), `got ${JSON.stringify(r.json).slice(0, 150)}`);
  });
  await check('admin: PUT /admin/weights saves a value and writes an audit row', async () => {
    const before = (await call('GET', '/admin/weights', null, adminToken)).json.find((w) => w.weight_name === 'w_fresh').weight_value;
    const put = await call('PUT', '/admin/weights', { w_fresh: before }, adminToken); ok(put);
    const bad = await call('PUT', '/admin/weights', { w_fresh: 5 }, adminToken); ok(bad, 400);
    const a = await call('GET', '/admin/audit?limit=5', null, adminToken); ok(a);
    assert(a.json.length > 0 && a.json.length <= 5, `audit length ${a.json.length}`);
    assert(a.json.some((x) => x.table_name === 'Scoring_Weights'), 'no Scoring_Weights audit row');
  });
  await check('admin: GET /admin/ab-stats returns one row per cohort with numeric values', async () => {
    const r = await call('GET', '/admin/ab-stats', null, adminToken); ok(r);
    assert(r.json.length >= 1, 'no rows');
    assert(r.json.every((c) => ['A', 'B'].includes(c.cohort) && typeof c.users === 'number'), `got ${JSON.stringify(r.json).slice(0, 200)}`);
    return JSON.stringify(r.json.map((c) => ({ cohort: c.cohort, users: c.users, plays: c.plays })));
  });
} else {
  results.push(['SKIP', 'admin checks (weights, audit, ab-stats)', 'set DEMO_ADMIN_PASSWORD to include them']);
}

// ---- clean up
await query('DELETE FROM users WHERE email = @e', { e: email });

console.log('\nA7 routes check');
console.log('---------------');
for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? '   [' + detail + ']' : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
const passed = results.filter((r) => r[0] === 'PASS').length;
console.log(`\n${passed} passed, ${failed} failed`);
await closePool();
process.exit(failed ? 1 : 0);
