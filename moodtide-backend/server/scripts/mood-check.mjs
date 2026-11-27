/* A20: print the top 10 suggestions for a sad and an energetic check-in, using YOUR catalog.
   Runs in a transaction that is rolled back, so nothing is saved.
   From the server folder:   node scripts/mood-check.mjs */
import { query, withTx, closePool } from '../src/db.js';
import { detectMood, generateSuggestions, tagScores } from '../src/engine.js';

const lists = {};
const undo = new Error('rollback');
try {
  await withTx(async (tx) => {
    for (const [mood, energy] of [['sad', 2], ['energetic', 5]]) {
      const u = `moodcheck_${mood}_${Date.now()}`;
      await query(`INSERT INTO users (user_id, role_id, username, email, password_hash, experiment_group)
                   VALUES (@u, 'rol_2', 'mood check', @e, 'x', 'B')`, { u, e: `${u}@example.com` }, tx);
      await query('INSERT INTO mood_checkins (checkin_id, user_id, mood_label, energy_level) VALUES (@u, @u, @m, @e)', { u, m: mood, e: energy }, tx);
      await detectMood(u, tx);
      const batch = await generateSuggestions(u, tx);
      const rows = await query(
        `SELECT s.song_id, s.title, sg.mood_match_score, f.energy, f.happiness
         FROM suggestions sg JOIN songs s ON s.song_id = sg.song_id JOIN song_features f ON f.song_id = s.song_id
         WHERE sg.batch_id = @b ORDER BY sg.rank_position LIMIT 10`, { b: batch }, tx);
      const tags = await tagScores(mood, tx);
      lists[mood] = rows;
      console.log(`\nTop ${rows.length} for ${mood.toUpperCase()}   (${tags.size} songs in the catalog have mood tags)`);
      console.table(rows.map((r) => ({ title: r.title.slice(0, 40), mood_match: r.mood_match_score, energy: r.energy,
        happiness: r.happiness, tag_score: tags.has(r.song_id) ? Number(tags.get(r.song_id).toFixed(2)) : '-' })));
    }
    throw undo;
  });
} catch (e) {
  if (e !== undo) throw e;
  const sad = new Set(lists.sad.map((r) => r.song_id));
  console.log(`Songs in both top lists: ${lists.energetic.filter((r) => sad.has(r.song_id)).length}`);
} finally {
  await closePool();
}
