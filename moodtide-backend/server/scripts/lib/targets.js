// Task A35: the catalog targets, and the queries behind scripts/catalog-targets.mjs.
// Demo songs and hidden songs never count.
import { query } from '../../src/db.js';
import { MOOD_COORDINATES, tagScores, moodMatch } from '../../src/engine.js';

export const DEFAULTS = { total: 1450, perCategory: 60, perMood: 80, minMatch: 0.75 };

// The 15 categories collected by the A16 import plan. Every other genre only has to be non-empty.
export const CORE_CATEGORIES = [
  'gen_ghazal', 'gen_qawwali', 'gen_sufi_kalam', 'gen_isl_naat', 'gen_isl_hamd', 'gen_isl_manqabat', 'gen_isl_nasheed',
  'gen_punjabi_folk', 'gen_urdu_pop', 'gen_coke_studio', 'gen_bollywood', 'gen_kpop', 'gen_jpop', 'gen_hiphop', 'gen_2',
];

/** Count tracks, categories and mood candidates. Pass a client as `tx` to read inside a transaction (tests do). */
export async function collectTargets({ total = DEFAULTS.total, perCategory = DEFAULTS.perCategory,
  perMood = DEFAULTS.perMood, minMatch = DEFAULTS.minMatch, tx = null } = {}) {
  const [{ n: tracks }] = await query(`SELECT count(*)::int AS n FROM songs WHERE is_active AND source <> 'demo'`, {}, tx);
  const bySource = await query(
    `SELECT source, count(*)::int AS tracks FROM songs WHERE is_active AND source <> 'demo'
     GROUP BY source ORDER BY count(*) DESC, source`, {}, tx);

  const genres = await query(
    `SELECT g.genre_id, g.name, count(s.song_id)::int AS tracks
     FROM genres g
     LEFT JOIN song_genres sg ON sg.genre_id = g.genre_id
     LEFT JOIN songs s ON s.song_id = sg.song_id AND s.is_active AND s.source <> 'demo'
     GROUP BY g.genre_id, g.name ORDER BY g.name`, {}, tx);
  const categories = genres.map((g) => {
    const core = CORE_CATEGORIES.includes(g.genre_id);
    const need = core ? perCategory : 1;
    return { ...g, core, need, ok: g.tracks >= need };
  });
  const missing = CORE_CATEGORIES.filter((id) => !genres.some((g) => g.genre_id === id));
  for (const id of missing) categories.push({ genre_id: id, name: `${id} (not in the database)`, tracks: 0, core: true, need: perCategory, ok: false });

  // mood candidates: the same match the suggestion engine uses (features blended with tags, music only)
  const [w] = await query(`SELECT weight_value FROM scoring_weights WHERE weight_name = 'w_tag'`, {}, tx);
  const wTag = Math.min(1, Math.max(0, Number(w?.weight_value ?? 0.4)));
  const songs = await query(
    `SELECT s.song_id, f.energy::float8 AS energy, f.happiness::float8 AS happiness
     FROM songs s JOIN song_features f ON f.song_id = s.song_id
     WHERE s.is_active AND s.source <> 'demo' AND s.content_type = 'music'`, {}, tx);
  const moods = [];
  for (const [mood, target] of Object.entries(MOOD_COORDINATES)) {
    const tags = await tagScores(mood, tx);
    const n = songs.filter((s) => moodMatch(s, target, tags.get(s.song_id), wTag) > minMatch).length;
    moods.push({ mood, candidates: n, need: perMood, ok: n >= perMood });
  }

  const totalOk = tracks >= total;
  return { tracks, total, totalOk, bySource, categories, moods, minMatch,
    ok: totalOk && categories.every((c) => c.ok) && moods.every((m) => m.ok) };
}

export function renderTargets(d) {
  const mark = (ok) => (ok ? 'ok' : 'SHORT');
  const line = (name, have, need, ok) => `  ${name.padEnd(34)} ${String(have).padStart(5)} / ${String(need).padEnd(5)} ${mark(ok)}`;
  const out = ['Tracks (active, without demo songs)', line('all tracks', d.tracks, d.total, d.totalOk)];
  for (const s of d.bySource) out.push(`    ${s.source}: ${s.tracks}`);
  out.push('', 'Categories collected by the import plan');
  for (const c of d.categories.filter((x) => x.core)) out.push(line(`${c.name}${c.genre_id.startsWith('gen_isl_') ? ' (Islamic)' : ''}`, c.tracks, c.need, c.ok));
  out.push('', 'Other genres (must not be empty)');
  for (const c of d.categories.filter((x) => !x.core)) out.push(line(`${c.name}${c.genre_id.startsWith('gen_isl_') ? ' (Islamic)' : ''}`, c.tracks, c.need, c.ok));
  out.push('', `Mood candidates (music tracks with a mood match above ${d.minMatch})`);
  for (const m of d.moods) out.push(line(m.mood, m.candidates, m.need, m.ok));
  const short = (d.totalOk ? 0 : 1) + d.categories.filter((c) => !c.ok).length + d.moods.filter((m) => !m.ok).length;
  out.push('', d.ok ? 'RESULT: all targets met.' : `RESULT: ${short} target(s) not met yet.`);
  return out.join('\n');
}
