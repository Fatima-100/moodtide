/* =====================================================================
   A8 check: does the recommendation engine work on PostgreSQL?
   Location: moodtide-backend/server/scripts/engine-check.mjs

   Before you run it:
     1. The database is up with the dev sample data loaded (db/dev/dev_sample_data.sql).
     2. The API is running in another window:   npm run dev
   Then, from the server folder:   node scripts/engine-check.mjs

   It creates two temporary users, runs a full story (check-in, suggestions, plays,
   rating, mood detection, playlists, journeys, similarity, region choice) and deletes
   the users at the end. Prints PASS or FAIL for each step.
   ===================================================================== */
import { query, withTx, closePool } from '../src/db.js';
import * as engine from '../src/engine.js';

const API = process.env.API_URL || 'http://localhost:4000/api';
const stamp = Date.now();
const emails = [`a8.one.${stamp}@example.com`, `a8.two.${stamp}@example.com`];
const password = 'a8-check-password';
const results = [];
const tokens = [];
const ids = [];

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
const ok = (r, want = 200) => assert(r.status === want, `expected ${want}, got ${r.status}: ${JSON.stringify(r.json)?.slice(0, 220)}`);
const near = (a, b) => Math.abs(Number(a) - b) < 0.001;

// ---- set up two temporary users, both in cohort B (mood-aware)
for (const email of emails) {
  const r = await call('POST', '/auth/register', { username: 'A8 Check', email, password });
  if (!r.json?.token) { console.log('Could not register a temporary user. Is the API running?', r.status, r.json); await closePool(); process.exit(1); }
  tokens.push(r.json.token);
  await query("UPDATE users SET experiment_group = 'B' WHERE email = @e", { e: email });
  const [u] = await query('SELECT user_id FROM users WHERE email = @e', { e: email });
  ids.push(u.user_id);
}
const [t1, t2] = tokens;
const [u1, u2] = ids;
const [{ n: musicSongs }] = await query("SELECT count(*) AS n FROM songs s JOIN song_features f ON f.song_id = s.song_id WHERE s.is_active AND s.content_type = 'music'");
if (musicSongs < 8) { console.log(`Only ${musicSongs} music songs with features. Load db/dev/dev_sample_data.sql first.`); await cleanup(); process.exit(1); }

let sugs = [];
let first = null;          // the top suggestion after the check-in
let genreOfFirst = null;

// ---- 1. check-in, detection and suggestions in one transaction
await check('POST /checkins rejects a bad mood and a bad energy value (400)', async () => {
  ok(await call('POST', '/checkins', { mood: 'angry', energy: 3 }, t1), 400);
  ok(await call('POST', '/checkins', { mood: 'sad', energy: 9 }, t1), 400);
});
await check('POST /checkins (sad, energy 2) detects "sad" and creates a batch', async () => {
  const t0 = Date.now();
  const r = await call('POST', '/checkins', { mood: 'sad', energy: 2 }, t1);
  const ms = Date.now() - t0;
  ok(r, 201);
  assert(r.json.detected.detected_mood === 'sad', `detected ${r.json.detected.detected_mood}`);
  assert(r.json.detected.mood_score === 40, `mood_score ${r.json.detected.mood_score}, expected energy 2 x 20 = 40`);
  assert(r.json.batch_id, 'no batch id');
  return `${ms} ms`;
});
await check('GET /suggestions: ranked batch, numeric scores, reasons, music only', async () => {
  const r = await call('GET', '/suggestions', null, t1); ok(r);
  sugs = r.json.suggestions;
  assert(sugs.length >= 8 && sugs.length <= 20, `got ${sugs.length} suggestions`);
  assert(r.json.batch.variant === 'B', `variant ${r.json.batch.variant}`);
  assert(sugs.every((s, i) => s.rank_position === i + 1), 'ranks are not 1, 2, 3 ...');
  assert(sugs.every((s) => typeof s.total_score === 'number' && typeof s.mood_match_score === 'number'), 'scores are not numbers');
  assert(sugs.every((s) => s.content_type === 'music'), 'a non-music song was suggested');
  assert(sugs.every((s) => Array.isArray(s.reasons)), 'reasons missing');
  assert(sugs.some((s) => s.reasons.length > 0), 'no suggestion has a reason');
  first = sugs[0];
  [{ genre_id: genreOfFirst }] = await query('SELECT genre_id FROM song_genres WHERE song_id = @s ORDER BY genre_id LIMIT 1', { s: first.song_id });
  return `${sugs.length} songs, top: ${first.title}`;
});
await check('mood matching works: for "sad" the top song is the sad piano', async () => {
  assert(first.title === 'Sample Sad Piano', `top was "${first.title}" (sample data expected Sample Sad Piano)`);
});
await check('mood detection was stored', async () => {
  const r = await call('GET', '/mood/current', null, t1); ok(r);
  assert(r.json && r.json.detected_mood === 'sad', `current ${JSON.stringify(r.json)?.slice(0, 120)}`);
  assert(typeof r.json.mood_score === 'number', 'mood_score is not a number');
});

// ---- 2. plays teach the taste profile
const play = (body) => call('POST', '/plays', { songId: first.song_id, source: 'suggestion', suggestionId: first.suggestion_id, ...body }, t1);
const taste = async () => (await query('SELECT affinity_score, play_count FROM user_taste_profile WHERE user_id = @u AND genre_id = @g', { u: u1, g: genreOfFirst }))[0];

await check('a skip is a -1 signal; affinity becomes 2.9; the suggestion is marked skipped', async () => {
  const r = await play({ listenedSec: 5, completed: false }); ok(r, 201);
  assert(r.json.signal === 'skip', `signal ${r.json.signal}`);
  const t = await taste();
  assert(t && near(t.affinity_score, 2.9) && t.play_count === 1, `taste ${JSON.stringify(t)}`);
  const s = (await call('GET', '/suggestions', null, t1)).json.suggestions.find((x) => x.suggestion_id === first.suggestion_id);
  assert(s.outcome === 'skipped', `outcome ${s.outcome}`);
});
await check('a full play is +1: affinity 3.0, suggestion marked played', async () => {
  const r = await play({ listenedSec: 200, completed: true }); ok(r, 201);
  assert(r.json.signal === 'full_play', `signal ${r.json.signal}`);
  const t = await taste();
  assert(near(t.affinity_score, 3.0) && t.play_count === 2, `taste ${JSON.stringify(t)}`);
});
await check('a replay is +2: affinity 3.2', async () => {
  const r = await play({ listenedSec: 200, completed: true, isReplay: true }); ok(r, 201);
  assert(r.json.signal === 'replay', `signal ${r.json.signal}`);
  const t = await taste();
  assert(near(t.affinity_score, 3.2) && t.play_count === 3, `taste ${JSON.stringify(t)}`);
});
await check('plays need a songId (400) and a missing song is rejected', async () => {
  ok(await call('POST', '/plays', {}, t1), 400);
  const r = await call('POST', '/plays', { songId: 'does-not-exist', source: 'search' }, t1);
  assert(r.status === 400, `expected 400 (foreign key), got ${r.status}`);
});
await check('listening history has the 3 plays', async () => {
  const r = await call('GET', '/history', null, t1); ok(r);
  assert(r.json.length === 3, `got ${r.json.length}`);
});
await check('implicit signals were stored (1 skip, 1 full play, 1 replay)', async () => {
  const rows = await query('SELECT signal_type, count(*) AS n FROM implicit_signals WHERE user_id = @u GROUP BY signal_type', { u: u1 });
  const m = Object.fromEntries(rows.map((r) => [r.signal_type, r.n]));
  assert(m.skip === 1 && m.full_play === 1 && m.replay === 1, `got ${JSON.stringify(m)}`);
});

// ---- 3. a rating changes the taste profile too
await check('rating: bad values are rejected, 5 stars adds +0.4 (affinity 3.6)', async () => {
  ok(await call('POST', '/ratings', { songId: first.song_id, stars: 6 }, t1), 400);
  const r = await call('POST', '/ratings', { songId: first.song_id, stars: 5, suggestionId: first.suggestion_id }, t1); ok(r, 201);
  const t = await taste();
  assert(near(t.affinity_score, 3.6) && t.play_count === 3, `taste ${JSON.stringify(t)}`);
  const s = (await call('GET', '/suggestions', null, t1)).json.suggestions.find((x) => x.suggestion_id === first.suggestion_id);
  assert(s.outcome === 'rated', `outcome ${s.outcome}`);
  const list = await call('GET', '/ratings', null, t1);
  assert(list.json.length === 1 && list.json[0].stars === 5, 'rating not listed');
});

// ---- 4. mood detection from listening history only
await check('POST /mood/detect: a replay loop on a low-energy song means "calm" (88)', async () => {
  const r = await call('POST', '/mood/detect', null, t1); ok(r);
  assert(r.json.detected_mood === 'calm' && r.json.mood_score === 88, `got ${r.json.detected_mood} ${r.json.mood_score}: ${r.json.rule}`);
  const h = await call('GET', '/mood/history', null, t1);
  assert(h.json.length >= 2, `mood history has ${h.json.length} rows`);
});

// ---- 5. playlists and mood journeys
await check('playlist: add song (position 1, 2), duplicate gives 409, signal stored', async () => {
  const pl = await call('POST', '/playlists', { name: 'A8 list' }, t1); ok(pl, 201);
  const id = pl.json.playlist_id;
  const a = await call('POST', `/playlists/${id}/songs`, { songId: sugs[0].song_id }, t1); ok(a, 201);
  assert(a.json.position === 1, `position ${a.json.position}`);
  const b = await call('POST', `/playlists/${id}/songs`, { songId: sugs[1].song_id }, t1); ok(b, 201);
  assert(b.json.position === 2, `position ${b.json.position}`);
  ok(await call('POST', `/playlists/${id}/songs`, { songId: sugs[0].song_id }, t1), 409);
  ok(await call('POST', `/playlists/${id}/songs`, { songId: sugs[2].song_id }, t2), 404);   // not user two's playlist
  const g = await call('GET', `/playlists/${id}`, null, t1); ok(g);
  assert(g.json.songs.length === 2 && g.json.songs[0].position === 1, 'songs not listed in order');
  const [sig] = await query("SELECT count(*) AS n FROM implicit_signals WHERE user_id = @u AND signal_type = 'add_to_playlist'", { u: u1 });
  assert(sig.n === 2, `add_to_playlist signals: ${sig.n}`);
  ok(await call('DELETE', `/playlists/${id}/songs/${sugs[0].song_id}`, null, t1));
});
await check('mood journey sad -> energetic: 8 songs, energy rises, bad input gives 400', async () => {
  const r = await call('POST', '/playlists/journey', { from: 'sad', to: 'energetic' }, t1); ok(r, 201);
  const g = await call('GET', `/playlists/${r.json.playlist_id}`, null, t1); ok(g);
  assert(g.json.playlist_type === 'mood_journey', `type ${g.json.playlist_type}`);
  assert(g.json.songs.length === 8, `got ${g.json.songs.length} songs`);
  assert(g.json.songs[0].energy < g.json.songs[7].energy, `energy ${g.json.songs[0].energy} to ${g.json.songs[7].energy}`);
  ok(await call('POST', '/playlists/journey', { from: 'sad', to: 'angry' }, t1), 400);
  ok(await call('POST', '/playlists/journey', { from: 'sad', to: 'calm', region: 'mars' }, t1), 400);
});
await check('mood journey with region "pakistani" only uses Pakistani songs', async () => {
  const r = await call('POST', '/playlists/journey', { from: 'calm', to: 'happy', region: 'pakistani' }, t1); ok(r, 201);
  const g = (await call('GET', `/playlists/${r.json.playlist_id}`, null, t1)).json;
  assert(g.songs.length >= 1 && g.songs.every((s) => s.region === 'pakistani'), 'a non-Pakistani song appeared');
  return `${g.songs.length} songs`;
});

// ---- 6. similar users (second user rates the same song 4 stars)
await check('similarity: two users who rated the same song 5 and 4 get score 0.8', async () => {
  ok(await call('POST', '/ratings', { songId: first.song_id, stars: 4 }, t2), 201);
  const pairs = await withTx((tx) => engine.computeUserSimilarity(tx));
  assert(pairs >= 1, `pairs ${pairs}`);
  const [row] = await query(
    `SELECT similarity_score, common_songs FROM user_similarity
     WHERE (user_id_a = @a AND user_id_b = @b) OR (user_id_a = @b AND user_id_b = @a)`, { a: u1, b: u2 });
  assert(row && near(row.similarity_score, 0.8) && row.common_songs === 1, `row ${JSON.stringify(row)}`);
});
await check('the similar user\'s liked song gets a 0.95 "similar users" score in the next batch', async () => {
  ok(await call('POST', '/suggestions/generate', null, t1), 201);
  const s = (await call('GET', '/suggestions', null, t1)).json.suggestions.find((x) => x.song_id === first.song_id);
  assert(s, 'the song is not in the new batch');
  assert(near(s.similar_users_score, 0.95), `similar_users_score ${s.similar_users_score}`);
  assert(s.reasons.some((r) => r.reason_type === 'similar_users'), 'no similar_users reason');
});

// ---- 7. region preference puts the chosen kind of music first
await check('region "pakistani": the first suggestions are all Pakistani', async () => {
  ok(await call('PUT', '/preferences', { region: 'pakistani' }, t1));
  ok(await call('POST', '/suggestions/generate', null, t1), 201);
  const s = (await call('GET', '/suggestions', null, t1)).json.suggestions;
  const [{ n }] = await query("SELECT count(*) AS n FROM songs s JOIN song_features f ON f.song_id = s.song_id WHERE s.is_active AND s.content_type = 'music' AND s.region = 'pakistani'");
  assert(n >= 1, 'no Pakistani songs in the database');
  assert(s.slice(0, n).every((x) => x.region === 'pakistani'), `first ${n} regions: ${s.slice(0, n).map((x) => x.region).join(', ')}`);
});

// ---- 8. cohort A is taste-only
await check('cohort A: the batch is labelled variant A with taste-only reasons', async () => {
  await query("UPDATE users SET experiment_group = 'A' WHERE user_id = @u", { u: u1 });
  ok(await call('POST', '/suggestions/generate', null, t1), 201);
  const r = (await call('GET', '/suggestions', null, t1)).json;
  assert(r.batch.variant === 'A', `variant ${r.batch.variant}`);
  assert(r.suggestions.some((s) => s.reasons.some((x) => /Cohort A/.test(x.reason_text))), 'no cohort A reason text');
});

// ---- 9. the audit trail recorded the engine's work
await check('audit log has entries for plays, ratings and suggestion batches', async () => {
  const rows = await query("SELECT DISTINCT table_name FROM audit_log WHERE user_id = @u", { u: u1 });
  const names = rows.map((r) => r.table_name);
  for (const t of ['Listening_History', 'Ratings', 'Suggestion_Batches', 'Mood_Scores']) assert(names.includes(t), `no audit rows for ${t}`);
});

await cleanup();
async function cleanup() {
  for (const e of emails) await query('DELETE FROM users WHERE email = @e', { e });
  console.log('\nA8 engine check');
  console.log('---------------');
  for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? '   [' + detail + ']' : ''}`);
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  await closePool();
  process.exit(failed ? 1 : 0);
}
