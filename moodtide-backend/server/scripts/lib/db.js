// Database access for the importers: the same query() and withTx() as the server (src/db.js), plus two helpers.
import { query, withTx, closePool } from '../../src/db.js';
export { query, withTx, closePool };

/**
 * Make sure a genre row exists and return its id. genres.name is UNIQUE, so if another genre already
 * uses the name, the genre is created with `altName` instead (for example "Qawwali (Islamic)").
 */
export async function ensureGenre(tx, { id, name, altName = `${name} (${id.replace(/^gen_/, '')})` }) {
  const have = await query('SELECT genre_id FROM genres WHERE genre_id = @id', { id }, tx);
  if (have.length) return id;
  const made = await query('INSERT INTO genres (genre_id, name) VALUES (@id, @name) ON CONFLICT DO NOTHING RETURNING genre_id', { id, name }, tx);
  if (!made.length) await query('INSERT INTO genres (genre_id, name) VALUES (@id, @name) ON CONFLICT DO NOTHING', { id, name: altName }, tx);
  return id;
}

/** Run an importer's main(): print a failure, set the exit code, and always close the pool so Node can exit. */
export async function runScript(main) {
  try { await main(); }
  catch (e) { console.error('\nImport failed:', e.message); process.exitCode = 1; }
  finally { await closePool().catch(() => {}); }
}
