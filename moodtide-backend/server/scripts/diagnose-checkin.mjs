#!/usr/bin/env node
// =====================================================================
// MoodTide: find out which step of a mood check-in is slow or stuck.
//
// Put this file in:  moodtide-backend/server/scripts/diagnose-checkin.mjs
// Run it from:       moodtide-backend/server
//
//   node scripts/diagnose-checkin.mjs            (uses the user "fatima1")
//   node scripts/diagnose-checkin.mjs fatima     (another username)
//
// It runs the same code the app runs (engine.js) and prints how long each step takes.
// Nothing is saved: the check-in steps run inside a transaction that is rolled back.
// =====================================================================
import 'dotenv/config';
import { query, withTx } from '../src/db.js';
import * as engine from '../src/engine.js';

const ROLLBACK = 'ROLLBACK_ON_PURPOSE';

async function timed(label, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`${label.padEnd(40)} ${String(Date.now() - start).padStart(7)} ms   ok`);
    return result;
  } catch (e) {
    if (e.message === ROLLBACK) {
      console.log(`${label.padEnd(40)} ${String(Date.now() - start).padStart(7)} ms   ok (rolled back)`);
      return null;
    }
    console.log(`${label.padEnd(40)} ${String(Date.now() - start).padStart(7)} ms   FAILED: ${e.message}`);
    return null;
  }
}

const username = process.argv[2] || 'fatima1';
console.log(`Timing a check-in for "${username}"\n`);

await timed('connect + SELECT 1', () => query('SELECT 1 AS x'));

const [u] = (await timed('find user', () => query('SELECT user_id FROM Users WHERE username = @n', { n: username }))) || [];
if (!u) {
  console.log(`\nNo user named "${username}". Pass an existing username: node scripts/diagnose-checkin.mjs <username>`);
  process.exit(1);
}
const uid = u.user_id;

console.log('\n-- single queries (what the check-in reads) --');
await timed('login session lookup', () => query(
  `SELECT session_id FROM Auth_Sessions WHERE token_hash = @h AND is_revoked = 0 AND expires_at > SYSUTCDATETIME()`, { h: 'x' }));
await timed('user + cohort + region', () => query('SELECT user_id, experiment_group, region_pref FROM Users WHERE user_id = @u', { u: uid }));
await timed('scoring weights', () => query('SELECT weight_name, weight_value FROM Scoring_Weights'));
await timed('latest mood score', () => query('SELECT TOP 1 * FROM Mood_Scores WHERE user_id = @u ORDER BY calculated_at DESC', { u: uid }));
await timed('listening history', () => query('SELECT song_id FROM Listening_History WHERE user_id = @u ORDER BY played_at DESC', { u: uid }));
await timed('taste profile', () => query('SELECT genre_id, affinity_score FROM User_Taste_Profile WHERE user_id = @u', { u: uid }));
await timed('all music songs with features + genre', () => query(
  `SELECT s.song_id, f.energy, s.region, f.happiness, f.tempo, gx.genre_id, gx.genre_name
   FROM Songs s JOIN Song_Features f ON f.song_id = s.song_id
   OUTER APPLY (SELECT TOP 1 g.genre_id, g.name AS genre_name FROM Song_Genre sg JOIN Genres g ON g.genre_id = sg.genre_id
                WHERE sg.song_id = s.song_id ORDER BY g.genre_id) gx
   WHERE s.is_active = 1 AND s.content_type = 'music'`));

console.log('\n-- the real engine functions (rolled back, nothing saved) --');
await timed('detectMood', () => withTx(async (tx) => {
  await engine.detectMood(uid, tx);
  throw new Error(ROLLBACK);
}));
await timed('generateSuggestions', () => withTx(async (tx) => {
  await engine.generateSuggestions(uid, tx);
  throw new Error(ROLLBACK);
}));
await timed('full check-in (insert + detect + suggest)', () => withTx(async (tx) => {
  await query(
    'INSERT INTO Mood_Checkins (checkin_id, user_id, mood_label, energy_level, checked_at) VALUES (@id, @u, @m, @e, SYSUTCDATETIME())',
    { id: 'chk_diag_' + Date.now(), u: uid, m: 'calm', e: 3 }, tx);
  await engine.detectMood(uid, tx);
  await engine.generateSuggestions(uid, tx);
  throw new Error(ROLLBACK);
}));

console.log('\nDone. Send me this whole output.');
process.exit(0);
