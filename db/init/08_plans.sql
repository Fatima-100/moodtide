/* =====================================================================
   MoodTide plans and usage   (task A24)
   Location: db/init/08_plans.sql   (runs after 01_schema.sql and 02_seed.sql)

   plans           : Free and Premium. price_pkr_mock is a MOCK price in whole rupees: nothing is charged.
   plan_limits     : what each plan allows per DAY, one row per (plan, metric). limit_value NULL = unlimited.
                     Metrics: refreshes, skips, journeys, playlists.
   subscriptions   : which plan a user is on. At most ONE active subscription per user (partial unique index).
   usage_counters  : how many times a user did a metric on a day. Written by task A25 with
                     INSERT ... ON CONFLICT (user_id, day, metric) DO UPDATE SET count = usage_counters.count + 1.
                     "day" is a plain date: A25 decides whose calendar (the user's time zone, users.tz).
   invoices        : mock invoices for the Premium demo. amount_mock is in whole rupees.

   Seeded: Free = 5 refreshes, 10 skips, 2 journeys, 3 playlists per day. Premium = unlimited (explicit NULL rows).
   The Premium price (499) is a placeholder: change it in the plans table if you like.

   New users get a Free subscription in the same transaction as the registration (src/auth.js, src/plans.js).
   Users that already exist when this file runs get one below. Users inserted directly by a test or script
   have none, so the limit check in A25 must treat "no active subscription" as Free.

   Deleting a user deletes their subscriptions, counters and invoices (ON DELETE CASCADE).
   To add a metric later, replace the CHECK on BOTH plan_limits and usage_counters, and add its rows to plan_limits.

   Safe to run again: seed rows are never overwritten (tuned limits survive) and nobody gets a second subscription.
   Existing database, in PowerShell from the server folder:
       docker cp ../../db/init/08_plans.sql moodtide-db:/tmp/08_plans.sql
       docker exec moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 -f /tmp/08_plans.sql
   ===================================================================== */

CREATE TABLE IF NOT EXISTS plans (
    plan_id         text     PRIMARY KEY,
    name            text     NOT NULL UNIQUE,
    price_pkr_mock  integer  NOT NULL DEFAULT 0 CHECK (price_pkr_mock >= 0)
);

CREATE TABLE IF NOT EXISTS plan_limits (
    plan_id      text     NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    metric       text     NOT NULL CHECK (metric IN ('refreshes', 'skips', 'journeys', 'playlists')),
    limit_value  integer  CHECK (limit_value IS NULL OR limit_value >= 0),   -- NULL = unlimited
    PRIMARY KEY (plan_id, metric)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    subscription_id  text         PRIMARY KEY,
    user_id          text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    plan_id          text         NOT NULL REFERENCES plans(plan_id),
    status           text         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
    started_at       timestamptz  NOT NULL DEFAULT now(),
    ends_at          timestamptz,                                              -- NULL = no end date (Free)
    CHECK (ends_at IS NULL OR ends_at > started_at)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);
-- one active subscription per user, so "the user's plan" is never ambiguous
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_one_active ON subscriptions (user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS usage_counters (
    user_id  text     NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    day      date     NOT NULL,
    metric   text     NOT NULL CHECK (metric IN ('refreshes', 'skips', 'journeys', 'playlists')),
    count    integer  NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id, day, metric)
);

CREATE TABLE IF NOT EXISTS invoices (
    invoice_id   text         PRIMARY KEY,
    user_id      text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    amount_mock  integer      NOT NULL CHECK (amount_mock >= 0),
    status       text         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'void')),
    created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_user_time ON invoices (user_id, created_at DESC);

-- Seed: existing rows are left alone, so a limit you tuned by hand survives a second run.
INSERT INTO plans (plan_id, name, price_pkr_mock) VALUES
  ('plan_free',    'Free',    0),
  ('plan_premium', 'Premium', 499)
ON CONFLICT DO NOTHING;

INSERT INTO plan_limits (plan_id, metric, limit_value) VALUES
  ('plan_free',    'refreshes', 5),
  ('plan_free',    'skips',     10),
  ('plan_free',    'journeys',  2),
  ('plan_free',    'playlists', 3),
  ('plan_premium', 'refreshes', NULL),
  ('plan_premium', 'skips',     NULL),
  ('plan_premium', 'journeys',  NULL),
  ('plan_premium', 'playlists', NULL)
ON CONFLICT DO NOTHING;

-- Everyone who already has an account starts on Free (new accounts get theirs at registration).
INSERT INTO subscriptions (subscription_id, user_id, plan_id)
SELECT 'sub_' || substr(md5(u.user_id), 1, 12), u.user_id, 'plan_free'
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.user_id AND s.status = 'active')
ON CONFLICT DO NOTHING;

-- Check: expected  plans 2 | limits 8 | users without an active subscription 0
SELECT (SELECT count(*) FROM plans)        AS plans,
       (SELECT count(*) FROM plan_limits)  AS limits,
       (SELECT count(*) FROM users u WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.user_id AND s.status = 'active')) AS users_without_plan;
