// Duplicate detection (task A15). A song is a duplicate when
//   1) the same source already has the same external_id, or
//   2) a song with the same normalised title and the same normalised artist already exists.
// The index is read from the database once per run and updated as songs are added, so a second run
// (or two importers that find the same song) never creates a second row.
import { query } from '../../src/db.js';
import { dupKey, norm, baseKey } from './normalize.js';

export async function loadCatalogIndex(tx = null) {
  const rows = await query(
    `SELECT s.song_id, s.album_id, s.artist_id, s.source, s.external_id, s.content_type, s.title, ar.name AS artist
     FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id`, {}, tx);
  const bySource = new Map(), byName = new Map();
  const add = (row) => {
    if (row.external_id) bySource.set(`${row.source}:${row.external_id}`, row);
    const key = dupKey(row.artist, row.title);
    // a key with an empty title part would match every untitled song: do not index those by name
    if (baseKey(row.title) || norm(row.title)) if (!byName.has(key)) byName.set(key, row);
  };
  rows.forEach(add);
  return {
    size: rows.length,
    add,
    findBySource: (source, externalId) => bySource.get(`${source}:${externalId}`) ?? null,
    findByName: (artist, title) => (baseKey(title) || norm(title)) ? (byName.get(dupKey(artist, title)) ?? null) : null,
  };
}
