/* =====================================================================
   MoodTide onboarding answers   (task A31)
   Location: db/init/12_onboarding.sql   (name it with a number higher than your other db/init files)

   One row per user: what they chose on the first-run screens. The taste profile and the region
   preference are what the engine actually uses; this row lets the app know onboarding is done
   (GET /api/onboarding) and keeps the answers (listening_times is for later time-of-day tuning).

   Safe to run again. Run it on EVERY database, the same way you ran the other migrations:
   local:  Get-Content db\init\12_onboarding.sql | docker exec -i moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1
   Neon:   psql "<your Neon connection string>" -v ON_ERROR_STOP=1 -f db/init/12_onboarding.sql
   ===================================================================== */

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id          TEXT        PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  languages        TEXT[]      NOT NULL DEFAULT '{}',
  genres           TEXT[]      NOT NULL DEFAULT '{}',
  listening_times  TEXT[]      NOT NULL DEFAULT '{}',
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT to_regclass('public.user_onboarding') AS "table";
