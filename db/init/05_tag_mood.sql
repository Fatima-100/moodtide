/* =====================================================================
   MoodTide mood from tags   (task A20)
   Location: db/init/05_tag_mood.sql   (runs after 01_schema.sql and 02_seed.sql)

   tag_mood_map says which mood a song tag points to, and how strongly (0 to 1).
   Tags are written the way scripts/enrich-lastfm.mjs stores them (lower case, synonyms merged).
   The five moods describe the MUSIC, like MOOD_COORDINATES in src/engine.js: "stressed" tags are
   the tense, angry kind of music (high energy, low happiness).

   Safe to run again: existing rows are never overwritten, so tuned values survive.
   Existing database. In PowerShell, from the server folder:
       docker cp ../../db/init/05_tag_mood.sql moodtide-db:/tmp/05_tag_mood.sql
       docker exec moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 -f /tmp/05_tag_mood.sql
   ===================================================================== */

CREATE TABLE IF NOT EXISTS tag_mood_map (
    tag     text          NOT NULL CHECK (tag <> '' AND tag = lower(tag)),
    mood    text          NOT NULL CHECK (mood IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    weight  numeric(4,3)  NOT NULL CHECK (weight > 0 AND weight <= 1),
    PRIMARY KEY (tag, mood)
);

INSERT INTO tag_mood_map (tag, mood, weight) VALUES
  -- happy
  ('happy',        'happy', 1.0),
  ('joyful',       'happy', 1.0),
  ('cheerful',     'happy', 1.0),
  ('uplifting',    'happy', 0.9),
  ('feel good',    'happy', 0.9),
  ('fun',          'happy', 0.8),
  ('upbeat',       'happy', 0.8),
  ('positive',     'happy', 0.8),
  ('optimistic',   'happy', 0.8),
  ('summer',       'happy', 0.7),
  ('sunny',        'happy', 0.7),
  ('bhangra',      'happy', 0.7),
  -- calm (devotional music included)
  ('calm',         'calm', 1.0),
  ('chill',        'calm', 0.9),
  ('relaxing',     'calm', 1.0),
  ('peaceful',     'calm', 1.0),
  ('soothing',     'calm', 1.0),
  ('meditation',   'calm', 1.0),
  ('mellow',       'calm', 0.8),
  ('soft',         'calm', 0.7),
  ('ambient',      'calm', 0.8),
  ('lo-fi',        'calm', 0.7),
  ('acoustic',     'calm', 0.5),
  ('sleep',        'calm', 0.8),
  ('devotional',   'calm', 0.9),
  ('spiritual',    'calm', 0.8),
  ('sufi',         'calm', 0.7),
  ('naat',         'calm', 0.9),
  ('nasheed',      'calm', 0.8),
  -- sad
  ('sad',          'sad', 1.0),
  ('melancholic',  'sad', 1.0),
  ('melancholia',  'sad', 1.0),
  ('heartbreak',   'sad', 1.0),
  ('depressive',   'sad', 0.9),
  ('lonely',       'sad', 0.9),
  ('emotional',    'sad', 0.6),
  ('sorrow',       'sad', 1.0),
  ('nostalgic',    'sad', 0.5),
  ('ballad',       'sad', 0.5),
  ('ghazal',       'sad', 0.5),
  ('breakup',      'sad', 0.9),
  -- energetic
  ('energetic',    'energetic', 1.0),
  ('energy',       'energetic', 0.9),
  ('party',        'energetic', 1.0),
  ('dance',        'energetic', 0.9),
  ('club',         'energetic', 0.8),
  ('workout',      'energetic', 1.0),
  ('edm',          'energetic', 0.8),
  ('house',        'energetic', 0.6),
  ('techno',       'energetic', 0.7),
  ('powerful',     'energetic', 0.7),
  ('sport',        'energetic', 0.8),
  ('groovy',       'energetic', 0.5),
  -- stressed (tense or angry music)
  ('angry',        'stressed', 1.0),
  ('aggressive',   'stressed', 1.0),
  ('tense',        'stressed', 1.0),
  ('anxious',      'stressed', 1.0),
  ('dark',         'stressed', 0.6),
  ('intense',      'stressed', 0.7),
  ('metal',        'stressed', 0.6),
  ('hardcore',     'stressed', 0.7),
  ('punk',         'stressed', 0.5),
  ('industrial',   'stressed', 0.6)
ON CONFLICT DO NOTHING;

-- How much the tags count in the mood match: (1 - w_tag) * feature score + w_tag * tag score.
INSERT INTO scoring_weights (weight_id, weight_name, weight_value, updated_by) VALUES
  ('w_6', 'w_tag', 0.40, 'usr_admin')
ON CONFLICT DO NOTHING;

-- Check: expected  about 63 tags over 5 moods, and w_tag = 0.400 on a first run
SELECT count(DISTINCT tag) AS tags, count(DISTINCT mood) AS moods,
       (SELECT weight_value FROM scoring_weights WHERE weight_name = 'w_tag') AS w_tag
FROM tag_mood_map;
