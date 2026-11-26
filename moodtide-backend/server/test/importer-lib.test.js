/* A15: tests for the pure helpers in scripts/lib (no database needed).
   Location: moodtide-backend/server/test/importer-lib.test.js */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, baseKey, dupKey, hasWords, cleanTitle, parseArtistTitle, isoToSec, interleave } from '../scripts/lib/normalize.js';
import { lengthClass } from '../scripts/lib/length.js';
import { badVideoWords, isBadVideo } from '../scripts/lib/filters.js';
import { getFlags } from '../scripts/lib/flags.js';

describe('normalisation', () => {
  test('accents go, punctuation becomes a space, case is ignored', () => {
    assert.equal(norm('Beyoncé & Jay-Z'), 'beyonce jay z');
    assert.equal(norm('  A.R.  Rahman '), 'a r rahman');
  });
  test('Urdu, Korean and Japanese titles are kept (the old a-z version made them empty)', () => {
    assert.equal(norm('تیرے بِنا'), 'تیرے بنا');
    assert.notEqual(norm('봄날'), '');
    assert.notEqual(norm('夜に駆ける'), '');
  });
  test('baseKey drops "(feat. X)" and "- Remastered"', () => {
    assert.equal(baseKey('Dil Nu (feat. Someone) - Remastered 2011'), 'dil nu');
    assert.equal(dupKey('AP Dhillon', 'Brown Munde'), dupKey('ap  dhillon', 'Brown Munde (Official Video)'));
  });
  test('cleanTitle and parseArtistTitle remove video noise', () => {
    assert.equal(cleanTitle('Tum Hi Ho (Official Video)'), 'Tum Hi Ho');
    assert.deepEqual(parseArtistTitle('Atif Aslam - Doorie [Official Music Video]', 'Atif Aslam VEVO'), { artist: 'Atif Aslam', title: 'Doorie' });
    assert.deepEqual(parseArtistTitle('Doorie', 'Atif Aslam - Topic'), { artist: 'Atif Aslam', title: 'Doorie' });
  });
  test('hasWords matches whole words only', () => {
    assert.ok(hasWords('IU - Love Poem (Official MV)', 'IU'));
    assert.ok(hasWords('BTS (방탄소년단) Dynamite', 'BTS'));
    assert.ok(!hasWords('Liu Jian - Song', 'IU'));
    assert.ok(hasWords('A.R. Rahman Live', 'A. R. Rahman'));
    assert.ok(!hasWords('anything', ''));
  });
  test('isoToSec and interleave', () => {
    assert.equal(isoToSec('PT3M45S'), 225);
    assert.equal(isoToSec('PT1H2M'), 3720);
    assert.deepEqual(interleave([[{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'c' }]]).map((x) => x.id), ['a', 'b', 'c']);
  });
});

describe('length class (A15 rule)', () => {
  test('under 90 s is short, 90 s to 8 minutes is standard, over 8 minutes is long', () => {
    assert.equal(lengthClass(89), 'short');
    assert.equal(lengthClass(90), 'standard');
    assert.equal(lengthClass(480), 'standard');
    assert.equal(lengthClass(481), 'long');
  });
});

describe('bad video filter', () => {
  test('catches tutorials, covers, karaoke and remixes', () => {
    for (const t of ['How to play Tum Hi Ho', 'Tum Hi Ho (Karaoke Version)', 'Tum Hi Ho cover by Sam', 'Tum Hi Ho Remix', 'Best of Arijit Singh']) {
      assert.ok(isBadVideo(t), t);
    }
  });
  test('a normal title passes, and "Discover" is not "cover"', () => {
    assert.ok(!isBadVideo('Arijit Singh - Tum Hi Ho (Official Video)'));
    assert.ok(!isBadVideo('Discover Weekly'));
  });
  test('a word that the real song title contains is ignored', () => {
    assert.deepEqual(badVideoWords('Calvin Harris - Remix (Official Video)', { trackTitle: 'Remix' }), []);
  });
  test('the Islamic list also blocks lofi and slowed loops', () => {
    assert.ok(isBadVideo('Naat Sharif slowed reverb', { profile: 'islamic' }));
    assert.ok(!isBadVideo('Naat Sharif by Owais Raza Qadri', { profile: 'islamic' }));
  });
});

describe('flags', () => {
  test('--dry-run, --opt value and numbers with limits', () => {
    const f = getFlags(['--dry-run', '--only', 'punjabi', '--limit', '9999']);
    assert.equal(f.dryRun, true);
    assert.equal(f.opt('only', ''), 'punjabi');
    assert.equal(f.int('limit', 300, 1, 5000), 5000);
    assert.equal(f.int('missing', 7, 1, 10), 7);
    assert.equal(f.fresh, false);
  });
});
