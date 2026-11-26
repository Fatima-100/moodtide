// ONE function that saves a song for every importer (task A15): artist, album, song, features, genres.
//
//   const index = await loadCatalogIndex(tx);              // once per run
//   const r = await saveSong(tx, index, record, opts);     // once per song
//   r.action is 'inserted', 'updated', 'duplicate' or 'skipped'
//
// Rules:
//   - Same source + external_id already saved  -> the row is UPDATED (a second run changes nothing but fresh data).
//   - Same normalised artist + title, other id -> 'duplicate' (nothing is written), unless opts.onNameMatch is
//     'enrich' AND the existing song comes from the same source: then year, region, cover and genres are filled in.
//   - The row is in the other section (music vs islamic) -> 'skipped'. An Islamic item never turns into music.
//   - is_active is never changed on an update, so a song an admin took down stays down.
//   - length_class is always set from the duration (short / standard / long).
//   - Measured features (feature_source 'measured') are never overwritten by estimates.
import { query } from '../../src/db.js';
import { lengthClass } from './length.js';
import { norm } from './normalize.js';
import { md5 } from './util.js';

const PREFIX = { youtube: 'yt', jamendo: 'jam', audius: 'aud' };   // song yt_ID, artist yta_KEY, album ytb_ID

/**
 * record = {
 *   source, externalId,                                  required ('youtube' | 'jamendo' | 'audius')
 *   title, durationSec,                                  required
 *   artist: { name, externalId?, country? },             externalId defaults to a hash of the name
 *   album:  { title?, externalId?, cover? },             defaults: the song's own one-song album
 *   year, audioUrl, popularity, contentType ('music'), region ('international'),
 *   license, attribution, sourceUrl, externalUrl,
 *   features: { energy, happiness, tempo, danceability, acousticness }, featureSource ('estimated'),
 *   genreIds: []
 * }
 */
export async function saveSong(tx, index, rec, { onNameMatch = 'skip' } = {}) {
  const p = PREFIX[rec.source];
  if (!p) throw new Error(`saveSong: unknown source "${rec.source}"`);
  if (!rec.externalId || !String(rec.title ?? '').trim() || !String(rec.artist?.name ?? '').trim() || !(rec.durationSec > 0)) {
    return { action: 'skipped', reason: 'missing id, title, artist or duration' };
  }
  const contentType = rec.contentType ?? 'music';
  const region = rec.region ?? 'international';
  const ext = String(rec.externalId);
  const len = lengthClass(rec.durationSec);

  // ----- duplicate detection -----
  const sameSource = index.findBySource(rec.source, ext);
  const byName = sameSource ? null : index.findByName(rec.artist.name, rec.title);
  const known = sameSource || byName;
  if (known && known.content_type !== contentType) return { action: 'skipped', songId: known.song_id, reason: 'other section' };
  const enrich = !!byName && onNameMatch === 'enrich' && byName.source === rec.source;
  if (byName && !enrich) return { action: 'duplicate', songId: byName.song_id };

  let songId, action;
  if (enrich) {
    // the same song is already saved under another video id: fill in what we know, keep its row
    songId = byName.song_id;
    await query(`UPDATE songs SET release_year = COALESCE(@year, release_year), region = @region WHERE song_id = @id`,
      { id: songId, year: rec.year ?? null, region }, tx);
    if (byName.album_id) {
      await query(`UPDATE albums SET release_year = COALESCE(@year, release_year), cover_url = COALESCE(@cover, cover_url) WHERE album_id = @id`,
        { id: byName.album_id, year: rec.year ?? null, cover: rec.album?.cover ?? null }, tx);
    }
    action = 'updated';
  } else {
    // ----- artist (unique on source + external_id) -----
    const artistExt = String(rec.artist.externalId ?? md5(norm(rec.artist.name)).slice(0, 12));
    const [artist] = await query(
      `INSERT INTO artists (artist_id, name, country, source, external_id)
       VALUES (@id, @name, @country, @source, @ext)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, country = COALESCE(EXCLUDED.country, artists.country)
       RETURNING artist_id`,
      { id: `${p}a_${artistExt}`, name: rec.artist.name, country: rec.artist.country ?? null, source: rec.source, ext: artistExt }, tx);

    // ----- album (a single has no album, so it gets its own album row: that is where the cover lives) -----
    const albumExt = String(rec.album?.externalId ?? ext);
    const [album] = await query(
      `INSERT INTO albums (album_id, artist_id, title, release_year, cover_url, source, external_id)
       VALUES (@id, @artist, @title, @year, @cover, @source, @ext)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET title = EXCLUDED.title,
                     release_year = COALESCE(EXCLUDED.release_year, albums.release_year),
                     cover_url = COALESCE(EXCLUDED.cover_url, albums.cover_url)
       RETURNING album_id`,
      { id: `${p}b_${albumExt}`, artist: artist.artist_id, title: rec.album?.title || rec.title, year: rec.year ?? null,
        cover: rec.album?.cover ?? null, source: rec.source, ext: albumExt }, tx);

    // ----- song (unique on source + external_id) -----
    const [song] = await query(
      `INSERT INTO songs (song_id, artist_id, album_id, title, duration_sec, release_year, audio_url, popularity,
                          is_active, source, external_id, external_url, content_type, region,
                          license, attribution_text, source_url, length_class)
       VALUES (@id, @artist, @album, @title, @dur, @year, @audio, @pop,
               true, @source, @ext, @link, @ctype, @region,
               @license, @attr, @src, @len)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET title = EXCLUDED.title, duration_sec = EXCLUDED.duration_sec,
                     release_year = COALESCE(EXCLUDED.release_year, songs.release_year),
                     audio_url = COALESCE(EXCLUDED.audio_url, songs.audio_url),
                     popularity = EXCLUDED.popularity, region = EXCLUDED.region,
                     external_url = COALESCE(EXCLUDED.external_url, songs.external_url),
                     license = COALESCE(EXCLUDED.license, songs.license),
                     attribution_text = COALESCE(EXCLUDED.attribution_text, songs.attribution_text),
                     source_url = COALESCE(EXCLUDED.source_url, songs.source_url),
                     length_class = EXCLUDED.length_class
       RETURNING song_id, (xmax = 0) AS inserted`,
      { id: `${p}_${ext}`, artist: artist.artist_id, album: album.album_id, title: rec.title, dur: rec.durationSec,
        year: rec.year ?? null, audio: rec.audioUrl ?? null, pop: rec.popularity ?? 50, source: rec.source, ext,
        link: rec.externalUrl ?? null, ctype: contentType, region, license: rec.license ?? null,
        attr: rec.attribution ?? null, src: rec.sourceUrl ?? null, len }, tx);
    songId = song.song_id;
    action = song.inserted ? 'inserted' : 'updated';
    if (song.inserted) {
      index.add({ song_id: songId, album_id: album.album_id, artist_id: artist.artist_id, source: rec.source,
        external_id: ext, content_type: contentType, title: rec.title, artist: rec.artist.name });
    }
  }

  // ----- features: never overwrite values that were measured later (A21) -----
  if (rec.features) {
    const f = rec.features;
    await query(
      `INSERT INTO song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source)
       VALUES (@id, @e, @h, @t, @d, @a, @fs)
       ON CONFLICT (song_id) DO UPDATE
         SET energy = EXCLUDED.energy, happiness = EXCLUDED.happiness, tempo = EXCLUDED.tempo,
             danceability = EXCLUDED.danceability, acousticness = EXCLUDED.acousticness, feature_source = EXCLUDED.feature_source
         WHERE song_features.feature_source IN ('tags', 'estimated')`,
      { id: songId, e: f.energy, h: f.happiness, t: f.tempo, d: f.danceability, a: f.acousticness, fs: rec.featureSource ?? 'estimated' }, tx);
  }

  // ----- genres (a second run adds nothing) -----
  for (const gid of new Set(rec.genreIds ?? [])) {
    await query('INSERT INTO song_genres (song_id, genre_id) VALUES (@s, @g) ON CONFLICT DO NOTHING', { s: songId, g: gid }, tx);
  }
  return { action, songId };
}
