/* =====================================================================
   MoodTide track reports and tester feedback   (task A23)
   Location: db/init/07_reports_feedback.sql   (runs after 01_schema.sql)

   track_reports   : "report this track" button. One row per report, status starts as 'open' so an
                     admin screen can triage them later.
   tester_feedback : the feedback form during the pilot (which page, 1-5 stars, free text).

   - Deleting a user deletes their reports and feedback (ON DELETE CASCADE), like the event log.
   - Deleting a song deletes the reports about it.
   - The same user cannot have two OPEN reports with the same reason on the same song (a double click
     must not fill the admin queue). A closed report does not block a new one.
   - To allow a new reason later, replace the CHECK constraint:
       ALTER TABLE track_reports DROP CONSTRAINT track_reports_reason_check;
       ALTER TABLE track_reports ADD CONSTRAINT track_reports_reason_check CHECK (reason IN (...));
     and add the same word to REPORT_REASONS in src/routes.js.

   Safe to run again. Existing database, in PowerShell from the server folder:
       docker cp ../../db/init/07_reports_feedback.sql moodtide-db:/tmp/07_reports_feedback.sql
       docker exec moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 -f /tmp/07_reports_feedback.sql
   ===================================================================== */

CREATE TABLE IF NOT EXISTS track_reports (
    report_id   text         PRIMARY KEY,
    song_id     text         NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
    user_id     text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    reason      text         NOT NULL
                CONSTRAINT track_reports_reason_check
                CHECK (reason IN ('cannot_play', 'wrong_info', 'copyright', 'inappropriate', 'duplicate', 'other')),
    note        text         CHECK (note IS NULL OR char_length(note) <= 500),
    status      text         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_track_reports_song   ON track_reports (song_id);
CREATE INDEX IF NOT EXISTS idx_track_reports_status ON track_reports (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_track_reports_open
    ON track_reports (user_id, song_id, reason) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS tester_feedback (
    feedback_id  text         PRIMARY KEY,
    user_id      text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    page         text         NOT NULL CHECK (page <> '' AND char_length(page) <= 100),   -- where the tester was, e.g. 'home'
    rating       smallint     NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback_text text        CHECK (feedback_text IS NULL OR char_length(feedback_text) <= 2000),
    created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tester_feedback_time ON tester_feedback (created_at DESC);

-- Check: expected  track_reports | tester_feedback
SELECT to_regclass('public.track_reports') AS track_reports, to_regclass('public.tester_feedback') AS tester_feedback;
