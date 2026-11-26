/* =====================================================================
   MoodTide DEV SAMPLE DATA (task A7 testing only)
   Location: db/dev/dev_sample_data.sql   (NOT in db/init, so it never loads by itself)
   Fake artists and songs so the catalog endpoints, suggestions and playlists can be tested.
   Every id starts with dev_ . They have no audio, so the player uses its tone fallback.
   Safe to run again. Remove before importing the real catalog: see the bottom of this file.

   Load it:
     docker cp db\dev\dev_sample_data.sql moodtide-db:/tmp/dev_sample_data.sql
     docker exec moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 -f /tmp/dev_sample_data.sql
   ===================================================================== */

INSERT INTO artists (artist_id, name, country, source) VALUES
  ('dev_ar_1', 'Sample Artist One', 'Pakistan', 'demo'),
  ('dev_ar_2', 'Sample Artist Two', 'Pakistan', 'demo'),
  ('dev_ar_3', 'Sample Artist Three', 'India', 'demo'),
  ('dev_ar_4', 'Sample Artist Four', 'South Korea', 'demo'),
  ('dev_ar_5', 'Sample Artist Five', 'United States', 'demo'),
  ('dev_ar_6', 'Sample Reciter', 'Pakistan', 'demo'),
  ('dev_ar_7', 'Sample Artist Seven', 'Japan', 'demo')
ON CONFLICT DO NOTHING;

INSERT INTO albums (album_id, artist_id, title, release_year, source) VALUES
  ('dev_al_1', 'dev_ar_1', 'Sample Album One', 2021, 'demo'),
  ('dev_al_2', 'dev_ar_2', 'Sample Album Two', 2018, 'demo'),
  ('dev_al_3', 'dev_ar_5', 'Sample Album Three', 2023, 'demo')
ON CONFLICT DO NOTHING;

INSERT INTO genres (genre_id, name) VALUES
  ('gen_ghazal', 'Ghazal'),
  ('gen_qawwali', 'Qawwali'),
  ('gen_punjabi_folk', 'Punjabi Folk'),
  ('gen_isl_naat', 'Naat'),
  ('gen_isl_hamd', 'Hamd')
ON CONFLICT DO NOTHING;

INSERT INTO songs (song_id, artist_id, album_id, title, duration_sec, release_year, popularity, source, content_type, region, length_class) VALUES
  ('dev_s_01', 'dev_ar_1', 'dev_al_1', 'Sample Calm Morning', 210, 2021, 70, 'demo', 'music', 'pakistani', 'standard'),
  ('dev_s_02', 'dev_ar_2', 'dev_al_2', 'Sample Evening Ghazal', 300, 2018, 65, 'demo', 'music', 'pakistani', 'standard'),
  ('dev_s_03', 'dev_ar_2', NULL, 'Sample Qawwali Night', 620, 2016, 80, 'demo', 'music', 'pakistani', 'long'),
  ('dev_s_04', 'dev_ar_1', NULL, 'Sample Punjabi Beat', 190, 2022, 90, 'demo', 'music', 'punjabi', 'standard'),
  ('dev_s_05', 'dev_ar_3', NULL, 'Sample Bollywood Dance', 240, 2019, 85, 'demo', 'music', 'indian', 'standard'),
  ('dev_s_06', 'dev_ar_4', NULL, 'Sample K-Pop Energy', 200, 2023, 88, 'demo', 'music', 'korean', 'standard'),
  ('dev_s_07', 'dev_ar_5', 'dev_al_3', 'Sample Lo-Fi Study', 180, 2023, 75, 'demo', 'music', 'international', 'standard'),
  ('dev_s_08', 'dev_ar_5', 'dev_al_3', 'Sample Synth Drive', 230, 2020, 72, 'demo', 'music', 'international', 'standard'),
  ('dev_s_09', 'dev_ar_5', NULL, 'Sample Sad Piano', 260, 2017, 60, 'demo', 'music', 'international', 'standard'),
  ('dev_s_10', 'dev_ar_6', NULL, 'Sample Naat One', 330, 2015, 78, 'demo', 'islamic', 'pakistani', 'standard'),
  ('dev_s_11', 'dev_ar_6', NULL, 'Sample Hamd One', 280, 2014, 70, 'demo', 'islamic', 'pakistani', 'standard'),
  ('dev_s_12', 'dev_ar_5', NULL, 'Sample Indie Folk', 215, 2019, 66, 'demo', 'music', 'international', 'standard'),
  ('dev_s_13', 'dev_ar_7', NULL, 'Sample J-Pop Chill', 205, 2021, 68, 'demo', 'music', 'japanese', 'standard'),
  ('dev_s_14', 'dev_ar_1', NULL, 'Sample Short Clip', 75, 2024, 50, 'demo', 'music', 'pakistani', 'short')
ON CONFLICT DO NOTHING;

INSERT INTO song_genres (song_id, genre_id) VALUES
  ('dev_s_01', 'gen_1'),
  ('dev_s_02', 'gen_ghazal'),
  ('dev_s_03', 'gen_qawwali'),
  ('dev_s_04', 'gen_punjabi_folk'),
  ('dev_s_05', 'gen_3'),
  ('dev_s_06', 'gen_7'),
  ('dev_s_07', 'gen_2'),
  ('dev_s_08', 'gen_3'),
  ('dev_s_09', 'gen_5'),
  ('dev_s_10', 'gen_isl_naat'),
  ('dev_s_11', 'gen_isl_hamd'),
  ('dev_s_12', 'gen_6'),
  ('dev_s_13', 'gen_7'),
  ('dev_s_14', 'gen_2')
ON CONFLICT DO NOTHING;

INSERT INTO song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source) VALUES
  ('dev_s_01', 0.25, 0.6, 70, 0.3, 0.8, 'demo'),
  ('dev_s_02', 0.3, 0.45, 72, 0.25, 0.85, 'demo'),
  ('dev_s_03', 0.85, 0.75, 130, 0.55, 0.6, 'demo'),
  ('dev_s_04', 0.9, 0.85, 128, 0.85, 0.3, 'demo'),
  ('dev_s_05', 0.88, 0.8, 125, 0.9, 0.2, 'demo'),
  ('dev_s_06', 0.82, 0.78, 118, 0.88, 0.15, 'demo'),
  ('dev_s_07', 0.28, 0.55, 78, 0.45, 0.55, 'demo'),
  ('dev_s_08', 0.8, 0.65, 120, 0.7, 0.1, 'demo'),
  ('dev_s_09', 0.15, 0.15, 62, 0.15, 0.95, 'demo'),
  ('dev_s_10', 0.22, 0.6, 68, 0.2, 0.85, 'demo'),
  ('dev_s_11', 0.24, 0.62, 70, 0.2, 0.85, 'demo'),
  ('dev_s_12', 0.4, 0.55, 95, 0.4, 0.9, 'demo'),
  ('dev_s_13', 0.45, 0.7, 100, 0.55, 0.35, 'demo'),
  ('dev_s_14', 0.35, 0.5, 85, 0.4, 0.6, 'demo')
ON CONFLICT DO NOTHING;

SELECT (SELECT count(*) FROM songs WHERE song_id LIKE 'dev\_%') AS dev_songs,
       (SELECT count(*) FROM artists WHERE artist_id LIKE 'dev\_%') AS dev_artists;   -- expect 14 and 7

/* ---- REMOVE THE SAMPLE DATA (run before the real import) ----
   Deleting songs, albums and artists removes their features and genre links by cascade.
   DELETE FROM songs   WHERE song_id   LIKE 'dev\_%';
   DELETE FROM albums  WHERE album_id  LIKE 'dev\_%';
   DELETE FROM artists WHERE artist_id LIKE 'dev\_%';
   DELETE FROM genres  WHERE genre_id IN ('gen_ghazal','gen_qawwali','gen_punjabi_folk','gen_isl_naat','gen_isl_hamd');
   (Keep the last line only if the importers create their own genres.)
*/
