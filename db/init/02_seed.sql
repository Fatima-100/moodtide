/* =====================================================================
   MoodTide seed data, PostgreSQL   (task A4)
   Location: db/init/02_seed.sql   (runs automatically after 01_schema.sql)

   Safe to run again: every insert uses ON CONFLICT DO NOTHING.
   Demo accounts (passwords are NOT stored here, only bcrypt hashes):
       admin@moodtide.com    System Admin        role admin, cohort B
       fatima@moodtide.com   Fatima Al-Mansoor   role user,  cohort B
       marcus@moodtide.com   Marcus Vance        role user,  cohort A
   Keep the passwords in a private note. On the PUBLIC deployment (A28)
   change them first: generate a new hash and update the users table.

   To run by hand:
       docker exec -i moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 < db/init/02_seed.sql
   ===================================================================== */

-- 1. Roles
INSERT INTO roles (role_id, role_name) VALUES
  ('rol_1', 'admin'),
  ('rol_2', 'user')
ON CONFLICT DO NOTHING;

-- 2. Users (the admin must exist before scoring_weights: updated_by is a foreign key)
INSERT INTO users (user_id, role_id, username, email, password_hash, experiment_group, created_at) VALUES
  ('usr_admin',  'rol_1', 'System Admin',      'admin@moodtide.com',  '$2b$10$pbu4jEqJaPKvN7YI39Uzo.SCLarcT9vrIAq84dvnqENrwJKiE/YYe',  'B', '2025-01-01T00:00:00Z'),
  ('usr_fatima', 'rol_2', 'Fatima Al-Mansoor', 'fatima@moodtide.com', '$2b$10$20Uq1D9utGwaLyE03mjjyuq8GQiRY2wXIPr5w18MJjbkrNTPzosU6', 'B', '2025-01-05T12:00:00Z'),
  ('usr_marcus', 'rol_2', 'Marcus Vance',      'marcus@moodtide.com', '$2b$10$2I/IVpMXcjlfUODPZWiCP.DpOrQxTeVNRaDWwpmyvtQurnI/e9YvK', 'A', '2025-01-08T09:00:00Z')
ON CONFLICT DO NOTHING;

-- 3. Genres (the Islamic categories and the new Pakistani genres are added later by the importers)
INSERT INTO genres (genre_id, name) VALUES
  ('gen_1', 'Ambient & Drone'),
  ('gen_2', 'Lo-Fi Chillhop'),
  ('gen_3', 'Synthwave & Retrowave'),
  ('gen_4', 'Deep Melodic Techno'),
  ('gen_5', 'Neo-Classical & Cinematic'),
  ('gen_6', 'Indie Folk & Acoustic'),
  ('gen_7', 'Dream Pop'),
  ('gen_8', 'R&B / Soul Glitch')
ON CONFLICT DO NOTHING;

-- 4. Scoring weights (the five numbers the recommendation engine uses)
INSERT INTO scoring_weights (weight_id, weight_name, weight_value, updated_by, updated_at) VALUES
  ('w_1', 'w_taste',   0.35, 'usr_admin', '2025-01-01T00:00:00Z'),
  ('w_2', 'w_mood',    0.30, 'usr_admin', '2025-01-01T00:00:00Z'),
  ('w_3', 'w_similar', 0.15, 'usr_admin', '2025-01-01T00:00:00Z'),
  ('w_4', 'w_fresh',   0.10, 'usr_admin', '2025-01-01T00:00:00Z'),
  ('w_5', 'w_recent',  0.20, 'usr_admin', '2025-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

-- 5. A/B experiment (cohort A = taste only, cohort B = taste + real-time mood)
INSERT INTO experiments (experiment_id, name, description, start_date, end_date, status) VALUES
  ('exp_1', 'Mood Awareness Suggestion Engine v1',
   'A/B testing cohort A (taste-only baseline) vs cohort B (taste + real-time mood-aware scoring).',
   '2025-01-01T00:00:00Z', '2027-12-31T23:59:59Z', 'active')
ON CONFLICT DO NOTHING;

-- 6. Audit trail bootstrap row
INSERT INTO audit_log (log_id, user_id, table_name, record_id, action, old_data, new_data, changed_at) VALUES
  ('aud_1', 'usr_admin', 'Database', 'BOOTSTRAP', 'INSERT', NULL,
   '{"message":"PostgreSQL schema initialized with 25 tables and seed data"}'::jsonb, now())
ON CONFLICT DO NOTHING;

-- Check: expected  roles 2 | users 3 | genres 8 | weights 5 | experiments 1
SELECT (SELECT count(*) FROM roles)           AS roles,
       (SELECT count(*) FROM users)           AS users,
       (SELECT count(*) FROM genres)          AS genres,
       (SELECT count(*) FROM scoring_weights) AS weights,
       (SELECT count(*) FROM experiments)     AS experiments;
