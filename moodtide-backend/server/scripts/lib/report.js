// The numbers behind scripts/catalog-report.mjs (task A17): queries, plain-text tables, and the dead-link update.
import { query } from '../../src/db.js';

const LENGTH_ORDER = ['short', 'standard', 'long', '(none)'];

/** Read every count and list for the report. Pass a transaction/client as `tx` to read inside it (tests do). */
export async function collect({ listLimit = 20, tx = null } = {}) {
  const q = (text, params = {}) => query(text, params, tx);
  const one = async (text, params) => (await q(text, params))[0];

  const totals = await one(`SELECT count(*) AS total, count(*) FILTER (WHERE is_active) AS active FROM songs`);
  const bySource = await q(
    `SELECT source, content_type, count(*) AS total, count(*) FILTER (WHERE is_active) AS active
     FROM songs GROUP BY source, content_type ORDER BY count(*) DESC, source`);
  const byRegion = await q(
    `SELECT region, content_type, count(*) AS tracks FROM songs WHERE is_active
     GROUP BY region, content_type ORDER BY count(*) DESC, region`);
  const byLength = (await q(
    `SELECT coalesce(length_class, '(none)') AS length_class, count(*) AS tracks FROM songs WHERE is_active
     GROUP BY coalesce(length_class, '(none)')`)).sort((a, b) => LENGTH_ORDER.indexOf(a.length_class) - LENGTH_ORDER.indexOf(b.length_class));

  // genres: a song counts once in each of its genres; only active songs are counted
  const byGenre = await q(
    `SELECT g.genre_id, g.name, count(s.song_id) AS tracks
     FROM genres g
     LEFT JOIN song_genres sg ON sg.genre_id = g.genre_id
     LEFT JOIN songs s ON s.song_id = sg.song_id AND s.is_active
     GROUP BY g.genre_id, g.name ORDER BY count(s.song_id) DESC, g.name`);
  const noGenre = (await one(
    `SELECT count(*) AS n FROM songs s WHERE s.is_active
       AND NOT EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.song_id)`)).n;

  // features
  const noFeaturesCount = (await one(
    `SELECT count(*) AS n FROM songs s WHERE s.is_active
       AND NOT EXISTS (SELECT 1 FROM song_features f WHERE f.song_id = s.song_id)`)).n;
  const noFeatures = await q(
    `SELECT s.song_id, s.source, s.title, ar.name AS artist
     FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
     WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM song_features f WHERE f.song_id = s.song_id)
     ORDER BY s.source, ar.name, s.title LIMIT @lim`, { lim: listLimit });
  const featureSources = await q(
    `SELECT f.feature_source, count(*) AS tracks FROM song_features f JOIN songs s ON s.song_id = f.song_id
     WHERE s.is_active GROUP BY f.feature_source ORDER BY count(*) DESC`);

  // tags (the song_tags table comes from task A14)
  const tagTable = (await one(`SELECT to_regclass('public.song_tags') IS NOT NULL AS ok`)).ok;
  let tags = { available: false, noTagsCount: 0, noTags: [], threePlus: 0 };
  if (tagTable) {
    tags = {
      available: true,
      noTagsCount: (await one(
        `SELECT count(*) AS n FROM songs s WHERE s.is_active
           AND NOT EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.song_id)`)).n,
      noTags: await q(
        `SELECT s.song_id, s.source, s.title, ar.name AS artist
         FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
         WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM song_tags t WHERE t.song_id = s.song_id)
         ORDER BY s.source, ar.name, s.title LIMIT @lim`, { lim: listLimit }),
      threePlus: (await one(
        `SELECT count(*) AS n FROM songs s WHERE s.is_active
           AND (SELECT count(*) FROM song_tags t WHERE t.song_id = s.song_id) >= 3`)).n,
    };
  }

  // the same artist + title more than once (A15 prevents new ones; this finds old ones)
  const duplicates = await q(
    `SELECT min(ar.name) AS artist, min(s.title) AS title, count(*) AS copies, string_agg(s.song_id, ', ' ORDER BY s.song_id) AS ids
     FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
     WHERE s.is_active GROUP BY lower(ar.name), lower(s.title) HAVING count(*) > 1
     ORDER BY count(*) DESC, min(ar.name) LIMIT @lim`, { lim: listLimit });

  return { totals, bySource, byRegion, byLength, byGenre, noGenre, noFeaturesCount, noFeatures, featureSources, tags, duplicates };
}

/** Active songs that have a stream URL of their own (YouTube songs have none, they play in the embedded player). */
export function streamsToCheck(sources, tx = null) {
  return query(
    `SELECT s.song_id, s.source, s.title, ar.name AS artist, s.audio_url AS url
     FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
     WHERE s.is_active AND s.audio_url IS NOT NULL AND s.source = ANY(@sources)
     ORDER BY s.source, s.song_id`, { sources }, tx);
}

/** Hide songs whose stream is dead. Returns the ids that were switched off. */
export async function markDead(ids, tx = null) {
  if (!ids.length) return [];
  const rows = await query(`UPDATE songs SET is_active = false WHERE song_id = ANY(@ids) AND is_active RETURNING song_id`, { ids }, tx);
  return rows.map((r) => r.song_id);
}

// ---------- plain text output ----------
export function table(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((c) => String(c ?? '')));
  const w = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const line = (r) => '  ' + r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  return [line(cells[0]), '  ' + w.map((n) => '-'.repeat(n)).join('  '), ...cells.slice(1).map(line)].join('\n');
}
export const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : '-');

export function render(d, { minPerGenre = 60, listLimit = 20 } = {}) {
  const out = [];
  const h = (t) => out.push(`\n${t}\n${'='.repeat(t.length)}`);
  const list = (rows, more) => {
    for (const r of rows) out.push(`  ${r.song_id}  [${r.source}]  ${r.artist} - ${r.title}`);
    if (more > rows.length) out.push(`  ... and ${more - rows.length} more`);
  };
  const active = d.totals.active;

  h('Totals');
  out.push(`  ${d.totals.total} songs, ${active} active, ${d.totals.total - active} hidden`);

  h('By source');
  out.push(table(['source', 'section', 'total', 'active'], d.bySource.map((r) => [r.source, r.content_type, r.total, r.active])));

  h('By region (active)');
  out.push(table(['region', 'section', 'tracks'], d.byRegion.map((r) => [r.region, r.content_type, r.tracks])));

  h('By length class (active)');
  out.push(table(['length', 'tracks', 'share'], d.byLength.map((r) => [r.length_class, r.tracks, pct(r.tracks, active)])));

  h(`By genre (active; a song counts in each of its genres; LOW = under ${minPerGenre})`);
  const gRows = (isIslamic) => d.byGenre.filter((g) => g.genre_id.startsWith('gen_isl_') === isIslamic)
    .map((g) => [g.name, g.tracks, g.tracks < minPerGenre ? 'LOW' : '']);
  out.push('  Music genres');
  out.push(table(['genre', 'tracks', ''], gRows(false)));
  out.push('\n  Islamic categories');
  out.push(table(['category', 'tracks', ''], gRows(true)));
  out.push(`\n  Songs with no genre: ${d.noGenre}`);
  out.push(`  Genres under ${minPerGenre} tracks: ${d.byGenre.filter((g) => g.tracks < minPerGenre).length} of ${d.byGenre.length}`);

  h('Features');
  out.push(table(['feature_source', 'tracks'], d.featureSources.map((r) => [r.feature_source, r.tracks])));
  out.push(`\n  Songs with NO features: ${d.noFeaturesCount}`);
  list(d.noFeatures, d.noFeaturesCount);

  h('Tags');
  if (!d.tags.available) out.push('  The song_tags table does not exist yet (task A14).');
  else {
    out.push(`  Songs with 3 or more tags: ${d.tags.threePlus} of ${active} (${pct(d.tags.threePlus, active)}; the A14 goal is 80%)`);
    out.push(`  Songs with NO tags: ${d.tags.noTagsCount}`);
    list(d.tags.noTags, d.tags.noTagsCount);
  }

  h('Possible duplicates (same artist and title)');
  if (!d.duplicates.length) out.push('  none');
  for (const r of d.duplicates) out.push(`  ${r.copies}x  ${r.artist} - ${r.title}   (${r.ids})`);
  return out.join('\n');
}
