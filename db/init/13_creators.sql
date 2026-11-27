/* =====================================================================
   MoodTide creators and uploads   (task A32)
   Location: db/init/13_creators.sql   (runs after 01_schema.sql and 02_seed.sql)

   A user becomes a creator once. Every upload keeps the licence and the exact consent text the creator
   accepted. New uploads are 'pending'; an admin approves or rejects them (A34).

   Safe to run again. Run it on EVERY database (local and Neon) BEFORE deploying the code.
   Local, in PowerShell from the server folder:
       docker cp ../../db/init/13_creators.sql moodtide-db:/tmp/13_creators.sql
       docker exec moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 -f /tmp/13_creators.sql
   ===================================================================== */

CREATE TABLE IF NOT EXISTS creators (
    creator_id    text         PRIMARY KEY,
    user_id       text         NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    display_name  text         NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
    bio           text         NOT NULL DEFAULT '' CHECK (char_length(bio) <= 1000),
    created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uploads (
    upload_id         text         PRIMARY KEY,
    creator_id        text         NOT NULL REFERENCES creators(creator_id) ON DELETE CASCADE,
    title             text         NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    genre_id          text         NOT NULL REFERENCES genres(genre_id),
    license           text         NOT NULL CHECK (license IN ('CC0', 'CC BY', 'CC BY-SA', 'CC BY-NC', 'CC BY-NC-SA')),
    consent_text      text         NOT NULL CHECK (consent_text <> ''),
    consent_at        timestamptz  NOT NULL DEFAULT now(),
    status            text         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason  text,
    file_key          text         NOT NULL UNIQUE,       -- where the audio goes in storage (A33)
    created_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uploads_rejected_has_reason CHECK (status <> 'rejected' OR COALESCE(rejection_reason, '') <> '')
);
CREATE INDEX IF NOT EXISTS idx_uploads_creator_time ON uploads (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploads_status_time  ON uploads (status, created_at);

-- Check: expected  creators | uploads
SELECT to_regclass('public.creators') AS creators, to_regclass('public.uploads') AS uploads;
