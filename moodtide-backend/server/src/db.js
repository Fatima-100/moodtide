import 'dotenv/config';
import sql from 'mssql';

const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'MoodTide',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeout: 15000,
  requestTimeout: 60000, // was 15000 (the default). A blocked query now waits longer, and is logged below.
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise;
export const getPool = () => (poolPromise ??= new sql.ConnectionPool(config).connect());

const short = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 220);

/** Run one query. Pass a transaction as 3rd arg to run inside it. Returns the rows. */
export async function query(text, params = {}, tx = null) {
  const started = Date.now();
  try {
    const req = tx ? new sql.Request(tx) : (await getPool()).request();
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    const result = await req.query(text);
    const ms = Date.now() - started;
    if (ms > 3000) console.warn(`[slow query ${ms}ms${tx ? ', inside transaction' : ''}] ${short(text)}`);
    return result.recordset ?? [];
  } catch (err) {
    const ms = Date.now() - started;
    if (err.code === 'ETIMEOUT' || ms > 3000) {
      console.error(`[query failed after ${ms}ms${tx ? ', inside transaction' : ''}: ${err.code || err.message}] ${short(text)}`);
    }
    throw err;
  }
}

/** Atomic transaction: commits if fn resolves, rolls back if it throws. */
export async function withTx(fn) {
  const tx = new sql.Transaction(await getPool());
  await tx.begin();
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export { sql };