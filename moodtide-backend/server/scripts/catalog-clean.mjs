#!/usr/bin/env node
// =====================================================================
// MoodTide A35: remove duplicates and broken items. Songs are hidden (is_active = false), never deleted.
//
// Run it from moodtide-backend/server:
//   node scripts/catalog-clean.mjs                      (DRY RUN: only lists what would be hidden)
//   node scripts/catalog-clean.mjs --check-youtube      (also ask YouTube if each video still plays; about 30 units)
//   node scripts/catalog-clean.mjs --check-youtube --apply
//   node scripts/catalog-clean.mjs --hide-demo --apply  (also hide the demo sample songs)
//   node scripts/catalog-clean.mjs --sql-out reports/hidden.sql    (write the SQL that hides the same songs on Neon)
//
// Other flags: --region PK   --force (hide even if more than 25 percent of the videos fail)
// Jamendo and Audius stream links are checked by scripts/catalog-report.mjs.
// To bring a song back: UPDATE songs SET is_active = true WHERE song_id = '...';
// =====================================================================
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { query, withTx, runScript } from './lib/db.js';
import { getFlags } from './lib/flags.js';
import { looksLikeOutage } from './lib/linkcheck.js';
import { findDuplicates, hideDuplicates, hideSongs, findUnplayable, activeYouTube, checkVideos, hiddenSql } from './lib/clean.js';

const f = getFlags();
const APPLY = f.has('apply') && !f.dryRun;
const REGION = String(f.opt('region', 'PK')).toUpperCase();
const SQL_OUT = f.opt('sql-out', '');
const KEY = f.opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || '');
const show = (s, extra = '') => console.log(`  ${s.song_id}  [${s.source}]  ${s.artist} - ${s.title}${extra}`);

async function main() {
  console.log(APPLY ? 'Cleaning the catalog (--apply).' : 'Dry run: nothing is changed. Add --apply to hide the songs listed.');

  console.log('\nDuplicates (same artist, title and section)');
  const groups = await findDuplicates();
  for (const g of groups) { show(g.keep, '   KEEP'); for (const s of g.hide) show(s, '   hide'); }
  console.log(`  ${groups.reduce((n, g) => n + g.hide.length, 0)} extra copies`);

  console.log('\nSongs that cannot be played');
  const broken = await findUnplayable();
  if (f.has('check-youtube')) {
    if (!KEY) throw new Error('--check-youtube needs YOUTUBE_API_KEY in .env');
    const videos = await activeYouTube();
    console.log(`  asking YouTube about ${videos.length} videos...`);
    const bad = await checkVideos(videos, { key: KEY, region: REGION });
    if (bad.length && looksLikeOutage(bad.length, videos.length) && !f.has('force')) {
      for (const s of bad.slice(0, 20)) show(s, `   ${s.reason}`);
      console.log(`  NOT hidden: ${bad.length} of ${videos.length} videos failed, which looks wrong. Check, then use --force if you are sure.`);
      process.exitCode = 1;
    } else broken.push(...bad);
  } else console.log('  (YouTube videos not checked: add --check-youtube)');
  for (const s of broken) show(s, `   ${s.reason}`);
  console.log(`  ${broken.length} songs`);

  const demo = f.has('hide-demo') ? await query(`SELECT song_id FROM songs WHERE source = 'demo' AND is_active`) : [];
  if (f.has('hide-demo')) console.log(`\nDemo songs: ${demo.length}`);

  if (APPLY) {
    const hidden = await withTx(async (tx) => {
      // broken songs first, so a broken copy is never the one that is kept
      const a = await hideSongs([...broken.map((s) => s.song_id), ...demo.map((s) => s.song_id)], tx);
      const b = await hideDuplicates(await findDuplicates(tx), tx);
      return [...a, ...b];
    });
    console.log(`\nHid ${hidden.length} songs.`);
    if (hidden.length) {
      const file = `reports/hidden-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      mkdirSync('reports', { recursive: true });
      writeFileSync(file, hidden.join('\n') + '\n');
      console.log(`Their ids are saved in ${file}`);
    }
  }
  if (SQL_OUT) {
    mkdirSync(dirname(SQL_OUT), { recursive: true });
    writeFileSync(SQL_OUT, await hiddenSql());
    console.log(`\nSaved the SQL for the hosted database to ${SQL_OUT}`);
  }
}

runScript(main);
