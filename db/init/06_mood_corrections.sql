/* =====================================================================
   MoodTide mood corrections   (task A22)
   Location: db/init/06_mood_corrections.sql   (runs after 01_schema.sql)

   One row each time a user presses "not my mood": what we had detected, and what they say it really is.
   For 6 hours the engine treats the newest correction like a check-in (see recentMood in src/engine.js).

   Safe to run again. Existing database, in PowerShell from the server folder:
       docker cp ../../db/init/06_mood_corrections.sql moodtide-db:/tmp/06_mood_corrections.sql
       docker exec moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 -f /tmp/06_mood_corrections.sql
   ===================================================================== */

CREATE TABLE IF NOT EXISTS mood_corrections (
    correction_id   text         PRIMARY KEY,
    user_id         text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    score_id        text         REFERENCES mood_scores(score_id) ON DELETE SET NULL,   -- the detection being corrected
    previous_mood   text         CHECK (previous_mood IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    corrected_mood  text         NOT NULL CHECK (corrected_mood IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corrections_user_time ON mood_corrections (user_id, created_at DESC);

-- Check: expected  table mood_corrections
SELECT to_regclass('public.mood_corrections') AS "table";
