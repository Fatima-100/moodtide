/* =====================================================================
   A9 check: does the server start safely and answer with safe headers?
   Location: moodtide-backend/server/scripts/config-check.mjs
   Run from the server folder (no need to start the API; it starts its own
   copies on port 4101):      node scripts/config-check.mjs
   Needs the database container running (it registers one temporary user).
   Prints PASS or FAIL for each check.
   ===================================================================== */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { query, closePool } from '../src/db.js';
import { config } from '../src/config.js';   // also proves your own .env passes the checks

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const PORT = '4101';
const BASE = `http://localhost:${PORT}`;
const results = [];
const email = `a9.check.${Date.now()}@example.com`;

async function check(name, fn) {
  try { results.push(['PASS', name, (await fn()) ?? '']); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/** Start the server with some settings changed and wait until it exits (it should refuse to start). */
function runUntilExit(overrides) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env: { ...process.env, PORT, ...overrides } });
    let err = '', out = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve({ code: 'still running', err, out }); }, 8000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, err, out }); });
  });
}

/** Start the server normally and resolve when it prints that it is listening. */
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env: { ...process.env, PORT } });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => { if (String(d).includes('MoodTide API on')) resolve(child); });
    child.on('exit', (code) => reject(new Error(`server exited with code ${code}: ${err.slice(0, 300)}`)));
    setTimeout(() => reject(new Error('server did not start within 10 seconds')), 10000);
  });
}

// ---- 1. refuses to start with unsafe settings
await check('refuses to start without JWT_SECRET', async () => {
  const r = await runUntilExit({ JWT_SECRET: '' });
  assert(r.code === 1, `exit code ${r.code}`);
  assert(r.err.includes('JWT_SECRET is missing'), `message was: ${r.err.slice(0, 200)}`);
});
await check('refuses a short JWT_SECRET', async () => {
  const r = await runUntilExit({ JWT_SECRET: 'too-short' });
  assert(r.code === 1 && r.err.includes('too short'), `code ${r.code}: ${r.err.slice(0, 200)}`);
});
await check('refuses a placeholder JWT_SECRET (including the old built-in default)', async () => {
  for (const s of ['paste-a-long-random-string-here-xxxxxxxx', 'dev-secret-change-me-dev-secret-change-me']) {
    const r = await runUntilExit({ JWT_SECRET: s });
    assert(r.code === 1 && r.err.includes('placeholder'), `"${s.slice(0, 20)}..." code ${r.code}: ${r.err.slice(0, 160)}`);
  }
});
await check('refuses a CLIENT_ORIGIN that is not an address', async () => {
  const r = await runUntilExit({ CLIENT_ORIGIN: 'localhost:5173' });
  assert(r.code === 1 && r.err.includes('CLIENT_ORIGIN'), `code ${r.code}: ${r.err.slice(0, 160)}`);
});

// ---- 2. normal start and the HTTP behaviour
let server = null;
await check('starts normally with your .env', async () => {
  server = await startServer();
  const r = await fetch(`${BASE}/api/health`);
  const j = await r.json();
  assert(r.status === 200 && j.ok === true, `health: ${r.status} ${JSON.stringify(j)}`);
  return `database ${j.db}`;
});

if (server) {
  await check('safe headers: nosniff is set and X-Powered-By is gone', async () => {
    const r = await fetch(`${BASE}/api/health`);
    assert(r.headers.get('x-content-type-options') === 'nosniff', 'x-content-type-options missing');
    assert(!r.headers.get('x-powered-by'), 'x-powered-by is still sent');
  });
  await check('CORS: your own website is allowed, another website is not', async () => {
    const allowed = config.clientOrigins[0];
    const a = await fetch(`${BASE}/api/health`, { headers: { Origin: allowed } });
    assert(a.headers.get('access-control-allow-origin') === allowed, `allowed origin got "${a.headers.get('access-control-allow-origin')}"`);
    const b = await fetch(`${BASE}/api/health`, { headers: { Origin: 'http://evil.example' } });
    assert(!b.headers.get('access-control-allow-origin'), `evil origin got "${b.headers.get('access-control-allow-origin')}"`);
  });
  await check('a very large request body is refused (413)', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'x'.repeat(200_000) }),
    });
    assert(r.status === 413, `expected 413, got ${r.status}`);
  });
  await check('a broken JSON body gets 400, not a crash', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    const h = await fetch(`${BASE}/api/health`);
    assert(h.status === 200, 'server stopped answering after the bad request');
  });
  await check('an unknown API address returns a JSON 404 (when logged in)', async () => {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'A9 Check', email, password: 'a9-check-password' }),
    });
    const { token } = await reg.json();
    assert(token, `register failed: ${reg.status}`);
    const r = await fetch(`${BASE}/api/does-not-exist`, { headers: { Authorization: `Bearer ${token}` } });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    const j = await r.json();
    assert(j.error === 'Not found', `body ${JSON.stringify(j)}`);
  });
  await check('the server stops cleanly when asked', async () => {
    const exited = new Promise((res) => server.on('exit', (code) => res(code)));
    server.kill('SIGINT');
    const code = await Promise.race([exited, new Promise((res) => setTimeout(() => res('timeout'), 5000))]);
    assert(code === 0 || code === null, `exit code ${code}`);   // null on Windows when the process is terminated
  });
  if (server.exitCode === null) server.kill();
}

await query('DELETE FROM users WHERE email = @e', { e: email });
console.log('\nA9 configuration check');
console.log('----------------------');
for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? '   [' + detail + ']' : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
await closePool();
process.exit(failed ? 1 : 0);
