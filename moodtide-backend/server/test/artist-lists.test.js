/* A16: the artist lists and the genre SQL agree (no database needed).
   Location: moodtide-backend/server/test/artist-lists.test.js */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARTISTS, GENRE_ARTISTS, GENRE_IDS, REGIONS } from '../scripts/lib/artists.js';
import { norm } from '../scripts/lib/normalize.js';

const initDir = new URL('../../../db/init/', import.meta.url);   // moodtide-backend/server/test -> repo root
const sql = readFileSync(new URL('02_seed.sql', initDir), 'utf8') + readFileSync(new URL('03_genres.sql', initDir), 'utf8');

describe('genres', () => {
  test('every genre id used by the artist lists exists in 02_seed.sql or 03_genres.sql', () => {
    for (const [key, id] of Object.entries(GENRE_IDS)) assert.ok(sql.includes(`'${id}'`), `${key} -> ${id} is not in the SQL`);
  });
  test('every artist list has a genre id, and every genre id has artists', () => {
    for (const key of Object.keys(GENRE_ARTISTS)) assert.ok(GENRE_IDS[key], `no genre id for ${key}`);
    for (const key of Object.keys(GENRE_IDS)) assert.ok(GENRE_ARTISTS[key]?.length > 0, `no artists for ${key}`);
  });
  test('03_genres.sql has the 15 genres of the task book (lo-fi is gen_2 from the seed)', () => {
    const wanted = ['Ghazal', 'Qawwali', 'Sufi Kalam', 'Naat', 'Hamd', 'Manqabat', 'Nasheed', 'Punjabi Folk', 'Urdu Pop',
      'Coke Studio Style', 'Bollywood', 'K-Pop', 'J-Pop', 'Hip-Hop'];
    for (const name of wanted) assert.ok(sql.includes(`'${name}'`), `${name} missing`);
    assert.ok(sql.includes("'Lo-Fi Chillhop'"));
    assert.ok(sql.split('ON CONFLICT DO NOTHING').length - 1 >= 2, 'inserts must be safe to run twice');
  });
});

describe('artist lists', () => {
  test('regions are allowed by the songs table', () => {
    for (const [name, region] of ARTISTS) assert.ok(REGIONS.includes(region), `${name}: ${region}`);
  });
  test('no artist is listed twice (it would cost the YouTube quota twice)', () => {
    const seen = new Map();
    for (const [name, , , genre] of ARTISTS) {
      const k = norm(name);
      assert.ok(!seen.has(k), `${name} is in both ${seen.get(k)} and ${genre}`);
      seen.set(k, genre);
    }
  });
  test('about 100 to 130 artists in all, so the full list fits a 6 day plan', () => {
    assert.ok(ARTISTS.length >= 100 && ARTISTS.length <= 130, `${ARTISTS.length} artists`);
  });
});
