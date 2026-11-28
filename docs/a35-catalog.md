# A35: catalog scale-up to about 1,450 tracks

All commands run in PowerShell from `moodtide-backend/server`, against the **local** database.

## Rules

- `.env` must have `DATABASE_URL` commented out, so imports go to the local database. Neon is updated at the end of a batch.
- YouTube allows 100 searches a day (default). The daily limit resets at midnight Pacific time (13:00 in Pakistan in winter).
  Importers still print "units" at 100 per search: divide by 100 to get searches.
- Search results are cached for 7 days. Re-running the same command with a higher `--per-artist` or `--per-query` costs no new searches.

## Daily plan

| Day | Commands | Searches |
|---|---|---|
| 1 | `node scripts/import-catalog.mjs --genre ghazal,qawwali,sufi,punjabi_folk --per-artist 20`<br>`node scripts/import-catalog.mjs --genre urdu_pop,coke,hiphop --per-artist 20`<br>`node scripts/import-youtube.mjs --no-pakistani --per-genre 20` | about 80 |
| 2 | `node scripts/import-catalog.mjs --genre punjabi_pop,bollywood --per-artist 20`<br>`node scripts/import-catalog.mjs --genre kpop,jpop,lofi --per-artist 20`<br>`node scripts/import-islamic.mjs --per-query 30` | about 90 |
| 3 | Top up only what the targets check shows as SHORT (below) | up to 80 |

## Top-ups

- Thin music category: `node scripts/import-catalog.mjs --genre sufi --per-artist 30 --searches 2`
- Thin Islamic category: `node scripts/import-islamic.mjs --only manqabat --per-query 50`
- Jamendo (no YouTube quota): `node scripts/import-jamendo.mjs --limit 300`, or `--tag sad --limit 150` for a short mood
- Audius: not imported until written permission arrives (task A13).

## After each batch

```powershell
node scripts/enrich-lastfm.mjs
node scripts/catalog-report.mjs --out reports/catalog-latest.txt
node scripts/catalog-clean.mjs --check-youtube
node scripts/catalog-targets.mjs
```

Read the dry-run list from `catalog-clean.mjs`, then run it again with `--apply`.
Once, after real songs are in: `node scripts/catalog-clean.mjs --hide-demo --apply`.

## Evidence for "done"

```powershell
node scripts/catalog-targets.mjs --out ../../docs/a35-catalog-targets.txt
```

Targets checked: 1,450 active tracks (demo songs excluded); at least 60 in each of the 15 categories of the import plan;
no other genre empty; at least 80 music tracks per mood with a mood match above 0.75.

"Category" is read here as those 15. The database has more genres (including extra Islamic ones), and 60 in every
one of them would need more than 1,450 tracks; they only have to be non-empty. Confirm this reading with the instructor.

## Copy to the hosted database

Follow section 3 of `deploy.md`. The data copy only adds new rows, so then hide the same songs on Neon:

```powershell
node scripts/catalog-clean.mjs --sql-out reports/hidden.sql
docker cp reports/hidden.sql moodtide-db:/tmp/hidden.sql
docker exec moodtide-db psql "$NEON" -v ON_ERROR_STOP=1 -f /tmp/hidden.sql
```

Changes to features of songs that were already on Neon are not copied by this method.

Qawwali, sufi kalam and ghazal were topped up with: node scripts/import-topup.mjs --genre qawwali,sufi,ghazal
