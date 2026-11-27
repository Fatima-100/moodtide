/* =====================================================================
   MoodTide genres for Pakistani listeners   (task A16)
   Location: db/init/03_genres.sql   (runs after 01_schema.sql and 02_seed.sql)

   Safe to run again: every insert uses ON CONFLICT DO NOTHING.
   Already in the seed (02_seed.sql): 8 genres, including gen_2 "Lo-Fi Chillhop", which covers lo-fi.

   Music genres show in the main genre list. Islamic categories have ids that start with gen_isl_
   (the API splits the two lists on that prefix), and are used by import-islamic.mjs.

   Existing database (the init scripts only run on a new one). In PowerShell, from the project root:
       Get-Content db\init\03_genres.sql | docker exec -i moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1
   ===================================================================== */

-- 1. Music genres
INSERT INTO genres (genre_id, name) VALUES
  ('gen_ghazal',       'Ghazal'),
  ('gen_qawwali',      'Qawwali'),
  ('gen_sufi_kalam',   'Sufi Kalam'),
  ('gen_punjabi_folk', 'Punjabi Folk'),
  ('gen_punjabi_pop',  'Punjabi Pop'),
  ('gen_urdu_pop',     'Urdu Pop'),
  ('gen_coke_studio',  'Coke Studio Style'),
  ('gen_bollywood',    'Bollywood'),
  ('gen_kpop',         'K-Pop'),
  ('gen_jpop',         'J-Pop'),
  ('gen_hiphop',       'Hip-Hop')
ON CONFLICT DO NOTHING;

-- 2. Islamic categories (the Islamic section of the app)
INSERT INTO genres (genre_id, name) VALUES
  ('gen_isl_naat',     'Naat'),
  ('gen_isl_hamd',     'Hamd'),
  ('gen_isl_qasida',   'Qasida'),
  ('gen_isl_darood',   'Darood'),
  ('gen_isl_kalam',    'Kalam'),
  ('gen_isl_manqabat', 'Manqabat'),
  ('gen_isl_nasheed',  'Nasheed'),
  ('gen_isl_qawwali',  'Devotional Qawwali')
ON CONFLICT DO NOTHING;

-- Check: expected  music 19 (8 from the seed + 11 here) | islamic 8
SELECT count(*) FILTER (WHERE left(genre_id, 8) <> 'gen_isl_') AS music,
       count(*) FILTER (WHERE left(genre_id, 8) =  'gen_isl_') AS islamic
FROM genres;
