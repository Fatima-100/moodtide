#!/usr/bin/env node
// =====================================================================
// MoodTide: how long does a mood check-in take?   (A21)
// Location: moodtide-backend/server/scripts/diagnose-checkin.mjs
//
// From the server folder:
//   node scripts/diagnose-checkin.mjs                          (fatima@moodtide.com, 20 runs)
//   node scripts/diagnose-checkin.mjs someone@mail.com 50      (another user, 50 runs)
//
// It runs the same engine code as POST /api/checkins and reports the median and 95th percentile,
// plus how many statements go to the database. Every run is rolled back, so nothing is saved
// (the time to COMMIT is therefore not included).
// To measure a hosted database, set DATABASE_URL (and DB_SSL=true if it needs SSL) first.
// =====================================================================
import { query, withTx, closePool } from '../src/db.js';
import { detectMood, generateSuggestions } from '../src/engine.js';
import { audit, newId } from '../src/util.js';

const email = process.argv[2] || 'fatima@moodtide.com';
const runs = Math.max(1, Number(process.argv[3]) || 20);
const TARGET_MS = 700;

const ms = (start) => performance.now() - start;
// nearest-rank percentile
const percentile = (list, p) => [...list].sort((a, b) => a - b)[Math.ceil((p / 100) * list.length) - 1];

async function checkIn(userId) {
  const steps = {};
  let statements = 0;
  const undo = new Error('rollback');
  const started = performance.now();
  try {
    await withTx(async (client) => {
      const tx = { query: (...args) => { statements++; return client.query(...args); } };
      let t = performance.now();
      const id = newId('chk');
      await query('INSERT INTO Mood_Checkins (checkin_id, user_id, mood_label, energy_level) VALUES (@id, @u, @m, @e)',
        { id, u: userId, m: 'calm', e: 3 }, tx);
      await audit(tx, userId, 'Mood_Checkins', id, 'INSERT', null, { mood: 'calm', energy: 3 });
      steps.save = ms(t);
      t = performance.now();
      await detectMood(userId, tx);
      steps.detect = ms(t);
      t = performance.now();
      await generateSuggestions(userId, tx);
      steps.suggest = ms(t);
      throw undo;
    });
  } catch (e) {
    if (e !== undo) throw e;
  }
  return { total: ms(started), statements, ...steps };
}

try {
  const [user] = await query('SELECT user_id FROM users WHERE email = @e', { e: email });
  if (!user) throw new Error(`No user with the email "${email}". Usage: node scripts/diagnose-checkin.mjs <email> [runs]`);

  const pings = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); await query('SELECT 1'); pings.push(ms(t)); }

  await checkIn(user.user_id); // warm-up, not counted
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await checkIn(user.user_id));

  console.log(`Check-in timing for ${email}, ${runs} runs`);
  console.log(`Database round trip (SELECT 1): ${percentile(pings, 50).toFixed(1)} ms`);
  console.log(`Statements per check-in:        ${results[0].statements} (plus BEGIN and ROLLBACK)\n`);
  const table = {};
  for (const [key, label] of [['save', 'save check-in'], ['detect', 'detectMood'], ['suggest', 'generateSuggestions'], ['total', 'TOTAL']]) {
    const values = results.map((r) => r[key]);
    table[label] = { median_ms: Math.round(percentile(values, 50)), p95_ms: Math.round(percentile(values, 95)), max_ms: Math.round(Math.max(...values)) };
  }
  console.table(table);
  const p95 = table.TOTAL.p95_ms;
  console.log(`95th percentile ${p95} ms: ${p95 < TARGET_MS ? 'under' : 'NOT under'} the ${TARGET_MS} ms target.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
