import 'dotenv/config';
import pg from 'pg';

/* =====================================================================
   MoodTide database layer for PostgreSQL (task A5)
   Replaces the SQL Server version. The callers do not change:
       query(text, params, tx)   run one query, returns the rows
       withTx(fn)                atomic transaction, fn receives tx
   Queries still use named parameters (@name); they are turned into
   $1, $2, ... here. That lets us port the SQL itself route by route
   (tasks A6 to A8) without touching every call at the same time.
   ===================================================================== */

// pg returns NUMERIC and BIGINT (for example count(*)) as strings by default.
// The engine does arithmetic on them, so parse them into JavaScript numbers.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // NUMERIC
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));       // BIGINT

/** Connection settings: DATABASE_URL if present (hosted), otherwise the DB_* variables (local). */
function buildConfig() {
  const common = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000, // a blocked query waits up to 60 s, and is logged below
    // Hosted databases usually need SSL. Set DB_SSL=true there (finished in task A28).
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
  if (process.env.DATABASE_URL) return { ...common, connectionString: process.env.DATABASE_URL };
  return {
    ...common,
    host: process.env.DB_SERVER || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'moodtide',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

export const pool = new pg.Pool(buildConfig());
// An idle connection can drop (for example when the database restarts). Log it, do not crash.
pool.on('error', (err) => console.error('[database] idle connection error:', err.message));

/** Kept so older code that asks for the pool still works. */
export const getPool = () => pool;

const short = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 220);

/**
 * Turn "SELECT * FROM users WHERE user_id = @u AND x = @u" and { u: 5 }
 * into { text: "... = $1 AND x = $1", values: [5] }.
 * A parameter missing from the object is a programming error, so it throws.
 * undefined becomes NULL.
 */
export function toPositional(text, params = {}) {
  const names = [];
  const out = text.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`Missing SQL parameter @${name}`);
    }
    let i = names.indexOf(name);
    if (i === -1) { names.push(name); i = names.length - 1; }
    return `$${i + 1}`;
  });
  return { text: out, values: names.map((n) => (params[n] === undefined ? null : params[n])) };
}

/** Run one query. Pass a transaction as 3rd arg to run inside it. Returns the rows. */
export async function query(text, params = {}, tx = null) {
  const started = Date.now();
  try {
    const q = toPositional(text, params);
    const result = await (tx || pool).query(q.text, q.values);
    const ms = Date.now() - started;
    if (ms > 3000) console.warn(`[slow query ${ms}ms${tx ? ', inside transaction' : ''}] ${short(text)}`);
    return result.rows ?? [];
  } catch (err) {
    const ms = Date.now() - started;
    if (err.code === '57014' || ms > 3000) { // 57014 = statement timeout
      console.error(`[query failed after ${ms}ms${tx ? ', inside transaction' : ''}: ${err.code || err.message}] ${short(text)}`);
    }
    throw err;
  }
}

/** Atomic transaction: commits if fn resolves, rolls back if it throws. */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Close all connections (used by scripts and tests so Node can exit). */
export const closePool = () => pool.end();
