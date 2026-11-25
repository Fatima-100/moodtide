/* =====================================================================
   MoodTide: PostgreSQL schema, 25 tables   (task A3)
   Location: db/init/01_schema.sql

   HOW IT RUNS
   The postgres container runs every file in db/init the FIRST time its
   data volume is created, in alphabetical order. To re-run from scratch:
       docker compose down -v
       docker compose up -d db
   To run by hand:
       docker exec -i moodtide-db psql -U moodtide -d moodtide -v ON_ERROR_STOP=1 < db/init/01_schema.sql

   WHAT CHANGED FROM THE SQL SERVER VERSION (db/legacy-sqlserver/01_schema.sql)
   - NVARCHAR(n)            -> text         (ids stay text, e.g. 'usr_admin')
   - DATETIME2 / SYSUTCDATETIME() -> timestamptz / now()   (stored in UTC)
   - BIT                    -> boolean      (use true / false, not 1 / 0)
   - NVARCHAR(MAX)+ISJSON   -> jsonb
   - DECIMAL                -> numeric
   - email uniqueness       -> unique index on lower(email) (Postgres text
                               is case-sensitive; SQL Server was not)
   - filtered indexes       -> partial indexes (same idea)
   - the "NO ACTION" cascade workarounds are gone: Postgres allows several
     cascade paths, so the original ON DELETE rules are restored and
     usp_DeleteUser is no longer needed. Delete a user with a plain
     DELETE FROM users WHERE user_id = ...
   - no dbo. prefix and no Song_Genre view: the table is song_genres and
     the code must be changed to use that name (tasks A7 and A8)

   NEW COLUMNS (not in the old schema file, but already used by the code
   or needed by later tasks)
   - songs.content_type, songs.region, users.region_pref   (used by engine.js and routes.js)
   - users.tz                                              (A19, user time zone)
   - songs.license, attribution_text, source_url           (A12 and A13, legal credits)
   - songs.length_class, songs.clip_start_sec              (A15 and A29, short/standard/long, clips)
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. MUSIC CATALOG
   --------------------------------------------------------------------- */
CREATE TABLE artists (
    artist_id    text         PRIMARY KEY,
    name         text         NOT NULL,
    country      text,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    source       text         NOT NULL DEFAULT 'demo',
    external_id  text                                   -- artist id at the source (YouTube channel, Jamendo, Audius)
);

CREATE TABLE albums (
    album_id      text         PRIMARY KEY,
    artist_id     text         NOT NULL REFERENCES artists(artist_id) ON DELETE CASCADE,
    title         text         NOT NULL,
    release_year  integer      CHECK (release_year BETWEEN 1900 AND 2100),
    cover_url     text,
    source        text         NOT NULL DEFAULT 'demo',
    external_id   text
);

CREATE TABLE genres (
    genre_id  text  PRIMARY KEY,
    name      text  NOT NULL UNIQUE
);

CREATE TABLE songs (
    song_id          text         PRIMARY KEY,
    artist_id        text         NOT NULL REFERENCES artists(artist_id) ON DELETE CASCADE,
    album_id         text         REFERENCES albums(album_id) ON DELETE SET NULL,
    title            text         NOT NULL,
    duration_sec     integer      NOT NULL CHECK (duration_sec > 0),
    release_year     integer      CHECK (release_year BETWEEN 1900 AND 2100),
    audio_url        text,                              -- direct stream URL (Jamendo, Audius, uploads); NULL for YouTube
    popularity       integer      NOT NULL DEFAULT 50 CHECK (popularity BETWEEN 0 AND 100),
    is_active        boolean      NOT NULL DEFAULT true,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    source           text         NOT NULL DEFAULT 'demo',   -- demo, youtube, jamendo, audius, creator
    external_id      text,                              -- the track or video id at the source
    external_url     text,                              -- link back to the song page
    content_type     text         NOT NULL DEFAULT 'music'
                     CHECK (content_type IN ('music', 'islamic')),
    region           text         NOT NULL DEFAULT 'international'
                     CHECK (region IN ('pakistani', 'punjabi', 'indian', 'korean', 'japanese', 'international')),
    license          text,                              -- e.g. a Creative Commons licence name
    attribution_text text,                              -- credit line shown in the player
    source_url       text,                              -- page to link the credit to
    length_class     text         CHECK (length_class IN ('short', 'standard', 'long')),
    clip_start_sec   integer      CHECK (clip_start_sec >= 0)
);

CREATE TABLE song_genres (
    song_id   text  NOT NULL REFERENCES songs(song_id)   ON DELETE CASCADE,
    genre_id  text  NOT NULL REFERENCES genres(genre_id) ON DELETE CASCADE,
    PRIMARY KEY (song_id, genre_id)
);

CREATE TABLE song_features (
    song_id         text         PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
    energy          numeric(4,3) NOT NULL CHECK (energy       BETWEEN 0 AND 1),
    happiness       numeric(4,3) NOT NULL CHECK (happiness    BETWEEN 0 AND 1),
    tempo           integer      NOT NULL CHECK (tempo        BETWEEN 40 AND 220),
    danceability    numeric(4,3) NOT NULL CHECK (danceability BETWEEN 0 AND 1),
    acousticness    numeric(4,3) NOT NULL CHECK (acousticness BETWEEN 0 AND 1),
    feature_source  text         NOT NULL DEFAULT 'estimated'   -- 'estimated', 'tags', 'measured', 'demo'
);

/* ---------------------------------------------------------------------
   2. USERS & AUTH
   --------------------------------------------------------------------- */
CREATE TABLE roles (
    role_id    text  PRIMARY KEY,
    role_name  text  NOT NULL UNIQUE CHECK (role_name IN ('user', 'admin'))
);

CREATE TABLE users (
    user_id           text         PRIMARY KEY,
    role_id           text         NOT NULL REFERENCES roles(role_id),
    username          text         NOT NULL,
    email             text         NOT NULL,
    password_hash     text         NOT NULL,            -- bcrypt hash made by the backend
    experiment_group  char(1)      NOT NULL DEFAULT 'A' CHECK (experiment_group IN ('A', 'B')),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    last_login        timestamptz,
    region_pref       text         NOT NULL DEFAULT 'all'
                      CHECK (region_pref IN ('all', 'pakistani', 'punjabi', 'asian', 'indian', 'korean', 'japanese', 'international')),
    tz                text         NOT NULL DEFAULT 'Asia/Karachi'   -- IANA time zone name
);

CREATE TABLE auth_sessions (
    session_id   text         PRIMARY KEY,
    user_id      text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash   text         NOT NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    expires_at   timestamptz  NOT NULL,
    is_revoked   boolean      NOT NULL DEFAULT false,
    CHECK (expires_at > created_at)
);

CREATE TABLE playlists (
    playlist_id    text         PRIMARY KEY,
    user_id        text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name           text         NOT NULL,
    description    text         NOT NULL DEFAULT '',
    playlist_type  text         NOT NULL DEFAULT 'normal' CHECK (playlist_type IN ('normal', 'mood_journey')),
    start_mood     text         CHECK (start_mood  IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    target_mood    text         CHECK (target_mood IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE playlist_songs (
    playlist_id  text         NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,
    song_id      text         NOT NULL REFERENCES songs(song_id)         ON DELETE CASCADE,
    "position"   integer      NOT NULL CHECK ("position" >= 0),
    added_at     timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, song_id)                  -- a song can only be in a playlist once
);

/* ---------------------------------------------------------------------
   3. CONTROL & TESTING
   --------------------------------------------------------------------- */
CREATE TABLE experiments (
    experiment_id  text         PRIMARY KEY,
    name           text         NOT NULL,
    description    text         NOT NULL DEFAULT '',
    start_date     timestamptz  NOT NULL,
    end_date       timestamptz  NOT NULL,
    status         text         NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'completed', 'draft')),
    CHECK (end_date >= start_date)
);

CREATE TABLE scoring_weights (
    weight_id     text          PRIMARY KEY,
    weight_name   text          NOT NULL UNIQUE,         -- w_taste, w_mood, w_similar, w_fresh, w_recent
    weight_value  numeric(6,3)  NOT NULL,
    updated_by    text          REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at    timestamptz   NOT NULL DEFAULT now()
);

/* ---------------------------------------------------------------------
   4. ACTIVITY & MOOD
   --------------------------------------------------------------------- */
CREATE TABLE mood_checkins (
    checkin_id    text         PRIMARY KEY,
    user_id       text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    mood_label    text         NOT NULL CHECK (mood_label IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    energy_level  integer      NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
    checked_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE mood_scores (
    score_id       text          PRIMARY KEY,
    user_id        text          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    calculated_at  timestamptz   NOT NULL DEFAULT now(),
    detected_mood  text          NOT NULL CHECK (detected_mood IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    mood_score     numeric(5,2)  NOT NULL CHECK (mood_score BETWEEN 0 AND 100),
    skip_count     integer       NOT NULL DEFAULT 0 CHECK (skip_count >= 0),
    replay_count   integer       NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
    time_of_day    text          NOT NULL CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'night')),
    avg_energy     numeric(4,3),
    avg_tempo      numeric(6,2),
    checkin_id     text          REFERENCES mood_checkins(checkin_id) ON DELETE SET NULL
);

/* ---------------------------------------------------------------------
   5. SUGGESTIONS
   --------------------------------------------------------------------- */
CREATE TABLE suggestion_batches (
    batch_id       text         PRIMARY KEY,
    user_id        text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    experiment_id  text         REFERENCES experiments(experiment_id) ON DELETE SET NULL,
    variant        char(1)      NOT NULL DEFAULT 'A' CHECK (variant IN ('A', 'B')),
    score_id       text         REFERENCES mood_scores(score_id) ON DELETE SET NULL,
    created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE suggestions (
    suggestion_id        text          PRIMARY KEY,
    batch_id             text          NOT NULL REFERENCES suggestion_batches(batch_id) ON DELETE CASCADE,
    song_id              text          NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
    rank_position        integer       NOT NULL CHECK (rank_position >= 1),
    total_score          numeric(8,4)  NOT NULL DEFAULT 0,
    taste_score          numeric(8,4)  NOT NULL DEFAULT 0,
    mood_match_score     numeric(8,4)  NOT NULL DEFAULT 0,
    similar_users_score  numeric(8,4)  NOT NULL DEFAULT 0,
    freshness_score      numeric(8,4)  NOT NULL DEFAULT 0,
    recent_penalty       numeric(8,4)  NOT NULL DEFAULT 0,
    is_exploration       boolean       NOT NULL DEFAULT false,
    outcome              text          NOT NULL DEFAULT 'pending'
                         CHECK (outcome IN ('pending', 'played', 'skipped', 'rated', 'ignored'))
);

CREATE TABLE suggestion_reasons (
    reason_id      text          PRIMARY KEY,
    suggestion_id  text          NOT NULL REFERENCES suggestions(suggestion_id) ON DELETE CASCADE,
    reason_type    text          NOT NULL,
    reason_text    text          NOT NULL,
    contribution   numeric(5,4)  NOT NULL CHECK (contribution BETWEEN 0 AND 1)
);

CREATE TABLE listening_history (
    history_id     text         PRIMARY KEY,
    user_id        text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    song_id        text         NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
    played_at      timestamptz  NOT NULL DEFAULT now(),
    listened_sec   integer      NOT NULL DEFAULT 0 CHECK (listened_sec >= 0),
    completed      boolean      NOT NULL DEFAULT false,
    source         text         NOT NULL CHECK (source IN ('search', 'playlist', 'suggestion')),
    suggestion_id  text         REFERENCES suggestions(suggestion_id) ON DELETE SET NULL
);

/* ---------------------------------------------------------------------
   6. FEEDBACK & LEARNING
   --------------------------------------------------------------------- */
CREATE TABLE ratings (
    rating_id      text         PRIMARY KEY,
    user_id        text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    song_id        text         NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
    suggestion_id  text         REFERENCES suggestions(suggestion_id) ON DELETE SET NULL,
    stars          integer      NOT NULL CHECK (stars BETWEEN 1 AND 5),
    rated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE implicit_signals (
    signal_id      text          PRIMARY KEY,
    user_id        text          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    song_id        text          NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
    suggestion_id  text          REFERENCES suggestions(suggestion_id) ON DELETE SET NULL,
    signal_type    text          NOT NULL CHECK (signal_type IN ('full_play', 'skip', 'replay', 'add_to_playlist')),
    signal_value   numeric(5,2)  NOT NULL,
    created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE user_taste_profile (
    user_id         text          NOT NULL REFERENCES users(user_id)   ON DELETE CASCADE,
    genre_id        text          NOT NULL REFERENCES genres(genre_id) ON DELETE CASCADE,
    affinity_score  numeric(8,4)  NOT NULL DEFAULT 0,
    play_count      integer       NOT NULL DEFAULT 0 CHECK (play_count >= 0),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, genre_id)
);

CREATE TABLE user_similarity (
    user_id_a         text          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    user_id_b         text          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    similarity_score  numeric(5,4)  NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
    common_songs      integer       NOT NULL DEFAULT 0 CHECK (common_songs >= 0),
    calculated_at     timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id_a, user_id_b),
    CHECK (user_id_a <> user_id_b)
);

/* ---------------------------------------------------------------------
   7. IMPACT & SAFETY
   --------------------------------------------------------------------- */
CREATE TABLE song_impact (
    impact_id    text         PRIMARY KEY,
    user_id      text         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    song_id      text         NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
    history_id   text         NOT NULL REFERENCES listening_history(history_id) ON DELETE CASCADE,
    mood_before  text         NOT NULL CHECK (mood_before IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    mood_after   text         NOT NULL CHECK (mood_after  IN ('happy', 'calm', 'sad', 'energetic', 'stressed')),
    measured_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    log_id      text         PRIMARY KEY,
    user_id     text         REFERENCES users(user_id) ON DELETE SET NULL,
    table_name  text         NOT NULL,
    record_id   text         NOT NULL,
    action      text         NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data    jsonb,
    new_data    jsonb,
    changed_at  timestamptz  NOT NULL DEFAULT now()
);

/* ---------------------------------------------------------------------
   INDEXES
   --------------------------------------------------------------------- */
CREATE UNIQUE INDEX uq_users_email          ON users (lower(email));

CREATE INDEX idx_songs_artist               ON songs (artist_id);
CREATE INDEX idx_songs_source               ON songs (source);
CREATE INDEX idx_songs_type_region          ON songs (content_type, region) WHERE is_active;
CREATE INDEX idx_history_user_played        ON listening_history (user_id, played_at DESC);
CREATE INDEX idx_history_song               ON listening_history (song_id);
CREATE INDEX idx_checkins_user_time         ON mood_checkins (user_id, checked_at DESC);
CREATE INDEX idx_mood_scores_user_time      ON mood_scores (user_id, calculated_at DESC);
CREATE INDEX idx_batches_user               ON suggestion_batches (user_id, created_at DESC);
CREATE INDEX idx_suggestions_batch          ON suggestions (batch_id);
CREATE INDEX idx_ratings_user_song          ON ratings (user_id, song_id);
CREATE INDEX idx_signals_user               ON implicit_signals (user_id, created_at DESC);
CREATE INDEX idx_audit_table_time           ON audit_log (table_name, changed_at DESC);
CREATE INDEX idx_playlists_user             ON playlists (user_id);
CREATE INDEX idx_sessions_user              ON auth_sessions (user_id);
CREATE INDEX idx_similarity_b               ON user_similarity (user_id_b);   -- speeds up the cascade from users

-- The same item at the same source can never be stored twice (partial unique indexes)
CREATE UNIQUE INDEX uq_songs_source_external    ON songs   (source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX uq_artists_source_external  ON artists (source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX uq_albums_source_external   ON albums  (source, external_id) WHERE external_id IS NOT NULL;
