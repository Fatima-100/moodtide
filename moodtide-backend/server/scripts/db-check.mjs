/* =====================================================================
   A5 check: does the new database layer work?
   Location: moodtide-backend/server/scripts/db-check.mjs
   Run from the server folder:   node scripts/db-check.mjs
   Needs the database container running and 01_schema.sql + 02_seed.sql loaded.
   Prints PASS or FAIL for each check.
   ===================================================================== */
import { query, withTx, toPositional, closePool } from '../src/db.js';

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push(['PASS', name, detail ?? '']);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('connects and answers a query', async () => {
  const [r] = await query('SELECT now() AS t');
  assert(r.t instanceof Date, 'expected a Date');
  return r.t.toISOString();
});

await check('named parameters turn into $1, $2 (and repeat correctly)', async () => {
  const p = toPositional('SELECT @a + @b + @a AS x', { a: 1, b: 2 });
  assert(p.text === 'SELECT $1 + $2 + $1 AS x', `got: ${p.text}`);
  assert(JSON.stringify(p.values) === '[1,2]', `got values: ${JSON.stringify(p.values)}`);
  const [r] = await query('SELECT @n::int + @n::int AS twice', { n: 21 });
  assert(r.twice === 42, `expected 42, got ${r.twice}`);
});

await check('a missing parameter throws a clear error', async () => {
  let threw = false;
  try { await query('SELECT @nope AS x', {}); } catch (e) { threw = /Missing SQL parameter @nope/.test(e.message); }
  assert(threw, 'expected "Missing SQL parameter @nope"');
});

await check('NUMERIC and count(*) come back as numbers, not text', async () => {
  const [r] = await query('SELECT 0.35::numeric(6,3) AS w, count(*) AS n FROM users');
  assert(typeof r.w === 'number', `numeric came back as ${typeof r.w}`);
  assert(typeof r.n === 'number', `count came back as ${typeof r.n}`);
  return `w=${r.w}, users=${r.n}`;
});

await check('seed data is present (2 roles, 3+ users, 8+ genres, 5 weights, 1 experiment)', async () => {
  const [r] = await query(`SELECT (SELECT count(*) FROM roles) AS roles, (SELECT count(*) FROM users) AS users,
    (SELECT count(*) FROM genres) AS genres, (SELECT count(*) FROM scoring_weights) AS weights,
    (SELECT count(*) FROM experiments) AS experiments`);
  const got = `${r.roles},${r.users},${r.genres},${r.weights},${r.experiments}`;
  // users and genres may be higher: sample data and test users add rows
  assert(r.roles === 2 && r.users >= 3 && r.genres >= 8 && r.weights === 5 && r.experiments === 1,
    `expected 2 roles, 3+ users, 8+ genres, 5 weights, 1 experiment but got ${got}`);
  return got;
});

await check('a transaction that throws is rolled back', async () => {
  try {
    await withTx(async (tx) => {
      await query("INSERT INTO genres (genre_id, name) VALUES (@id, @n)", { id: 'gen_a5_test', n: 'A5 test genre' }, tx);
      const [inside] = await query("SELECT count(*) AS c FROM genres WHERE genre_id = @id", { id: 'gen_a5_test' }, tx);
      assert(inside.c === 1, 'row should be visible inside the transaction');
      throw new Error('planned failure');
    });
  } catch (e) {
    if (e.message !== 'planned failure') throw e;
  }
  const [after] = await query("SELECT count(*) AS c FROM genres WHERE genre_id = @id", { id: 'gen_a5_test' });
  assert(after.c === 0, 'the row survived the rollback');
});

await check('a transaction that succeeds is committed', async () => {
  const id = 'gen_a5_commit';
  await withTx((tx) => query("INSERT INTO genres (genre_id, name) VALUES (@id, @n)", { id, n: 'A5 commit test' }, tx));
  const [seen] = await query("SELECT count(*) AS c FROM genres WHERE genre_id = @id", { id });
  await query("DELETE FROM genres WHERE genre_id = @id", { id });   // clean up
  assert(seen.c === 1, 'the committed row was not found');
});

console.log('\nA5 database layer check');
console.log('-----------------------');
for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? '   [' + detail + ']' : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
await closePool();
process.exit(failed ? 1 : 0);
