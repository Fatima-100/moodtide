#!/usr/bin/env node
// =====================================================================
// MoodTide A17: catalog quality report. Run it every Friday and paste the output into the weekly review.
//
// Put this file in:  moodtide-backend/server/scripts/catalog-report.mjs
// Run it from:       moodtide-backend/server
//
//   node scripts/catalog-report.mjs                     (report + check stream links + hide dead ones)
//   node scripts/catalog-report.mjs --dry-run           (report + check links, but change nothing)
//   node scripts/catalog-report.mjs --no-check          (report only, no link check: fast)
//   node scripts/catalog-report.mjs --out reports/catalog-2026-12-04.txt    (also save the text to a file)
//
// Other flags: --list 20       how many songs to list under "no features" / "no tags" (default 20)
//              --min-genre 60  a genre with fewer active tracks is marked LOW (default 60)
//              --sources jamendo,audius   whose stream URLs to check (default jamendo,audius)
//              --concurrency 6 --timeout 12000   link check speed (parallel requests, milliseconds)
//              --force         hide dead links even if a large share failed (see below)
//
// WHAT IT DOES
//   1. Prints counts by source, region, length class and genre, songs with no features or no tags,
//      and songs saved twice.
//   2. Sends a HEAD request (GET for the first byte if HEAD is refused) to the stream URL of every active
//      Jamendo and Audius song. YouTube songs have no stream URL: they play in the embedded player.
//      Demo songs and creator uploads are not checked.
//   3. Songs whose link is dead (404, 410, 401, 403, a web page instead of audio, host not found) get
//      is_active = false. Busy or slow answers (429, 5xx, time-outs) are "unverified": nothing happens to them.
//
// SAFETY: if more than 25 percent of at least 10 checked links fail, the source is probably down (or you are
// offline), so nothing is hidden. Run it again later, or use --force if you are sure.
// A hidden song stays hidden: this script never switches songs back on. To bring one back, set is_active
// to true in the database (or fix its URL with the importer and then set it).
// =====================================================================
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runScript } from './lib/db.js';
import { getFlags } from './lib/flags.js';
import { collect, render, streamsToCheck, markDead, table } from './lib/report.js';
import { checkAll, looksLikeOutage } from './lib/linkcheck.js';

const f = getFlags();
const DRY_RUN = f.dryRun, NO_CHECK = f.has('no-check'), FORCE = f.has('force');
const LIST = f.int('list', 20, 1, 500);
const MIN_GENRE = f.int('min-genre', 60, 0, 100000);
const CONCURRENCY = f.int('concurrency', 6, 1, 20);
const TIMEOUT = f.int('timeout', 12000, 1000, 60000);
const SOURCES = String(f.opt('sources', 'jamendo,audius')).split(',').map((s) => s.trim()).filter(Boolean);
const OUT = f.opt('out', '');

const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };

async function main() {
  const started = Date.now();
  say(`MoodTide catalog report, ${new Date().toISOString().slice(0, 10)}${DRY_RUN ? '  (dry run: nothing is changed)' : ''}`);

  const data = await collect({ listLimit: LIST });
  say(render(data, { minPerGenre: MIN_GENRE, listLimit: LIST }));

  say('\nStream links\n============');
  if (NO_CHECK) say('  skipped (--no-check)');
  else {
    const streams = await streamsToCheck(SOURCES);
    say(`  ${streams.length} active songs with a stream URL from: ${SOURCES.join(', ')}`);
    if (streams.length) {
      process.stdout.write('  checking ');
      const results = await checkAll(streams, {
        concurrency: CONCURRENCY, timeoutMs: TIMEOUT,
        onProgress: (n, total) => { if (n % 25 === 0 || n === total) process.stdout.write(`${n}/${total} `); },
      });
      process.stdout.write('\n');
      const ok = results.filter((r) => r.state === 'ok');
      const dead = results.filter((r) => r.state === 'dead');
      const unverified = results.filter((r) => r.state === 'unverified');
      say(`  ok ${ok.length}   dead ${dead.length}   unverified ${unverified.length}`);

      const bySource = {};
      for (const r of results) (bySource[r.source] ??= { ok: 0, dead: 0, unverified: 0 })[r.state]++;
      say(table(['source', 'ok', 'dead', 'unverified'], Object.entries(bySource).map(([s, c]) => [s, c.ok, c.dead, c.unverified])));

      if (dead.length) {
        say('\n  Dead links:');
        for (const r of dead.slice(0, 100)) say(`  ${r.song_id}  [${r.source}]  ${r.artist} - ${r.title}   ${r.reason}`);
        if (dead.length > 100) say(`  ... and ${dead.length - 100} more`);
      }
      if (unverified.length) {
        say('\n  Unverified (busy or slow, left as they are):');
        for (const r of unverified.slice(0, 20)) say(`  ${r.song_id}  [${r.source}]  ${r.artist} - ${r.title}   ${r.reason}`);
        if (unverified.length > 20) say(`  ... and ${unverified.length - 20} more`);
      }

      if (dead.length && looksLikeOutage(dead.length, results.length) && !FORCE) {
        say(`\n  NOT hidden: ${dead.length} of ${results.length} links failed, which looks like an outage at the source (or no internet). Run again later, or use --force.`);
        process.exitCode = 1;
      } else if (dead.length && DRY_RUN) {
        say(`\n  Dry run: would hide ${dead.length} songs.`);
      } else if (dead.length) {
        const hidden = await markDead(dead.map((r) => r.song_id));
        say(`\n  Hid ${hidden.length} songs (is_active = false).`);
      } else {
        say('\n  No dead links.');
      }
    }
  }

  say(`\nReport finished in ${Math.round((Date.now() - started) / 1000)} s.`);
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, lines.join('\n') + '\n');
    console.log(`Saved to ${OUT}`);
  }
}

runScript(main);
