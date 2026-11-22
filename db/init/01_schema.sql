/* =====================================================================
   MoodTide: SQL Server (T-SQL) schema, 25 tables
   Converted from PostgreSQL. Includes the real-music columns that were
   in 03_real_music.sql (source / external_id / external_url), so you do
   NOT need to run that file again.

   HOW TO RUN: once, on a fresh server (SSMS: File > Open > Execute, or
   sqlcmd -S localhost -i 01_schema.sql). To start over, run
   DROP DATABASE MoodTide from the master database and run this again.

   NOTES ON WHAT CHANGED FROM POSTGRES
   - TEXT keys          -> NVARCHAR(n)   (SQL Server cannot index MAX types)
   - TIMESTAMPTZ now()  -> DATETIME2(3) SYSUTCDATETIME()   (all times are UTC)
   - BOOLEAN            -> BIT
   - JSONB              -> NVARCHAR(MAX) + CHECK (ISJSON(...) = 1)
   - NUMERIC            -> DECIMAL
   - lower(email) index -> plain UNIQUE (the default collation is already
                           case-insensitive: SQL_Latin1_General_CP1_CI_AS)
   - Partial index (WHERE external_id IS NOT NULL) -> filtered index (same idea)

   CASCADE RULES: SQL Server refuses a foreign key if the same table can be
   reached from one parent by two cascade paths ("may cause cycles or
   multiple cascade paths"). Postgres allowed it, SQL Server does not, so a
   few keys are NO ACTION instead of CASCADE / SET NULL. They are marked
   with  -- NO ACTION  below. Deleting a user or a song still works,
   because the other path already removes those rows in the same statement.
   Deleting a user goes through dbo.usp_DeleteUser (see the end).
   ===================================================================== */

SET NOCOUNT ON;
GO

IF DB_ID(N'MoodTide') IS NULL CREATE DATABASE MoodTide;
GO
USE MoodTide;
GO

/* ---------------------------------------------------------------------
   1. MUSIC CATALOG
   --------------------------------------------------------------------- */
CREATE TABLE dbo.artists (
    artist_id    NVARCHAR(64)  NOT NULL PRIMARY KEY,
    name         NVARCHAR(300) NOT NULL,
    country      NVARCHAR(100) NULL,
    created_at   DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source       NVARCHAR(20)  NOT NULL DEFAULT N'demo',
    external_id  NVARCHAR(64)  NULL           -- artist id at Deezer
);

CREATE TABLE dbo.albums (
    album_id      NVARCHAR(64)   NOT NULL PRIMARY KEY,
    artist_id     NVARCHAR(64)   NOT NULL REFERENCES dbo.artists(artist_id) ON DELETE CASCADE,
    title         NVARCHAR(400)  NOT NULL,
    release_year  INT            NULL CHECK (release_year BETWEEN 1900 AND 2100),
    cover_url     NVARCHAR(1000) NULL,
    source        NVARCHAR(20)   NOT NULL DEFAULT N'demo',
    external_id   NVARCHAR(64)   NULL
);

CREATE TABLE dbo.genres (
    genre_id  NVARCHAR(64)  NOT NULL PRIMARY KEY,
    name      NVARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE dbo.songs (
    song_id       NVARCHAR(64)   NOT NULL PRIMARY KEY,
    artist_id     NVARCHAR(64)   NOT NULL REFERENCES dbo.artists(artist_id) ON DELETE CASCADE,
    album_id      NVARCHAR(64)   NULL REFERENCES dbo.albums(album_id),            -- NO ACTION (was SET NULL)
    title         NVARCHAR(500)  NOT NULL,
    duration_sec  INT            NOT NULL CHECK (duration_sec > 0),
    release_year  INT            NULL CHECK (release_year BETWEEN 1900 AND 2100),
    audio_url     NVARCHAR(1000) NULL,   -- Deezer 30s preview. These links EXPIRE, so refresh by external_id when playing
    popularity    INT            NOT NULL DEFAULT 50 CHECK (popularity BETWEEN 0 AND 100),
    is_active     BIT            NOT NULL DEFAULT 1,
    created_at    DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    source        NVARCHAR(20)   NOT NULL DEFAULT N'demo',
    external_id   NVARCHAR(64)   NULL,   -- the track id at Deezer
    external_url  NVARCHAR(1000) NULL    -- link back to the song page
);

CREATE TABLE dbo.song_genres (
    song_id   NVARCHAR(64) NOT NULL REFERENCES dbo.songs(song_id)   ON DELETE CASCADE,
    genre_id  NVARCHAR(64) NOT NULL REFERENCES dbo.genres(genre_id) ON DELETE CASCADE,
    PRIMARY KEY (song_id, genre_id)
);

CREATE TABLE dbo.song_features (
    song_id         NVARCHAR(64)  NOT NULL PRIMARY KEY REFERENCES dbo.songs(song_id) ON DELETE CASCADE,
    energy          DECIMAL(4,3)  NOT NULL CHECK (energy       BETWEEN 0 AND 1),
    happiness       DECIMAL(4,3)  NOT NULL CHECK (happiness    BETWEEN 0 AND 1),
    tempo           INT           NOT NULL CHECK (tempo        BETWEEN 40 AND 220),
    danceability    DECIMAL(4,3)  NOT NULL CHECK (danceability BETWEEN 0 AND 1),
    acousticness    DECIMAL(4,3)  NOT NULL CHECK (acousticness BETWEEN 0 AND 1),
    feature_source  NVARCHAR(30)  NOT NULL DEFAULT N'estimated'   -- NEW: where the numbers came from (api name, 'estimated', 'demo')
);

/* ---------------------------------------------------------------------
   2. USERS & AUTH
   --------------------------------------------------------------------- */
CREATE TABLE dbo.roles (
    role_id    NVARCHAR(64) NOT NULL PRIMARY KEY,
    role_name  NVARCHAR(20) NOT NULL UNIQUE CHECK (role_name IN (N'user', N'admin'))
);

CREATE TABLE dbo.users (
    user_id           NVARCHAR(64)  NOT NULL PRIMARY KEY,
    role_id           NVARCHAR(64)  NOT NULL REFERENCES dbo.roles(role_id),
    username          NVARCHAR(100) NOT NULL,
    email             NVARCHAR(320) NOT NULL,
    password_hash     NVARCHAR(255) NOT NULL,   -- a real bcrypt/argon2 hash made by the backend (not the fake one in the demo)
    experiment_group  CHAR(1)       NOT NULL DEFAULT 'A' CHECK (experiment_group IN ('A', 'B')),
    created_at        DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    last_login        DATETIME2(3)  NULL,
    CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE dbo.auth_sessions (
    session_id   NVARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id      NVARCHAR(64)  NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    token_hash   NVARCHAR(255) NOT NULL,
    created_at   DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at   DATETIME2(3)  NOT NULL,
    is_revoked   BIT           NOT NULL DEFAULT 0,
    CHECK (expires_at > created_at)
);

CREATE TABLE dbo.playlists (
    playlist_id    NVARCHAR(64)   NOT NULL PRIMARY KEY,
    user_id        NVARCHAR(64)   NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    name           NVARCHAR(200)  NOT NULL,
    description    NVARCHAR(1000) NOT NULL DEFAULT N'',
    playlist_type  NVARCHAR(20)   NOT NULL DEFAULT N'normal' CHECK (playlist_type IN (N'normal', N'mood_journey')),
    start_mood     NVARCHAR(20)   NULL CHECK (start_mood  IN (N'happy', N'calm', N'sad', N'energetic', N'stressed')),
    target_mood    NVARCHAR(20)   NULL CHECK (target_mood IN (N'happy', N'calm', N'sad', N'energetic', N'stressed')),
    created_at     DATETIME2(3)   NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.playlist_songs (
    playlist_id  NVARCHAR(64) NOT NULL REFERENCES dbo.playlists(playlist_id) ON DELETE CASCADE,
    song_id      NVARCHAR(64) NOT NULL REFERENCES dbo.songs(song_id)         ON DELETE CASCADE,
    [position]   INT          NOT NULL CHECK ([position] >= 0),
    added_at     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (playlist_id, song_id)   -- a song can only be in a playlist once
);

/* ---------------------------------------------------------------------
   3. CONTROL & TESTING
   --------------------------------------------------------------------- */
CREATE TABLE dbo.experiments (
    experiment_id  NVARCHAR(64)   NOT NULL PRIMARY KEY,
    name           NVARCHAR(200)  NOT NULL,
    description    NVARCHAR(1000) NOT NULL DEFAULT N'',
    start_date     DATETIME2(3)   NOT NULL,
    end_date       DATETIME2(3)   NOT NULL,
    status         NVARCHAR(20)   NOT NULL DEFAULT N'draft' CHECK (status IN (N'active', N'completed', N'draft')),
    CHECK (end_date >= start_date)
);

CREATE TABLE dbo.scoring_weights (
    weight_id     NVARCHAR(64)  NOT NULL PRIMARY KEY,
    weight_name   NVARCHAR(100) NOT NULL UNIQUE,      -- w_taste, w_mood, w_similar, w_fresh, w_recent
    weight_value  DECIMAL(6,3)  NOT NULL,
    updated_by    NVARCHAR(64)  NULL REFERENCES dbo.users(user_id) ON DELETE SET NULL,
    updated_at    DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
);

/* ---------------------------------------------------------------------
   4. ACTIVITY & MOOD
   --------------------------------------------------------------------- */
CREATE TABLE dbo.mood_checkins (
    checkin_id    NVARCHAR(64) NOT NULL PRIMARY KEY,
    user_id       NVARCHAR(64) NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    mood_label    NVARCHAR(20) NOT NULL CHECK (mood_label IN (N'happy', N'calm', N'sad', N'energetic', N'stressed')),
    energy_level  INT          NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
    checked_at    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.mood_scores (
    score_id       NVARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id        NVARCHAR(64)  NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    calculated_at  DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    detected_mood  NVARCHAR(20)  NOT NULL CHECK (detected_mood IN (N'happy', N'calm', N'sad', N'energetic', N'stressed')),
    mood_score     DECIMAL(5,2)  NOT NULL CHECK (mood_score BETWEEN 0 AND 100),
    skip_count     INT           NOT NULL DEFAULT 0 CHECK (skip_count >= 0),
    replay_count   INT           NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
    time_of_day    NVARCHAR(20)  NOT NULL CHECK (time_of_day IN (N'morning', N'afternoon', N'evening', N'night')),
    avg_energy     DECIMAL(4,3)  NULL,
    avg_tempo      DECIMAL(6,2)  NULL,
    checkin_id     NVARCHAR(64)  NULL REFERENCES dbo.mood_checkins(checkin_id)    -- NO ACTION (was SET NULL)
);

/* ---------------------------------------------------------------------
   5. SUGGESTIONS
   --------------------------------------------------------------------- */
CREATE TABLE dbo.suggestion_batches (
    batch_id       NVARCHAR(64) NOT NULL PRIMARY KEY,
    user_id        NVARCHAR(64) NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    experiment_id  NVARCHAR(64) NULL REFERENCES dbo.experiments(experiment_id) ON DELETE SET NULL,
    variant        CHAR(1)      NOT NULL DEFAULT 'A' CHECK (variant IN ('A', 'B')),
    score_id       NVARCHAR(64) NULL REFERENCES dbo.mood_scores(score_id),        -- NO ACTION (was SET NULL)
    created_at     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.suggestions (
    suggestion_id        NVARCHAR(64)  NOT NULL PRIMARY KEY,
    batch_id             NVARCHAR(64)  NOT NULL REFERENCES dbo.suggestion_batches(batch_id) ON DELETE CASCADE,
    song_id              NVARCHAR(64)  NOT NULL REFERENCES dbo.songs(song_id) ON DELETE CASCADE,
    rank_position        INT           NOT NULL CHECK (rank_position >= 1),
    total_score          DECIMAL(8,4)  NOT NULL DEFAULT 0,
    taste_score          DECIMAL(8,4)  NOT NULL DEFAULT 0,
    mood_match_score     DECIMAL(8,4)  NOT NULL DEFAULT 0,
    similar_users_score  DECIMAL(8,4)  NOT NULL DEFAULT 0,
    freshness_score      DECIMAL(8,4)  NOT NULL DEFAULT 0,
    recent_penalty       DECIMAL(8,4)  NOT NULL DEFAULT 0,
    is_exploration       BIT           NOT NULL DEFAULT 0,
    outcome              NVARCHAR(20)  NOT NULL DEFAULT N'pending'
                         CHECK (outcome IN (N'pending', N'played', N'skipped', N'rated', N'ignored'))
);

CREATE TABLE dbo.suggestion_reasons (
    reason_id      NVARCHAR(64)   NOT NULL PRIMARY KEY,
    suggestion_id  NVARCHAR(64)   NOT NULL REFERENCES dbo.suggestions(suggestion_id) ON DELETE CASCADE,
    reason_type    NVARCHAR(100)  NOT NULL,
    reason_text    NVARCHAR(1000) NOT NULL,
    contribution   DECIMAL(5,4)   NOT NULL CHECK (contribution BETWEEN 0 AND 1)
);

CREATE TABLE dbo.listening_history (
    history_id     NVARCHAR(64) NOT NULL PRIMARY KEY,
    user_id        NVARCHAR(64) NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    song_id        NVARCHAR(64) NOT NULL REFERENCES dbo.songs(song_id) ON DELETE CASCADE,
    played_at      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    listened_sec   INT          NOT NULL DEFAULT 0 CHECK (listened_sec >= 0),
    completed      BIT          NOT NULL DEFAULT 0,
    source         NVARCHAR(20) NOT NULL CHECK (source IN (N'search', N'playlist', N'suggestion')),
    suggestion_id  NVARCHAR(64) NULL REFERENCES dbo.suggestions(suggestion_id)    -- NO ACTION (was SET NULL)
);

/* ---------------------------------------------------------------------
   6. FEEDBACK & LEARNING
   --------------------------------------------------------------------- */
CREATE TABLE dbo.ratings (
    rating_id      NVARCHAR(64) NOT NULL PRIMARY KEY,
    user_id        NVARCHAR(64) NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    song_id        NVARCHAR(64) NOT NULL REFERENCES dbo.songs(song_id) ON DELETE CASCADE,
    suggestion_id  NVARCHAR(64) NULL REFERENCES dbo.suggestions(suggestion_id),   -- NO ACTION (was SET NULL)
    stars          INT          NOT NULL CHECK (stars BETWEEN 1 AND 5),
    rated_at       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.implicit_signals (
    signal_id      NVARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id        NVARCHAR(64)  NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    song_id        NVARCHAR(64)  NOT NULL REFERENCES dbo.songs(song_id) ON DELETE CASCADE,
    suggestion_id  NVARCHAR(64)  NULL REFERENCES dbo.suggestions(suggestion_id),  -- NO ACTION (was SET NULL)
    signal_type    NVARCHAR(30)  NOT NULL CHECK (signal_type IN (N'full_play', N'skip', N'replay', N'add_to_playlist')),
    signal_value   DECIMAL(5,2)  NOT NULL,
    created_at     DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.user_taste_profile (
    user_id         NVARCHAR(64)  NOT NULL REFERENCES dbo.users(user_id)   ON DELETE CASCADE,
    genre_id        NVARCHAR(64)  NOT NULL REFERENCES dbo.genres(genre_id) ON DELETE CASCADE,
    affinity_score  DECIMAL(8,4)  NOT NULL DEFAULT 0,
    play_count      INT           NOT NULL DEFAULT 0 CHECK (play_count >= 0),
    updated_at      DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (user_id, genre_id)
);

CREATE TABLE dbo.user_similarity (
    user_id_a         NVARCHAR(64)  NOT NULL REFERENCES dbo.users(user_id) ON DELETE CASCADE,
    user_id_b         NVARCHAR(64)  NOT NULL REFERENCES dbo.users(user_id),       -- NO ACTION (two cascades to one table are not allowed)
    similarity_score  DECIMAL(5,4)  NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
    common_songs      INT           NOT NULL DEFAULT 0 CHECK (common_songs >= 0),
    calculated_at     DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (user_id_a, user_id_b),
    CHECK (user_id_a <> user_id_b)
);

/* ---------------------------------------------------------------------
   7. IMPACT & SAFETY
   --------------------------------------------------------------------- */
CREATE TABLE dbo.song_impact (
    impact_id    NVARCHAR(64) NOT NULL PRIMARY KEY,
    user_id      NVARCHAR(64) NOT NULL REFERENCES dbo.users(user_id),                              -- NO ACTION (rows go via history_id)
    song_id      NVARCHAR(64) NOT NULL REFERENCES dbo.songs(song_id),                              -- NO ACTION (rows go via history_id)
    history_id   NVARCHAR(64) NOT NULL REFERENCES dbo.listening_history(history_id) ON DELETE CASCADE,
    mood_before  NVARCHAR(20) NOT NULL CHECK (mood_before IN (N'happy', N'calm', N'sad', N'energetic', N'stressed')),
    mood_after   NVARCHAR(20) NOT NULL CHECK (mood_after  IN (N'happy', N'calm', N'sad', N'energetic', N'stressed')),
    measured_at  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.audit_log (
    log_id      NVARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id     NVARCHAR(64)  NULL REFERENCES dbo.users(user_id) ON DELETE SET NULL,
    table_name  NVARCHAR(100) NOT NULL,
    record_id   NVARCHAR(64)  NOT NULL,
    action      NVARCHAR(10)  NOT NULL CHECK (action IN (N'INSERT', N'UPDATE', N'DELETE')),
    old_data    NVARCHAR(MAX) NULL CHECK (ISJSON(old_data) = 1),
    new_data    NVARCHAR(MAX) NULL CHECK (ISJSON(new_data) = 1),
    changed_at  DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
);

/* ---------------------------------------------------------------------
   INDEXES
   --------------------------------------------------------------------- */
CREATE INDEX idx_songs_artist          ON dbo.songs (artist_id);
CREATE INDEX idx_songs_source          ON dbo.songs (source);
CREATE INDEX idx_history_user_played   ON dbo.listening_history (user_id, played_at DESC);
CREATE INDEX idx_history_song          ON dbo.listening_history (song_id);
CREATE INDEX idx_checkins_user_time    ON dbo.mood_checkins (user_id, checked_at DESC);
CREATE INDEX idx_mood_scores_user_time ON dbo.mood_scores (user_id, calculated_at DESC);
CREATE INDEX idx_batches_user          ON dbo.suggestion_batches (user_id, created_at DESC);
CREATE INDEX idx_suggestions_batch     ON dbo.suggestions (batch_id);
CREATE INDEX idx_ratings_user_song     ON dbo.ratings (user_id, song_id);
CREATE INDEX idx_signals_user          ON dbo.implicit_signals (user_id, created_at DESC);
CREATE INDEX idx_audit_table_time      ON dbo.audit_log (table_name, changed_at DESC);
CREATE INDEX idx_playlists_user        ON dbo.playlists (user_id);
CREATE INDEX idx_sessions_user         ON dbo.auth_sessions (user_id);

-- The same Deezer item can never be stored twice (filtered unique indexes)
CREATE UNIQUE INDEX uq_songs_source_external   ON dbo.songs   (source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX uq_artists_source_external ON dbo.artists (source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX uq_albums_source_external  ON dbo.albums  (source, external_id) WHERE external_id IS NOT NULL;
GO

/* ---------------------------------------------------------------------
   DELETE A USER SAFELY
   user_similarity has two keys to users and only one can cascade, so the
   other side is removed here first. Always delete users through this.
   --------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE dbo.usp_DeleteUser
    @user_id NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRAN;
        DELETE FROM dbo.user_similarity WHERE user_id_b = @user_id;
        DELETE FROM dbo.users           WHERE user_id   = @user_id;
    COMMIT;
END
GO


USE MoodTide;
SELECT COUNT(*) AS tables_created FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE';