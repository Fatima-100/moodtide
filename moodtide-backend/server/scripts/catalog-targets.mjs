#!/usr/bin/env node
// =====================================================================
// MoodTide A35: does the catalog reach its targets? Reads only, changes nothing.
//
// Run it from moodtide-backend/server:
//   node scripts/catalog-targets.mjs
//   node scripts/catalog-targets.mjs --out ../../docs/a35-catalog-targets.txt
//
// Flags: --total 1450  --per-category 60  --per-mood 80  --min-match 0.75
// "Mood candidate" = an active music track whose mood match (features + tags, as in the suggestion
// engine) is above --min-match. 0.75 is the level at which the engine gives "mood" as a reason.
// Exit code 0 when every target is met, 1 otherwise.
// =====================================================================
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runScript } from './lib/db.js';
import { getFlags } from './lib/flags.js';
import { DEFAULTS, collectTargets, renderTargets } from './lib/targets.js';

const f = getFlags();
const minMatch = Number(f.opt('min-match', DEFAULTS.minMatch));
const OUT = f.opt('out', '');

async function main() {
  const data = await collectTargets({
    total: f.int('total', DEFAULTS.total, 0, 1000000),
    perCategory: f.int('per-category', DEFAULTS.perCategory, 1, 100000),
    perMood: f.int('per-mood', DEFAULTS.perMood, 0, 100000),
    minMatch: Number.isFinite(minMatch) ? minMatch : DEFAULTS.minMatch,
  });
  const text = `MoodTide catalog targets, ${new Date().toISOString().slice(0, 10)}\n\n${renderTargets(data)}`;
  console.log(text);
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text + '\n');
    console.log(`Saved to ${OUT}`);
  }
  if (!data.ok) process.exitCode = 1;
}

runScript(main);
