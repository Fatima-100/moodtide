/* =====================================================================
   MoodTide event log   (task A18)
   Location: db/init/04_events.sql   (runs after 03_genres.sql)

   Everything the app will later learn from: what was shown, played, skipped, liked...
   Safe to run again (IF NOT EXISTS). On an existing database, in PowerShell from the project root:
       Get-Content db\init\04_events.sql | docker exec -i moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1

   - user_id has a foreign key with ON DELETE CASCADE: deleting a user deletes their events.
   - song_id and suggestion_id have NO foreign key on purpose: an event log is append-only, one unknown id
     must never reject a whole batch, and a song can be removed later without touching the history.
   - position is the rank in the list the song was shown in; value is a number whose meaning depends on the
     event (seconds listened, 1/0 for like...); context holds the rest (screen, source, mood...).
   - To allow a new event type later, replace the CHECK constraint:
       ALTER TABLE events DROP CONSTRAINT events_event_type_check;
       ALTER TABLE events ADD CONSTRAINT events_event_type_check CHECK (event_type IN (...));
   - Storage clean-up at the end of the project, if needed:
       DELETE FROM events WHERE created_at < now() - interval '90 days';
   ===================================================================== */

CREATE TABLE IF NOT EXISTS events (
  event_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id    TEXT,
  event_type    TEXT        NOT NULL,
  song_id       TEXT,
  suggestion_id TEXT,
  "position"    INTEGER,
  "value"       DOUBLE PRECISION,
  context       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT events_event_type_check CHECK (event_type IN
    ('impression', 'play_start', 'play_end', 'skip', 'replay', 'like', 'add_to_playlist', 'share', 'checkin', 'not_my_mood'))
);

CREATE INDEX IF NOT EXISTS idx_events_user_time ON events (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events (event_type);

-- Check: expected  table events | 2 indexes (plus the primary key)
SELECT to_regclass('public.events') AS "table",
       (SELECT count(*) FROM pg_indexes WHERE tablename = 'events' AND indexname IN ('idx_events_user_time', 'idx_events_type')) AS indexes;
