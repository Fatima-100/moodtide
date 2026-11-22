/* MoodTide seed data (SQL Server). Safe to re-run: every insert skips rows that already exist.
   Demo logins:  admin@moodtide.com / admin123   fatima@moodtide.com / user123   marcus@moodtide.com / user123 */
USE MoodTide;
GO

-- 1. Roles
INSERT INTO Roles (role_id, role_name)
SELECT v.role_id, v.role_name
FROM (VALUES ('rol_1','admin'), ('rol_2','user')) AS v(role_id, role_name)
WHERE NOT EXISTS (SELECT 1 FROM Roles r WHERE r.role_id = v.role_id);

-- 2. Users (admin must exist before Scoring_Weights because of the updated_by foreign key)
INSERT INTO Users (user_id, role_id, username, email, password_hash, experiment_group, created_at)
SELECT v.user_id, v.role_id, v.username, v.email, v.password_hash, v.experiment_group, v.created_at
FROM (VALUES
  ('usr_admin',  'rol_1', 'System Admin',      'admin@moodtide.com',  '$2a$10$I6D4Lld7NTBmbRkgS3WrKufNFUCrlWNoTz4DuMwzJytgGGZ7jJfgK', 'B', '2025-01-01T00:00:00'),
  ('usr_fatima', 'rol_2', 'Fatima Al-Mansoor', 'fatima@moodtide.com', '$2a$10$zV6pGao.ZCZvQ1SiLwHUFOhNw0Em6mi4VAJbN.YWhfs4F0tvh/Jn.', 'B', '2025-01-05T12:00:00'),
  ('usr_marcus', 'rol_2', 'Marcus Vance',      'marcus@moodtide.com', '$2a$10$zV6pGao.ZCZvQ1SiLwHUFOhNw0Em6mi4VAJbN.YWhfs4F0tvh/Jn.', 'A', '2025-01-08T09:00:00')
) AS v(user_id, role_id, username, email, password_hash, experiment_group, created_at)
WHERE NOT EXISTS (SELECT 1 FROM Users u WHERE u.user_id = v.user_id);

-- 3. Genres
INSERT INTO Genres (genre_id, name)
SELECT v.genre_id, v.name
FROM (VALUES
  ('gen_1','Ambient & Drone'), ('gen_2','Lo-Fi Chillhop'), ('gen_3','Synthwave & Retrowave'),
  ('gen_4','Deep Melodic Techno'), ('gen_5','Neo-Classical & Cinematic'), ('gen_6','Indie Folk & Acoustic'),
  ('gen_7','Dream Pop'), ('gen_8','R&B / Soul Glitch')
) AS v(genre_id, name)
WHERE NOT EXISTS (SELECT 1 FROM Genres g WHERE g.genre_id = v.genre_id);

-- 4. Scoring weights
INSERT INTO Scoring_Weights (weight_id, weight_name, weight_value, updated_by, updated_at)
SELECT v.weight_id, v.weight_name, v.weight_value, 'usr_admin', '2025-01-01T00:00:00'
FROM (VALUES
  ('w_1','w_taste',0.35), ('w_2','w_mood',0.30), ('w_3','w_similar',0.15),
  ('w_4','w_fresh',0.10), ('w_5','w_recent',0.20)
) AS v(weight_id, weight_name, weight_value)
WHERE NOT EXISTS (SELECT 1 FROM Scoring_Weights w WHERE w.weight_id = v.weight_id);

-- 5. A/B experiment
INSERT INTO Experiments (experiment_id, name, description, start_date, end_date, status)
SELECT 'exp_1', 'Mood Awareness Suggestion Engine v1',
       'A/B testing cohort A (taste-only baseline) vs cohort B (taste + real-time mood-aware scoring).',
       '2025-01-01T00:00:00', '2026-12-31T23:59:59', 'active'
WHERE NOT EXISTS (SELECT 1 FROM Experiments WHERE experiment_id = 'exp_1');

-- 6. Audit trail bootstrap row
INSERT INTO Audit_Log (log_id, user_id, table_name, record_id, action, old_data, new_data, changed_at)
SELECT 'aud_1', 'usr_admin', 'Database', 'BOOTSTRAP', 'INSERT', NULL,
       '{"message":"SQL Server schema initialized with 25 tables and seed data"}', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM Audit_Log WHERE log_id = 'aud_1');
GO

SELECT (SELECT COUNT(*) FROM Roles) AS roles, (SELECT COUNT(*) FROM Users) AS users,
       (SELECT COUNT(*) FROM Genres) AS genres, (SELECT COUNT(*) FROM Scoring_Weights) AS weights,
       (SELECT COUNT(*) FROM Experiments) AS experiments;
-- expected: 2, 3, 8, 5, 1
