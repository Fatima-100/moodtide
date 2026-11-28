/* A35: which search results the top-up importer keeps (no database or network). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPUP_QUERIES, pickVideos } from '../scripts/lib/topup.js';
import { GENRE_IDS, GENRE_ARTISTS } from '../scripts/lib/artists.js';

test('keeps playable single recordings by a known artist, once', () => {
  const video = (id, title, channel = 'Some Channel') => ({ id, title, channel });
  const list = [
    video('a', 'Tajdar e Haram - Sabri Brothers'),
    video('b', 'Sabri Brothers Jukebox Best Of'),
    video('c', 'A Qawwali By Someone Else'),
    video('d', 'Bhar Do Jholi', 'Amjad Sabri'),
    video('e', 'Too Long Sabri Brothers Mehfil'),
    video('a', 'Tajdar e Haram - Sabri Brothers'),
  ];
  const details = new Map(list.map((v) => [v.id, { contentDetails: { duration: v.id === 'e' ? 'PT2H' : 'PT12M' }, status: { embeddable: true } }]));
  const picked = pickVideos(list, details, { artists: GENRE_ARTISTS.qawwali });
  assert.deepEqual(picked.map((p) => p.videoId), ['a', 'd']);
  assert.equal(picked[1].artist, 'Amjad Sabri');
  assert.equal(picked[0].sec, 720);
});

test('every top-up category is a known genre with artists', () => {
  for (const g of Object.keys(TOPUP_QUERIES)) assert.ok(GENRE_IDS[g] && GENRE_ARTISTS[g].length);
});
