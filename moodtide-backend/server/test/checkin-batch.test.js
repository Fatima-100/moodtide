/* A21: suggestions and reasons are saved with one INSERT each. Needs the database and some songs.
   Runs inside a transaction that is rolled back, so nothing is left in your database.
   Location: moodtide-backend/server/test/checkin-batch.test.js */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withTx, closePool } from '../src/db.js';
import { generateSuggestions } from '../src/engine.js';

after(closePool);

test('generateSuggestions saves all rows with one INSERT per table', async () => {
  const userId = `a21_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const rollback = new Error('rollback');
  await assert.rejects(() => withTx(async (client) => {
    const sent = [];
    const tx = { query: (text, values) => { sent.push(text); return client.query(text, values); } };
    await query(`INSERT INTO users (user_id, role_id, username, email, password_hash, experiment_group)
                 VALUES (@u, 'rol_2', 'A21 test', @e, 'not-a-real-hash', 'B')`, { u: userId, e: `${userId}@example.com` }, tx);
    const batchId = await generateSuggestions(userId, tx);

    const inserts = (table) => sent.filter((t) => new RegExp(`INSERT INTO ${table}\\b`, 'i').test(t)).length;
    assert.equal(inserts('Suggestions'), 1);
    assert.equal(inserts('Suggestion_Reasons'), 1);

    const saved = await query(
      `SELECT suggestion_id, rank_position, total_score, outcome FROM suggestions
       WHERE batch_id = @b ORDER BY rank_position`, { b: batchId }, tx);
    assert.ok(saved.length > 0 && saved.length <= 20, 'no songs: load db/dev/dev_sample_data.sql');
    assert.deepEqual(saved.map((s) => s.rank_position), saved.map((_, i) => i + 1));
    assert.ok(saved.every((s) => s.outcome === 'pending' && typeof s.total_score === 'number'));

    // every reason belongs to the right suggestion and keeps its text
    const reasons = await query(
      `SELECT r.reason_id, r.suggestion_id, r.reason_text FROM suggestion_reasons r
       JOIN suggestions s ON s.suggestion_id = r.suggestion_id WHERE s.batch_id = @b`, { b: batchId }, tx);
    assert.ok(reasons.length > 0, 'a new user should get at least the freshness reason');
    assert.ok(reasons.every((r) => r.reason_id.startsWith(`rsn_${r.suggestion_id}_`) && r.reason_text.length > 0));
    throw rollback;
  }), (e) => e === rollback);
});
