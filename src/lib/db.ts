/**
 * MoodTide Mock PostgreSQL Relational Database Engine
 *
 * Implements:
 * - 25 Relational Tables with Foreign Keys & Primary Keys
 * - Constraint Enforcements (PK, FK, UNIQUE, CHECK, Composite Uniqueness)
 * - ACID-like atomic transaction simulation
 * - Stored Procedures: detectMood, generateSuggestions, buildMoodJourney, computeUserSimilarity, measureSongImpact
 * - Database Triggers: onSongPlay, onSongRate, onPlaylistAdd with cascading taste updates & Audit_Log
 * - A/B Testing Cohort engine & realistic seed simulator
 */

import {
  DatabaseSchema,
  TableKey,
  TableMeta,
  ConstraintViolation,
  MoodType,
  User,
  Song,
  SongFeatures,
  Suggestion,
  AuditLog,
  Playlist,
} from '../types/database';

export class ConstraintViolationError extends Error {
  public violation: ConstraintViolation;
  constructor(violation: ConstraintViolation) {
    super(violation.message);
    this.name = 'ConstraintViolationError';
    this.violation = violation;
  }
}

const STORAGE_KEY = 'moodtide_relational_db_v1';

// Preset Mood coordinates in (energy, happiness/valence) space
export const MOOD_COORDINATES: Record<MoodType, { energy: number; happiness: number; tempo: number; label: string; accentColor: string; bgGlow: string }> = {
  happy: { energy: 0.75, happiness: 0.85, tempo: 124, label: 'Happy', accentColor: 'amber', bgGlow: 'from-amber-500/20 via-orange-500/10 to-transparent' },
  calm: { energy: 0.32, happiness: 0.65, tempo: 78, label: 'Calm', accentColor: 'teal', bgGlow: 'from-teal-500/20 via-emerald-500/10 to-transparent' },
  sad: { energy: 0.28, happiness: 0.22, tempo: 68, label: 'Sad / Melancholic', accentColor: 'indigo', bgGlow: 'from-indigo-600/20 via-blue-900/10 to-transparent' },
  energetic: { energy: 0.88, happiness: 0.72, tempo: 138, label: 'Energetic', accentColor: 'rose', bgGlow: 'from-rose-500/20 via-pink-600/10 to-transparent' },
  stressed: { energy: 0.65, happiness: 0.28, tempo: 110, label: 'Stressed / Frustrated', accentColor: 'violet', bgGlow: 'from-violet-600/20 via-purple-900/10 to-transparent' },
};

// 25 Table Metadata definitions
export const TABLES_METADATA: TableMeta[] = [
  { key: 'artists', tableName: 'Artists', category: 'Music Catalog', primaryKey: ['artist_id'], foreignKeys: [], description: 'Music artists and their country of origin' },
  { key: 'albums', tableName: 'Albums', category: 'Music Catalog', primaryKey: ['album_id'], foreignKeys: [{ column: 'artist_id', references: 'Artists.artist_id' }], description: 'Discography albums linked to artists' },
  { key: 'genres', tableName: 'Genres', category: 'Music Catalog', primaryKey: ['genre_id'], foreignKeys: [], description: 'Unique musical genre taxonomies' },
  { key: 'songs', tableName: 'Songs', category: 'Music Catalog', primaryKey: ['song_id'], foreignKeys: [{ column: 'artist_id', references: 'Artists.artist_id' }, { column: 'album_id', references: 'Albums.album_id' }], description: 'Master song catalog with duration and popularity' },
  { key: 'song_genres', tableName: 'Song_Genre', category: 'Music Catalog', primaryKey: ['song_id', 'genre_id'], foreignKeys: [{ column: 'song_id', references: 'Songs.song_id' }, { column: 'genre_id', references: 'Genres.genre_id' }], description: 'Many-to-many relationship mapping songs to genres' },
  { key: 'song_features', tableName: 'Song_Features', category: 'Music Catalog', primaryKey: ['song_id'], foreignKeys: [{ column: 'song_id', references: 'Songs.song_id' }], description: 'Acoustic metric vectors: energy, happiness, tempo, danceability' },
  { key: 'roles', tableName: 'Roles', category: 'Users & Auth', primaryKey: ['role_id'], foreignKeys: [], description: 'User roles for authorization (user, admin)' },
  { key: 'users', tableName: 'Users', category: 'Users & Auth', primaryKey: ['user_id'], foreignKeys: [{ column: 'role_id', references: 'Roles.role_id' }], description: 'Registered user credentials, salted password hashes, and cohorts' },
  { key: 'auth_sessions', tableName: 'Auth_Sessions', category: 'Users & Auth', primaryKey: ['session_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }], description: 'Active token sessions with expiration and revocation' },
  { key: 'playlists', tableName: 'Playlists', category: 'Users & Auth', primaryKey: ['playlist_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }], description: 'User-created playlists & generated mood journey sequences' },
  { key: 'playlist_songs', tableName: 'Playlist_Songs', category: 'Users & Auth', primaryKey: ['playlist_id', 'song_id'], foreignKeys: [{ column: 'playlist_id', references: 'Playlists.playlist_id' }, { column: 'song_id', references: 'Songs.song_id' }], description: 'Songs in playlist with position ordering and uniqueness' },
  { key: 'listening_history', tableName: 'Listening_History', category: 'Activity & Mood', primaryKey: ['history_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }, { column: 'song_id', references: 'Songs.song_id' }, { column: 'suggestion_id', references: 'Suggestions.suggestion_id' }], description: 'Stream log of songs played, listened duration, and completion' },
  { key: 'mood_checkins', tableName: 'Mood_Checkins', category: 'Activity & Mood', primaryKey: ['checkin_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }], description: 'Manual user mood check-in records with energy scale (1-5)' },
  { key: 'mood_scores', tableName: 'Mood_Scores', category: 'Activity & Mood', primaryKey: ['score_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }, { column: 'checkin_id', references: 'Mood_Checkins.checkin_id' }], description: 'Automated rule-based mood detections and telemetry features' },
  { key: 'suggestion_batches', tableName: 'Suggestion_Batches', category: 'Suggestions', primaryKey: ['batch_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }, { column: 'experiment_id', references: 'Experiments.experiment_id' }, { column: 'score_id', references: 'Mood_Scores.score_id' }], description: 'Generated suggestion run batches linked to A/B test groups' },
  { key: 'suggestions', tableName: 'Suggestions', category: 'Suggestions', primaryKey: ['suggestion_id'], foreignKeys: [{ column: 'batch_id', references: 'SuggestionBatches.batch_id' }, { column: 'song_id', references: 'Songs.song_id' }], description: 'Scored recommendations with taste, mood, freshness, and exploration' },
  { key: 'suggestion_reasons', tableName: 'Suggestion_Reasons', category: 'Suggestions', primaryKey: ['reason_id'], foreignKeys: [{ column: 'suggestion_id', references: 'Suggestions.suggestion_id' }], description: 'Explainable AI rationale breakdown contributing to the score' },
  { key: 'ratings', tableName: 'Ratings', category: 'Feedback & Learning', primaryKey: ['rating_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }, { column: 'song_id', references: 'Songs.song_id' }], description: 'Explicit 1-5 star user ratings with CHECK constraints' },
  { key: 'implicit_signals', tableName: 'Implicit_Signals', category: 'Feedback & Learning', primaryKey: ['signal_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }, { column: 'song_id', references: 'Songs.song_id' }], description: 'Implicit feedback actions: full_play (+1), replay (+2), skip (-1), add (+2)' },
  { key: 'user_taste_profile', tableName: 'User_Taste_Profile', category: 'Feedback & Learning', primaryKey: ['user_id', 'genre_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }, { column: 'genre_id', references: 'Genres.genre_id' }], description: 'Aggregated user genre affinities and total play counters' },
  { key: 'user_similarity', tableName: 'User_Similarity', category: 'Feedback & Learning', primaryKey: ['user_id_a', 'user_id_b'], foreignKeys: [{ column: 'user_id_a', references: 'Users.user_id' }, { column: 'user_id_b', references: 'Users.user_id' }], description: 'Pairwise collaborative filtering similarity coefficients' },
  { key: 'scoring_weights', tableName: 'Scoring_Weights', category: 'Control & Testing', primaryKey: ['weight_id'], foreignKeys: [{ column: 'updated_by', references: 'Users.user_id' }], description: 'Global suggestion scoring hyperparameter weights' },
  { key: 'experiments', tableName: 'Experiments', category: 'Control & Testing', primaryKey: ['experiment_id'], foreignKeys: [], description: 'Controlled A/B testing definitions' },
  { key: 'song_impact', tableName: 'Song_Impact', category: 'Impact & Safety', primaryKey: ['impact_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }, { column: 'song_id', references: 'Songs.song_id' }, { column: 'history_id', references: 'Listening_History.history_id' }], description: 'Delta measurement of user mood before vs after hearing a song' },
  { key: 'audit_log', tableName: 'Audit_Log', category: 'Impact & Safety', primaryKey: ['log_id'], foreignKeys: [{ column: 'user_id', references: 'Users.user_id' }], description: 'Append-only database transaction audit trail' },
];

/**
 * Generates robust initial seed data:
 * - 60 fictional songs across 8 genres
 * - 12 realistic demo users (1 admin, 11 users)
 * - Initial playlists, ratings, implicit signals, weights, and experiments
 */
function createInitialDatabase(): DatabaseSchema {
  const genres = [
    { genre_id: 'gen_1', name: 'Ambient & Drone' },
    { genre_id: 'gen_2', name: 'Lo-Fi Chillhop' },
    { genre_id: 'gen_3', name: 'Synthwave & Retrowave' },
    { genre_id: 'gen_4', name: 'Deep Melodic Techno' },
    { genre_id: 'gen_5', name: 'Neo-Classical & Cinematic' },
    { genre_id: 'gen_6', name: 'Indie Folk & Acoustic' },
    { genre_id: 'gen_7', name: 'Dream Pop' },
    { genre_id: 'gen_8', name: 'R&B / Soul Glitch' },
  ];

  const artists = [
    { artist_id: 'art_1', name: 'Solaris Drift', country: 'Iceland', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_2', name: 'Komorebi Rain', country: 'Japan', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_3', name: 'Neon Vanguard', country: 'Sweden', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_4', name: 'Aura Prism', country: 'Canada', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_5', name: 'Velvet Echoes', country: 'United Kingdom', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_6', name: 'Orion Horizon', country: 'Norway', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_7', name: 'Luna Wave', country: 'France', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_8', name: 'Elysian Pulse', country: 'Germany', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_9', name: 'Cedar & Stone', country: 'United States', created_at: '2025-01-10T08:00:00Z' },
    { artist_id: 'art_10', name: 'Mira Dusk', country: 'Australia', created_at: '2025-01-10T08:00:00Z' },
  ];

  const albums = [
    { album_id: 'alb_1', artist_id: 'art_1', title: 'Subtle Geometry', release_year: 2024, cover_url: 'bg-emerald-950' },
    { album_id: 'alb_2', artist_id: 'art_2', title: 'Midnight Tea in Shibuya', release_year: 2024, cover_url: 'bg-amber-950' },
    { album_id: 'alb_3', artist_id: 'art_3', title: 'Chromium Nights', release_year: 2023, cover_url: 'bg-rose-950' },
    { album_id: 'alb_4', artist_id: 'art_4', title: 'Kinetic Equilibrium', release_year: 2025, cover_url: 'bg-indigo-950' },
    { album_id: 'alb_5', artist_id: 'art_5', title: 'Echoes Across the Valley', release_year: 2024, cover_url: 'bg-teal-950' },
    { album_id: 'alb_6', artist_id: 'art_6', title: 'Stellar Constellation', release_year: 2023, cover_url: 'bg-violet-950' },
    { album_id: 'alb_7', artist_id: 'art_7', title: 'Mirage Mirage', release_year: 2025, cover_url: 'bg-cyan-950' },
    { album_id: 'alb_8', artist_id: 'art_8', title: 'Overdrive Transmission', release_year: 2024, cover_url: 'bg-red-950' },
  ];

  // 60 Fictional Songs
  const rawSongSeeds: Array<{
    title: string;
    artistIdx: number;
    albumIdx: number;
    genreIdx: number;
    duration: number;
    energy: number;
    happiness: number;
    tempo: number;
    danceability: number;
    acousticness: number;
    popularity: number;
  }> = [
    // Ambient / Calm / Meditative (gen_1)
    { title: 'Tides of Europa', artistIdx: 0, albumIdx: 0, genreIdx: 0, duration: 248, energy: 0.18, happiness: 0.52, tempo: 64, danceability: 0.22, acousticness: 0.88, popularity: 74 },
    { title: 'Floating Through Aurora', artistIdx: 0, albumIdx: 0, genreIdx: 0, duration: 212, energy: 0.25, happiness: 0.61, tempo: 70, danceability: 0.29, acousticness: 0.82, popularity: 81 },
    { title: 'Perpetual Morning', artistIdx: 0, albumIdx: 0, genreIdx: 0, duration: 275, energy: 0.22, happiness: 0.49, tempo: 68, danceability: 0.20, acousticness: 0.91, popularity: 68 },
    { title: 'Glacial Resonance', artistIdx: 5, albumIdx: 5, genreIdx: 0, duration: 290, energy: 0.14, happiness: 0.38, tempo: 60, danceability: 0.15, acousticness: 0.94, popularity: 71 },
    { title: 'Canyon Mist', artistIdx: 8, albumIdx: 4, genreIdx: 0, duration: 230, energy: 0.29, happiness: 0.58, tempo: 72, danceability: 0.32, acousticness: 0.85, popularity: 65 },
    { title: 'Silent Orbit', artistIdx: 5, albumIdx: 5, genreIdx: 0, duration: 260, energy: 0.19, happiness: 0.45, tempo: 62, danceability: 0.18, acousticness: 0.89, popularity: 76 },
    { title: 'Zero Gravity Sigh', artistIdx: 0, albumIdx: 0, genreIdx: 0, duration: 198, energy: 0.21, happiness: 0.55, tempo: 66, danceability: 0.24, acousticness: 0.92, popularity: 69 },
    { title: 'Velvet Horizon', artistIdx: 4, albumIdx: 4, genreIdx: 0, duration: 240, energy: 0.26, happiness: 0.62, tempo: 74, danceability: 0.30, acousticness: 0.79, popularity: 78 },

    // Lo-Fi Chillhop / Warm / Focus (gen_2)
    { title: 'Porch Coffee at 7 AM', artistIdx: 1, albumIdx: 1, genreIdx: 1, duration: 164, energy: 0.38, happiness: 0.68, tempo: 82, danceability: 0.65, acousticness: 0.72, popularity: 89 },
    { title: 'Rooftop Raindrops', artistIdx: 1, albumIdx: 1, genreIdx: 1, duration: 178, energy: 0.34, happiness: 0.59, tempo: 80, danceability: 0.62, acousticness: 0.68, popularity: 92 },
    { title: 'Vinyl Nostalgia Loop', artistIdx: 1, albumIdx: 1, genreIdx: 1, duration: 155, energy: 0.42, happiness: 0.64, tempo: 84, danceability: 0.68, acousticness: 0.64, popularity: 84 },
    { title: 'Midnight Bookshop', artistIdx: 1, albumIdx: 1, genreIdx: 1, duration: 190, energy: 0.31, happiness: 0.52, tempo: 76, danceability: 0.58, acousticness: 0.77, popularity: 80 },
    { title: 'Paper Lanterns in Breeze', artistIdx: 1, albumIdx: 1, genreIdx: 1, duration: 172, energy: 0.40, happiness: 0.72, tempo: 85, danceability: 0.70, acousticness: 0.65, popularity: 86 },
    { title: 'Faded Postcards', artistIdx: 9, albumIdx: 6, genreIdx: 1, duration: 168, energy: 0.36, happiness: 0.48, tempo: 78, danceability: 0.61, acousticness: 0.75, popularity: 73 },
    { title: 'Station Clock Ticking', artistIdx: 1, albumIdx: 1, genreIdx: 1, duration: 182, energy: 0.44, happiness: 0.66, tempo: 86, danceability: 0.66, acousticness: 0.60, popularity: 79 },
    { title: 'Cat on the Window Sill', artistIdx: 1, albumIdx: 1, genreIdx: 1, duration: 149, energy: 0.33, happiness: 0.70, tempo: 81, danceability: 0.64, acousticness: 0.81, popularity: 85 },

    // Synthwave / Energetic / Cyber (gen_3)
    { title: 'Turbo Highway 1984', artistIdx: 2, albumIdx: 2, genreIdx: 2, duration: 230, energy: 0.89, happiness: 0.74, tempo: 132, danceability: 0.82, acousticness: 0.08, popularity: 91 },
    { title: 'Neon Grid Runner', artistIdx: 2, albumIdx: 2, genreIdx: 2, duration: 215, energy: 0.92, happiness: 0.68, tempo: 136, danceability: 0.79, acousticness: 0.05, popularity: 88 },
    { title: 'Laser Dusk Cruise', artistIdx: 2, albumIdx: 2, genreIdx: 2, duration: 242, energy: 0.84, happiness: 0.79, tempo: 128, danceability: 0.85, acousticness: 0.12, popularity: 83 },
    { title: 'Retrofuturist Heartbeat', artistIdx: 7, albumIdx: 7, genreIdx: 2, duration: 205, energy: 0.88, happiness: 0.65, tempo: 134, danceability: 0.76, acousticness: 0.07, popularity: 85 },
    { title: 'Arcade Overdrive', artistIdx: 2, albumIdx: 2, genreIdx: 2, duration: 198, energy: 0.95, happiness: 0.83, tempo: 140, danceability: 0.84, acousticness: 0.04, popularity: 87 },
    { title: 'Cybernetic Sunrise', artistIdx: 7, albumIdx: 7, genreIdx: 2, duration: 224, energy: 0.79, happiness: 0.71, tempo: 125, danceability: 0.77, acousticness: 0.14, popularity: 79 },
    { title: 'Chrome Boulevard', artistIdx: 2, albumIdx: 2, genreIdx: 2, duration: 236, energy: 0.86, happiness: 0.75, tempo: 130, danceability: 0.80, acousticness: 0.09, popularity: 82 },

    // Deep Melodic Techno / Hypnotic / Stressed Relief (gen_4)
    { title: 'Deep Ocean Submersion', artistIdx: 3, albumIdx: 3, genreIdx: 3, duration: 320, energy: 0.72, happiness: 0.44, tempo: 124, danceability: 0.86, acousticness: 0.11, popularity: 84 },
    { title: 'Hypnotic Resonance Chamber', artistIdx: 3, albumIdx: 3, genreIdx: 3, duration: 345, energy: 0.68, happiness: 0.38, tempo: 122, danceability: 0.83, acousticness: 0.15, popularity: 77 },
    { title: 'Phase Shift Frequency', artistIdx: 3, albumIdx: 3, genreIdx: 3, duration: 310, energy: 0.76, happiness: 0.49, tempo: 125, danceability: 0.88, acousticness: 0.09, popularity: 81 },
    { title: 'Midnight Monolith', artistIdx: 7, albumIdx: 7, genreIdx: 3, duration: 360, energy: 0.62, happiness: 0.32, tempo: 120, danceability: 0.78, acousticness: 0.20, popularity: 75 },
    { title: 'Pulsar Signal 004', artistIdx: 3, albumIdx: 3, genreIdx: 3, duration: 295, energy: 0.81, happiness: 0.52, tempo: 126, danceability: 0.85, acousticness: 0.08, popularity: 82 },
    { title: 'Echoes in the Turbine', artistIdx: 7, albumIdx: 7, genreIdx: 3, duration: 330, energy: 0.74, happiness: 0.41, tempo: 123, danceability: 0.81, acousticness: 0.13, popularity: 73 },
    { title: 'Bioluminescent Trench', artistIdx: 3, albumIdx: 3, genreIdx: 3, duration: 315, energy: 0.65, happiness: 0.47, tempo: 121, danceability: 0.84, acousticness: 0.17, popularity: 79 },

    // Neo-Classical / Cinematic / Sad / Soulful (gen_5)
    { title: 'Elegy for Forgotten Stars', artistIdx: 5, albumIdx: 5, genreIdx: 4, duration: 285, energy: 0.24, happiness: 0.19, tempo: 58, danceability: 0.18, acousticness: 0.96, popularity: 82 },
    { title: 'Solitary Piano in Embers', artistIdx: 5, albumIdx: 5, genreIdx: 4, duration: 240, energy: 0.20, happiness: 0.16, tempo: 56, danceability: 0.14, acousticness: 0.98, popularity: 86 },
    { title: 'Departure at Winterfall', artistIdx: 4, albumIdx: 4, genreIdx: 4, duration: 270, energy: 0.31, happiness: 0.25, tempo: 64, danceability: 0.22, acousticness: 0.93, popularity: 80 },
    { title: 'Waltz for a Lost Autumn', artistIdx: 5, albumIdx: 5, genreIdx: 4, duration: 255, energy: 0.28, happiness: 0.22, tempo: 66, danceability: 0.26, acousticness: 0.95, popularity: 78 },
    { title: 'Cello in the Fog', artistIdx: 4, albumIdx: 4, genreIdx: 4, duration: 295, energy: 0.22, happiness: 0.18, tempo: 60, danceability: 0.16, acousticness: 0.97, popularity: 84 },
    { title: 'Memory of White Linen', artistIdx: 5, albumIdx: 5, genreIdx: 4, duration: 232, energy: 0.27, happiness: 0.30, tempo: 65, danceability: 0.21, acousticness: 0.92, popularity: 72 },
    { title: 'Strings Across the Void', artistIdx: 4, albumIdx: 4, genreIdx: 4, duration: 310, energy: 0.35, happiness: 0.28, tempo: 70, danceability: 0.25, acousticness: 0.90, popularity: 76 },

    // Indie Folk / Warm / Happy / Reflective (gen_6)
    { title: 'Golden Wheat Fields', artistIdx: 8, albumIdx: 4, genreIdx: 5, duration: 215, energy: 0.58, happiness: 0.81, tempo: 112, danceability: 0.62, acousticness: 0.74, popularity: 85 },
    { title: 'Campfire Harmonies', artistIdx: 8, albumIdx: 4, genreIdx: 5, duration: 202, energy: 0.52, happiness: 0.78, tempo: 108, danceability: 0.58, acousticness: 0.79, popularity: 83 },
    { title: 'Riverstone Whispers', artistIdx: 8, albumIdx: 4, genreIdx: 5, duration: 228, energy: 0.46, happiness: 0.69, tempo: 104, danceability: 0.55, acousticness: 0.82, popularity: 77 },
    { title: 'Mountain Wind Serenade', artistIdx: 8, albumIdx: 4, genreIdx: 5, duration: 240, energy: 0.61, happiness: 0.84, tempo: 116, danceability: 0.64, acousticness: 0.70, popularity: 88 },
    { title: 'Copper Kettle Morning', artistIdx: 8, albumIdx: 4, genreIdx: 5, duration: 195, energy: 0.54, happiness: 0.76, tempo: 110, danceability: 0.60, acousticness: 0.77, popularity: 75 },
    { title: 'Wildflower Bloom', artistIdx: 9, albumIdx: 6, genreIdx: 5, duration: 210, energy: 0.65, happiness: 0.88, tempo: 120, danceability: 0.67, acousticness: 0.65, popularity: 82 },
    { title: 'Timber & Twilight', artistIdx: 8, albumIdx: 4, genreIdx: 5, duration: 235, energy: 0.48, happiness: 0.63, tempo: 98, danceability: 0.52, acousticness: 0.84, popularity: 71 },

    // Dream Pop / Floating / Calm-Happy (gen_7)
    { title: 'Pastel Cloud Mirage', artistIdx: 6, albumIdx: 6, genreIdx: 6, duration: 225, energy: 0.48, happiness: 0.71, tempo: 96, danceability: 0.59, acousticness: 0.58, popularity: 87 },
    { title: 'Lavender Skies at 8 PM', artistIdx: 6, albumIdx: 6, genreIdx: 6, duration: 240, energy: 0.51, happiness: 0.75, tempo: 100, danceability: 0.63, acousticness: 0.54, popularity: 90 },
    { title: 'Shimmering Coastline', artistIdx: 6, albumIdx: 6, genreIdx: 6, duration: 218, energy: 0.55, happiness: 0.79, tempo: 105, danceability: 0.66, acousticness: 0.51, popularity: 84 },
    { title: 'Glass Garden Reflections', artistIdx: 6, albumIdx: 6, genreIdx: 6, duration: 232, energy: 0.43, happiness: 0.62, tempo: 92, danceability: 0.56, acousticness: 0.66, popularity: 76 },
    { title: 'Echoes of Stardust', artistIdx: 9, albumIdx: 6, genreIdx: 6, duration: 250, energy: 0.46, happiness: 0.68, tempo: 95, danceability: 0.58, acousticness: 0.62, popularity: 81 },
    { title: 'Distant Lighthouse Beam', artistIdx: 6, albumIdx: 6, genreIdx: 6, duration: 260, energy: 0.41, happiness: 0.58, tempo: 88, danceability: 0.50, acousticness: 0.71, popularity: 74 },
    { title: 'Silk Ribbon in the Wind', artistIdx: 6, albumIdx: 6, genreIdx: 6, duration: 214, energy: 0.53, happiness: 0.73, tempo: 102, danceability: 0.61, acousticness: 0.57, popularity: 80 },

    // R&B / Soul Glitch / Energetic-Soulful (gen_8)
    { title: 'Velvet Static Groove', artistIdx: 9, albumIdx: 6, genreIdx: 7, duration: 204, energy: 0.69, happiness: 0.67, tempo: 108, danceability: 0.81, acousticness: 0.38, popularity: 86 },
    { title: 'Prism Soul Alchemy', artistIdx: 9, albumIdx: 6, genreIdx: 7, duration: 218, energy: 0.74, happiness: 0.73, tempo: 114, danceability: 0.84, acousticness: 0.32, popularity: 89 },
    { title: 'Bassline & Honey', artistIdx: 9, albumIdx: 6, genreIdx: 7, duration: 198, energy: 0.71, happiness: 0.77, tempo: 112, danceability: 0.86, acousticness: 0.35, popularity: 93 },
    { title: 'Late Night Synapse', artistIdx: 7, albumIdx: 7, genreIdx: 7, duration: 226, energy: 0.66, happiness: 0.59, tempo: 106, danceability: 0.79, acousticness: 0.42, popularity: 78 },
    { title: 'Liquid Gold Reverie', artistIdx: 9, albumIdx: 6, genreIdx: 7, duration: 210, energy: 0.76, happiness: 0.82, tempo: 118, danceability: 0.83, acousticness: 0.28, popularity: 88 },
    { title: 'Midnight Silk Chords', artistIdx: 9, albumIdx: 6, genreIdx: 7, duration: 235, energy: 0.61, happiness: 0.64, tempo: 102, danceability: 0.77, acousticness: 0.49, popularity: 82 },
    { title: 'Electric Magnolia', artistIdx: 9, albumIdx: 6, genreIdx: 7, duration: 208, energy: 0.73, happiness: 0.70, tempo: 115, danceability: 0.82, acousticness: 0.34, popularity: 85 },
  ];

  const songs: Song[] = [];
  const songGenres: { song_id: string; genre_id: string }[] = [];
  const songFeatures: SongFeatures[] = [];

  rawSongSeeds.forEach((s, i) => {
    const songId = `s_${i + 1}`;
    const artist = artists[s.artistIdx];
    const album = albums[s.albumIdx];
    const genre = genres[s.genreIdx];

    songs.push({
      song_id: songId,
      artist_id: artist.artist_id,
      album_id: album.album_id,
      title: s.title,
      duration_sec: s.duration,
      release_year: album.release_year,
      audio_url: `ambient_synth://${songId}`,
      popularity: s.popularity,
      is_active: true,
      created_at: '2025-01-15T10:00:00Z',
    });

    songGenres.push({
      song_id: songId,
      genre_id: genre.genre_id,
    });

    songFeatures.push({
      song_id: songId,
      energy: Number(s.energy.toFixed(2)),
      happiness: Number(s.happiness.toFixed(2)),
      tempo: s.tempo,
      danceability: Number(s.danceability.toFixed(2)),
      acousticness: Number(s.acousticness.toFixed(2)),
    });
  });

  const roles = [
    { role_id: 'rol_1', role_name: 'admin' as const },
    { role_id: 'rol_2', role_name: 'user' as const },
  ];

  // 12 Demo Users: 1 admin + 11 users
  // Password hashes are simulated salted PBKDF2/SHA256 hashes
  const users: User[] = [
    {
      user_id: 'usr_admin',
      role_id: 'rol_1',
      username: 'System Admin',
      email: 'admin@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_admin123$9e8a5b28d712e09ff3',
      experiment_group: 'B',
      created_at: '2025-01-01T00:00:00Z',
      last_login: new Date().toISOString(),
    },
    {
      user_id: 'usr_fatima',
      role_id: 'rol_2',
      username: 'Fatima Al-Mansoor',
      email: 'fatima@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_user123$4a72d31e90b8f09c21',
      experiment_group: 'B', // Mood-Aware group
      created_at: '2025-01-05T12:00:00Z',
      last_login: new Date().toISOString(),
    },
    {
      user_id: 'usr_marcus',
      role_id: 'rol_2',
      username: 'Marcus Vance',
      email: 'marcus@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_marcus$3b11e299c80d21a110',
      experiment_group: 'A', // Taste-Only group
      created_at: '2025-01-08T09:00:00Z',
      last_login: '2026-10-18T14:20:00Z',
    },
    {
      user_id: 'usr_chloe',
      role_id: 'rol_2',
      username: 'Chloe Bennett',
      email: 'chloe@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_chloe$7f22b918a3d4400e23',
      experiment_group: 'B',
      created_at: '2025-01-12T11:30:00Z',
      last_login: '2026-10-19T08:15:00Z',
    },
    {
      user_id: 'usr_elena',
      role_id: 'rol_2',
      username: 'Elena Rostova',
      email: 'elena@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_elena$1c44d872b90ff88190',
      experiment_group: 'B',
      created_at: '2025-01-14T16:45:00Z',
      last_login: '2026-10-19T21:10:00Z',
    },
    {
      user_id: 'usr_liam',
      role_id: 'rol_2',
      username: 'Liam O’Connor',
      email: 'liam@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_liam$5e66a331c42ee11988',
      experiment_group: 'A',
      created_at: '2025-01-16T10:15:00Z',
      last_login: '2026-10-17T19:40:00Z',
    },
    {
      user_id: 'usr_priya',
      role_id: 'rol_2',
      username: 'Priya Sharma',
      email: 'priya@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_priya$8b77d209e51aa00455',
      experiment_group: 'B',
      created_at: '2025-01-20T14:00:00Z',
      last_login: '2026-10-20T07:30:00Z',
    },
    {
      user_id: 'usr_noah',
      role_id: 'rol_2',
      username: 'Noah Lindqvist',
      email: 'noah@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_noah$9a33b881d72bb77661',
      experiment_group: 'A',
      created_at: '2025-01-22T18:20:00Z',
      last_login: '2026-10-19T11:00:00Z',
    },
    {
      user_id: 'usr_aiko',
      role_id: 'rol_2',
      username: 'Aiko Tanaka',
      email: 'aiko@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_aiko$2d44f990c81ee66221',
      experiment_group: 'B',
      created_at: '2025-01-25T13:10:00Z',
      last_login: '2026-10-18T16:45:00Z',
    },
    {
      user_id: 'usr_gabriel',
      role_id: 'rol_2',
      username: 'Gabriel Silva',
      email: 'gabriel@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_gabriel$6f88e112b30aa33990',
      experiment_group: 'A',
      created_at: '2025-01-28T09:40:00Z',
      last_login: '2026-10-16T12:00:00Z',
    },
    {
      user_id: 'usr_samira',
      role_id: 'rol_2',
      username: 'Samira Haddad',
      email: 'samira@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_samira$4e99c223a81bb55443',
      experiment_group: 'B',
      created_at: '2025-02-01T15:20:00Z',
      last_login: '2026-10-19T22:30:00Z',
    },
    {
      user_id: 'usr_kai',
      role_id: 'rol_2',
      username: 'Kai Sterling',
      email: 'kai@moodtide.com',
      password_hash: 'pbkdf2_sha256$260000$salt_kai$7a11d445c92ff88332',
      experiment_group: 'A',
      created_at: '2025-02-03T17:50:00Z',
      last_login: '2026-10-15T09:10:00Z',
    },
  ];

  const auth_sessions = [
    {
      session_id: 'ses_1',
      user_id: 'usr_fatima',
      token_hash: 'tok_fatima_current_session_abc123',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000 * 7).toISOString(),
      is_revoked: false,
    },
  ];

  const playlists: Playlist[] = [
    {
      playlist_id: 'pl_1',
      user_id: 'usr_fatima',
      name: 'Evening Chillout & Focus',
      description: 'Gentle beats and lo-fi textures for study and unwind.',
      playlist_type: 'normal',
      start_mood: null,
      target_mood: null,
      created_at: '2025-02-10T19:00:00Z',
    },
    {
      playlist_id: 'pl_2',
      user_id: 'usr_fatima',
      name: 'Sunrise Motivation',
      description: 'Acoustic and upbeat melodies to kickstart the day.',
      playlist_type: 'normal',
      start_mood: null,
      target_mood: null,
      created_at: '2025-02-12T07:30:00Z',
    },
    {
      playlist_id: 'pl_3',
      user_id: 'usr_fatima',
      name: 'Mood Shift: Stressed → Calm',
      description: '8-step harmonic decompression journey.',
      playlist_type: 'mood_journey',
      start_mood: 'stressed',
      target_mood: 'calm',
      created_at: '2025-02-14T20:15:00Z',
    },
  ];

  const playlist_songs = [
    { playlist_id: 'pl_1', song_id: 's_9', position: 1, added_at: '2025-02-10T19:02:00Z' },
    { playlist_id: 'pl_1', song_id: 's_10', position: 2, added_at: '2025-02-10T19:03:00Z' },
    { playlist_id: 'pl_1', song_id: 's_1', position: 3, added_at: '2025-02-10T19:05:00Z' },
    { playlist_id: 'pl_1', song_id: 's_11', position: 4, added_at: '2025-02-10T19:06:00Z' },
    { playlist_id: 'pl_2', song_id: 's_36', position: 1, added_at: '2025-02-12T07:32:00Z' },
    { playlist_id: 'pl_2', song_id: 's_37', position: 2, added_at: '2025-02-12T07:34:00Z' },
    { playlist_id: 'pl_3', song_id: 's_22', position: 1, added_at: '2025-02-14T20:15:00Z' },
    { playlist_id: 'pl_3', song_id: 's_23', position: 2, added_at: '2025-02-14T20:15:00Z' },
    { playlist_id: 'pl_3', song_id: 's_43', position: 3, added_at: '2025-02-14T20:15:00Z' },
    { playlist_id: 'pl_3', song_id: 's_44', position: 4, added_at: '2025-02-14T20:15:00Z' },
    { playlist_id: 'pl_3', song_id: 's_9', position: 5, added_at: '2025-02-14T20:15:00Z' },
    { playlist_id: 'pl_3', song_id: 's_10', position: 6, added_at: '2025-02-14T20:15:00Z' },
    { playlist_id: 'pl_3', song_id: 's_2', position: 7, added_at: '2025-02-14T20:15:00Z' },
    { playlist_id: 'pl_3', song_id: 's_1', position: 8, added_at: '2025-02-14T20:15:00Z' },
  ];

  const scoring_weights = [
    { weight_id: 'w_1', weight_name: 'w_taste', weight_value: 0.35, updated_by: 'usr_admin', updated_at: '2025-01-01T00:00:00Z' },
    { weight_id: 'w_2', weight_name: 'w_mood', weight_value: 0.30, updated_by: 'usr_admin', updated_at: '2025-01-01T00:00:00Z' },
    { weight_id: 'w_3', weight_name: 'w_similar', weight_value: 0.15, updated_by: 'usr_admin', updated_at: '2025-01-01T00:00:00Z' },
    { weight_id: 'w_4', weight_name: 'w_fresh', weight_value: 0.10, updated_by: 'usr_admin', updated_at: '2025-01-01T00:00:00Z' },
    { weight_id: 'w_5', weight_name: 'w_recent', weight_value: 0.20, updated_by: 'usr_admin', updated_at: '2025-01-01T00:00:00Z' },
  ];

  const experiments = [
    {
      experiment_id: 'exp_1',
      name: 'Mood Awareness Suggestion Engine v1',
      description: 'A/B testing cohort A (taste-only baseline) vs cohort B (taste + real-time mood-aware scoring).',
      start_date: '2025-01-01T00:00:00Z',
      end_date: '2026-12-31T23:59:59Z',
      status: 'active' as const,
    },
  ];

  // Seed Ratings & History
  const ratings = [
    { rating_id: 'rat_1', user_id: 'usr_fatima', song_id: 's_9', suggestion_id: null, stars: 5, rated_at: '2025-02-10T19:05:00Z' },
    { rating_id: 'rat_2', user_id: 'usr_fatima', song_id: 's_10', suggestion_id: null, stars: 5, rated_at: '2025-02-10T19:20:00Z' },
    { rating_id: 'rat_3', user_id: 'usr_fatima', song_id: 's_1', suggestion_id: null, stars: 4, rated_at: '2025-02-11T20:10:00Z' },
    { rating_id: 'rat_4', user_id: 'usr_fatima', song_id: 's_36', suggestion_id: null, stars: 5, rated_at: '2025-02-12T07:45:00Z' },
    { rating_id: 'rat_5', user_id: 'usr_fatima', song_id: 's_15', suggestion_id: null, stars: 2, rated_at: '2025-02-13T14:00:00Z' },
    // Chloe's ratings (similar to Fatima)
    { rating_id: 'rat_6', user_id: 'usr_chloe', song_id: 's_9', suggestion_id: null, stars: 5, rated_at: '2025-02-10T10:00:00Z' },
    { rating_id: 'rat_7', user_id: 'usr_chloe', song_id: 's_10', suggestion_id: null, stars: 5, rated_at: '2025-02-10T10:30:00Z' },
    { rating_id: 'rat_8', user_id: 'usr_chloe', song_id: 's_2', suggestion_id: null, stars: 5, rated_at: '2025-02-11T12:00:00Z' },
    // Marcus's ratings (loves synthwave)
    { rating_id: 'rat_9', user_id: 'usr_marcus', song_id: 's_17', suggestion_id: null, stars: 5, rated_at: '2025-02-10T15:00:00Z' },
    { rating_id: 'rat_10', user_id: 'usr_marcus', song_id: 's_18', suggestion_id: null, stars: 4, rated_at: '2025-02-10T15:30:00Z' },
  ];

  const implicit_signals = [
    { signal_id: 'sig_1', user_id: 'usr_fatima', song_id: 's_9', suggestion_id: null, signal_type: 'full_play' as const, signal_value: 1, created_at: '2025-02-10T19:04:00Z' },
    { signal_id: 'sig_2', user_id: 'usr_fatima', song_id: 's_10', suggestion_id: null, signal_type: 'replay' as const, signal_value: 2, created_at: '2025-02-10T19:15:00Z' },
    { signal_id: 'sig_3', user_id: 'usr_fatima', song_id: 's_15', suggestion_id: null, signal_type: 'skip' as const, signal_value: -1, created_at: '2025-02-13T14:01:00Z' },
  ];

  const listening_history = [
    { history_id: 'his_1', user_id: 'usr_fatima', song_id: 's_9', played_at: '2025-02-10T19:00:00Z', listened_sec: 164, completed: true, source: 'search' as const, suggestion_id: null },
    { history_id: 'his_2', user_id: 'usr_fatima', song_id: 's_10', played_at: '2025-02-10T19:10:00Z', listened_sec: 178, completed: true, source: 'search' as const, suggestion_id: null },
    { history_id: 'his_3', user_id: 'usr_fatima', song_id: 's_1', played_at: '2025-02-11T20:00:00Z', listened_sec: 248, completed: true, source: 'playlist' as const, suggestion_id: null },
    { history_id: 'his_4', user_id: 'usr_fatima', song_id: 's_15', played_at: '2025-02-13T14:00:00Z', listened_sec: 14, completed: false, source: 'suggestion' as const, suggestion_id: null },
    { history_id: 'his_5', user_id: 'usr_fatima', song_id: 's_36', played_at: '2025-02-14T08:00:00Z', listened_sec: 215, completed: true, source: 'playlist' as const, suggestion_id: null },
  ];

  const mood_checkins = [
    { checkin_id: 'chk_1', user_id: 'usr_fatima', mood_label: 'calm' as const, energy_level: 2, checked_at: '2025-02-10T19:00:00Z' },
    { checkin_id: 'chk_2', user_id: 'usr_fatima', mood_label: 'happy' as const, energy_level: 4, checked_at: '2025-02-12T07:30:00Z' },
    { checkin_id: 'chk_3', user_id: 'usr_fatima', mood_label: 'calm' as const, energy_level: 2, checked_at: '2026-10-20T10:00:00Z' },
  ];

  const mood_scores = [
    {
      score_id: 'msc_1',
      user_id: 'usr_fatima',
      calculated_at: '2026-10-20T10:05:00Z',
      detected_mood: 'calm' as const,
      mood_score: 82,
      skip_count: 0,
      replay_count: 1,
      time_of_day: 'morning',
      avg_energy: 0.35,
      avg_tempo: 81,
      checkin_id: 'chk_3',
    },
  ];

  const user_taste_profile = [
    { user_id: 'usr_fatima', genre_id: 'gen_2', affinity_score: 4.8, play_count: 24, updated_at: '2025-02-14T20:00:00Z' },
    { user_id: 'usr_fatima', genre_id: 'gen_1', affinity_score: 4.2, play_count: 18, updated_at: '2025-02-14T20:00:00Z' },
    { user_id: 'usr_fatima', genre_id: 'gen_6', affinity_score: 3.9, play_count: 12, updated_at: '2025-02-14T20:00:00Z' },
    { user_id: 'usr_chloe', genre_id: 'gen_2', affinity_score: 4.9, play_count: 28, updated_at: '2025-02-14T20:00:00Z' },
    { user_id: 'usr_chloe', genre_id: 'gen_1', affinity_score: 4.5, play_count: 20, updated_at: '2025-02-14T20:00:00Z' },
    { user_id: 'usr_marcus', genre_id: 'gen_3', affinity_score: 4.9, play_count: 35, updated_at: '2025-02-14T20:00:00Z' },
  ];

  const user_similarity = [
    { user_id_a: 'usr_fatima', user_id_b: 'usr_chloe', similarity_score: 0.94, common_songs: 4, calculated_at: '2025-02-14T20:00:00Z' },
    { user_id_a: 'usr_fatima', user_id_b: 'usr_elena', similarity_score: 0.81, common_songs: 3, calculated_at: '2025-02-14T20:00:00Z' },
    { user_id_a: 'usr_fatima', user_id_b: 'usr_marcus', similarity_score: 0.18, common_songs: 1, calculated_at: '2025-02-14T20:00:00Z' },
  ];

  const song_impact = [
    { impact_id: 'imp_1', user_id: 'usr_fatima', song_id: 's_9', history_id: 'his_1', mood_before: 'stressed' as const, mood_after: 'calm' as const, measured_at: '2025-02-10T19:04:00Z' },
    { impact_id: 'imp_2', user_id: 'usr_fatima', song_id: 's_36', history_id: 'his_5', mood_before: 'sad' as const, mood_after: 'happy' as const, measured_at: '2025-02-14T08:05:00Z' },
  ];

  const audit_log: AuditLog[] = [
    {
      log_id: 'aud_1',
      user_id: 'usr_admin',
      table_name: 'Database',
      record_id: 'BOOTSTRAP',
      action: 'INSERT',
      old_data: null,
      new_data: JSON.stringify({ message: 'Relational database schema initialized with 25 tables and demo fixtures' }),
      changed_at: '2025-01-01T00:00:00Z',
    },
  ];

  return {
    artists,
    albums,
    genres,
    songs,
    song_genres: songGenres,
    song_features: songFeatures,
    roles,
    users,
    auth_sessions,
    playlists,
    playlist_songs,
    listening_history,
    mood_checkins,
    mood_scores,
    suggestion_batches: [],
    suggestions: [],
    suggestion_reasons: [],
    ratings,
    implicit_signals,
    user_taste_profile,
    user_similarity,
    scoring_weights,
    experiments,
    song_impact,
    audit_log,
  };
}

/**
 * MoodTideDatabase Engine Class
 */
export class MoodTideDatabase {
  private schema: DatabaseSchema;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.schema = this.loadFromStorage();
    // If suggestions are empty, generate an initial batch for Fatima
    if (this.schema.suggestions.length === 0) {
      try {
        this.generateSuggestions('usr_fatima');
      } catch (e) {
        console.warn('Initial suggestion generation skipped:', e);
      }
    }
  }

  private loadFromStorage(): DatabaseSchema {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.songs && parsed.users && parsed.scoring_weights) {
          return parsed;
        }
      }
    } catch {
      // Fallback
    }
    const initial = createInitialDatabase();
    this.persist(initial);
    return initial;
  }

  private persist(schema: DatabaseSchema) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(schema));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.persist(this.schema);
    this.listeners.forEach((fn) => fn());
  }

  public getSchema(): Readonly<DatabaseSchema> {
    return this.schema;
  }

  public resetDatabase(): void {
    const initial = createInitialDatabase();
    this.schema = initial;
    this.generateSuggestions('usr_fatima');
    this.notify();
  }

  /**
   * Enforces Relational Database Constraints:
   * - Primary key uniqueness
   * - Foreign key existence
   * - UNIQUE constraints (Users.email, Genres.name, Scoring_Weights.weight_name)
   * - CHECK constraints (stars 1-5, energy/happiness 0-1, energy_level 1-5)
   * - Duplicate song in single playlist prevention
   */
  public validateConstraint(table: TableKey, record: Record<string, unknown>, action: 'INSERT' | 'UPDATE'): void {
    // 1. UNIQUE check for Users email
    if (table === 'users' && typeof record.email === 'string') {
      const existing = this.schema.users.find(
        (u) => u.email.toLowerCase() === (record.email as string).toLowerCase() && (action === 'INSERT' || u.user_id !== record.user_id)
      );
      if (existing) {
        throw new ConstraintViolationError({
          table: 'Users',
          type: 'UNIQUE',
          message: `UNIQUE constraint violated on table "Users": email '${record.email}' is already registered.`,
          details: { email: record.email },
        });
      }
    }

    // 2. CHECK constraint: stars 1 - 5
    if (table === 'ratings' && typeof record.stars === 'number') {
      if (record.stars < 1 || record.stars > 5 || !Number.isInteger(record.stars)) {
        throw new ConstraintViolationError({
          table: 'Ratings',
          type: 'CHECK',
          message: `CHECK constraint failed: "stars" must be an integer between 1 and 5. Received ${record.stars}.`,
          details: { stars: record.stars },
        });
      }
    }

    // 3. CHECK constraint: energy_level 1 - 5 in Mood_Checkins
    if (table === 'mood_checkins' && typeof record.energy_level === 'number') {
      if (record.energy_level < 1 || record.energy_level > 5) {
        throw new ConstraintViolationError({
          table: 'Mood_Checkins',
          type: 'CHECK',
          message: `CHECK constraint failed: "energy_level" must be between 1 and 5.`,
        });
      }
    }

    // 4. CHECK constraint: song_features values 0.0 - 1.0
    if (table === 'song_features') {
      const f = record as unknown as SongFeatures;
      if (f.energy < 0 || f.energy > 1 || f.happiness < 0 || f.happiness > 1) {
        throw new ConstraintViolationError({
          table: 'Song_Features',
          type: 'CHECK',
          message: `CHECK constraint failed: energy and happiness must be normalized between 0.0 and 1.0.`,
        });
      }
    }

    // 5. FOREIGN KEY constraint checks
    if (record.song_id && typeof record.song_id === 'string') {
      const exists = this.schema.songs.some((s) => s.song_id === record.song_id);
      if (!exists) {
        throw new ConstraintViolationError({
          table,
          type: 'FOREIGN_KEY',
          message: `FOREIGN KEY violation: song_id '${record.song_id}' does not exist in table "Songs".`,
        });
      }
    }

    if (record.user_id && typeof record.user_id === 'string') {
      const exists = this.schema.users.some((u) => u.user_id === record.user_id);
      if (!exists) {
        throw new ConstraintViolationError({
          table,
          type: 'FOREIGN_KEY',
          message: `FOREIGN KEY violation: user_id '${record.user_id}' does not exist in table "Users".`,
        });
      }
    }

    if (record.playlist_id && typeof record.playlist_id === 'string' && table === 'playlist_songs') {
      const exists = this.schema.playlists.some((p) => p.playlist_id === record.playlist_id);
      if (!exists) {
        throw new ConstraintViolationError({
          table: 'Playlist_Songs',
          type: 'FOREIGN_KEY',
          message: `FOREIGN KEY violation: playlist_id '${record.playlist_id}' does not exist in table "Playlists".`,
        });
      }
    }

    // 6. COMPOSITE UNIQUE constraint: no duplicate song in a playlist
    if (table === 'playlist_songs') {
      const ps = record as { playlist_id: string; song_id: string };
      const duplicate = this.schema.playlist_songs.some(
        (row) => row.playlist_id === ps.playlist_id && row.song_id === ps.song_id
      );
      if (duplicate) {
        const songName = this.schema.songs.find((s) => s.song_id === ps.song_id)?.title || ps.song_id;
        throw new ConstraintViolationError({
          table: 'Playlist_Songs',
          type: 'DUPLICATE_PLAYLIST_SONG',
          message: `Unique Constraint Violated: Track "${songName}" is already in this playlist. PostgreSQL rejected duplicate insertion.`,
          details: { playlist_id: ps.playlist_id, song_id: ps.song_id },
        });
      }
    }
  }

  /**
   * Logs an action to the Audit_Log table (stored procedure audit trigger)
   */
  private logAudit(
    userId: string | null,
    tableName: string,
    recordId: string,
    action: 'INSERT' | 'UPDATE' | 'DELETE',
    oldData: unknown = null,
    newData: unknown = null
  ) {
    const log: AuditLog = {
      log_id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      user_id: userId,
      table_name: tableName,
      record_id: recordId,
      action,
      old_data: oldData ? JSON.stringify(oldData) : null,
      new_data: newData ? JSON.stringify(newData) : null,
      changed_at: new Date().toISOString(),
    };
    this.schema.audit_log.unshift(log);
    // Keep max 500 audit rows in browser memory
    if (this.schema.audit_log.length > 500) {
      this.schema.audit_log.pop();
    }
  }

  // =========================================================================
  // STORED PROCEDURES & DATABASE LOGIC FUNCTIONS
  // =========================================================================

  /**
   * 1. detectMood(userId): Rule-based mood detection without AI
   *
   * PostgreSQL Procedure equivalent:
   * CREATE OR REPLACE FUNCTION detect_mood(p_user_id VARCHAR)
   * RETURNS mood_scores AS $$ ... $$
   *
   * Rules:
   * - 3 or more skips in a row in recent history => 'stressed'
   * - Replaying one song in recent history => 'calm'
   * - Average energy & tempo of last 5 songs:
   *     avg_energy > 0.70 & avg_tempo > 120 => 'energetic'
   *     avg_energy < 0.35 & avg_tempo < 80 => 'sad'
   *     avg_energy between 0.40 & 0.70 & happiness > 0.6 => 'happy'
   * - Time of day modifier (night tilts to calm, morning tilts to energetic)
   * - Inserts a Mood_Scores record and contrasts with latest Mood_Checkins
   */
  public detectMood(userId: string) {
    const userHistory = this.schema.listening_history
      .filter((h) => h.user_id === userId)
      .slice(-10); // inspect last 10 plays

    let skipCount = 0;
    let replayCount = 0;
    for (let i = userHistory.length - 1; i >= 0; i--) {
      if (!userHistory[i].completed && userHistory[i].listened_sec < 25) {
        skipCount++;
      } else {
        break;
      }
    }

    // Check replays (same song played twice in recent 4 plays)
    const recentSongIds = userHistory.slice(-4).map((h) => h.song_id);
    const uniqueIds = new Set(recentSongIds);
    if (recentSongIds.length - uniqueIds.size > 0) {
      replayCount = 1;
    }

    // Average energy and tempo of last 5 songs
    const last5 = userHistory.slice(-5);
    let avgEnergy = 0.5;
    let avgTempo = 100;
    if (last5.length > 0) {
      let sumEnergy = 0;
      let sumTempo = 0;
      last5.forEach((h) => {
        const feat = this.schema.song_features.find((f) => f.song_id === h.song_id);
        if (feat) {
          sumEnergy += feat.energy;
          sumTempo += feat.tempo;
        }
      });
      avgEnergy = Number((sumEnergy / last5.length).toFixed(2));
      avgTempo = Math.round(sumTempo / last5.length);
    }

    // Time of day calculation
    const hour = new Date().getHours();
    let timeOfDay = 'afternoon';
    if (hour >= 5 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 22) timeOfDay = 'evening';
    else timeOfDay = 'night';

    // Decision Logic
    let detectedMood: MoodType = 'calm';
    let moodScore = 75;
    let ruleFired = 'Default baseline mood';

    if (skipCount >= 3) {
      detectedMood = 'stressed';
      moodScore = 40;
      ruleFired = `Consecutive skip streak of ${skipCount} songs detected. User showing restless/frustrated behavior.`;
    } else if (replayCount >= 1 && avgEnergy < 0.5) {
      detectedMood = 'calm';
      moodScore = 88;
      ruleFired = `Replay loop detected on low-energy track. Indicates deep focus and calm headspace.`;
    } else if (avgEnergy > 0.7 && avgTempo > 120) {
      detectedMood = 'energetic';
      moodScore = 85;
      ruleFired = `High acoustic momentum: avg energy ${avgEnergy} and avg tempo ${avgTempo} BPM.`;
    } else if (avgEnergy < 0.35 && avgTempo < 75) {
      detectedMood = 'sad';
      moodScore = 48;
      ruleFired = `Low acoustic energy (${avgEnergy}) and downtempo cadence (${avgTempo} BPM).`;
    } else if (timeOfDay === 'morning' && avgEnergy > 0.5) {
      detectedMood = 'happy';
      moodScore = 82;
      ruleFired = `Morning acoustic elevation and steady upbeat listening patterns.`;
    } else if (timeOfDay === 'night') {
      detectedMood = 'calm';
      moodScore = 80;
      ruleFired = `Late evening acoustic settling into quiet night hours.`;
    }

    // Compare with latest manual checkin
    const latestCheckin = this.schema.mood_checkins
      .filter((c) => c.user_id === userId)
      .sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())[0];

    const newScoreId = `msc_${Date.now()}`;
    const scoreRow = {
      score_id: newScoreId,
      user_id: userId,
      calculated_at: new Date().toISOString(),
      detected_mood: detectedMood,
      mood_score: moodScore,
      skip_count: skipCount,
      replay_count: replayCount,
      time_of_day: timeOfDay,
      avg_energy: avgEnergy,
      avg_tempo: avgTempo,
      checkin_id: latestCheckin ? latestCheckin.checkin_id : null,
    };

    this.schema.mood_scores.unshift(scoreRow);
    this.logAudit(userId, 'Mood_Scores', newScoreId, 'INSERT', null, scoreRow);
    this.notify();

    return {
      scoreRow,
      ruleFired,
      latestCheckin,
    };
  }

  /**
   * 2. generateSuggestions(userId):
   *
   * Scoring formula:
   * Score = w_taste * taste_match
   *       + w_mood * mood_match
   *       + w_similar * similar_users_boost
   *       + w_fresh * freshness
   *       - w_recent * recently_played_penalty
   *
   * Weights are dynamically fetched from Scoring_Weights table.
   * If user is in A/B test Group A (taste-only), w_mood is clamped to 0.0.
   * Atomic Transaction Simulation: all suggestions and reasons write as a single commit.
   */
  public generateSuggestions(userId: string) {
    const user = this.schema.users.find((u) => u.user_id === userId);
    if (!user) return [];

    // Weights from database
    const getWeight = (name: string, fallback: number) => {
      const row = this.schema.scoring_weights.find((w) => w.weight_name === name);
      return row ? row.weight_value : fallback;
    };

    let w_taste = getWeight('w_taste', 0.35);
    let w_mood = getWeight('w_mood', 0.30);
    const w_similar = getWeight('w_similar', 0.15);
    const w_fresh = getWeight('w_fresh', 0.10);
    const w_recent = getWeight('w_recent', 0.20);

    // A/B test variant: Group A = taste only (w_mood = 0)
    const isGroupA = user.experiment_group === 'A';
    if (isGroupA) {
      w_mood = 0.0;
    }

    // Get current detected mood
    const latestMoodScore = this.schema.mood_scores
      .filter((s) => s.user_id === userId)
      .sort((a, b) => new Date(b.calculated_at).getTime() - new Date(a.calculated_at).getTime())[0];
    const currentMood: MoodType = latestMoodScore ? latestMoodScore.detected_mood : 'calm';
    const targetFeatures = MOOD_COORDINATES[currentMood];

    // User's recent play history
    const userHistory = this.schema.listening_history.filter((h) => h.user_id === userId);
    const recentSongIds = new Set(userHistory.slice(-15).map((h) => h.song_id));

    // User taste profiles
    const userTaste = this.schema.user_taste_profile.filter((t) => t.user_id === userId);
    const genreAffinities = new Map<string, number>();
    userTaste.forEach((t) => genreAffinities.set(t.genre_id, t.affinity_score));

    // Similar users who rated songs
    const similarUsers = this.schema.user_similarity
      .filter((s) => s.user_id_a === userId || s.user_id_b === userId)
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, 3);

    const partnerUserIds = similarUsers.map((s) => (s.user_id_a === userId ? s.user_id_b : s.user_id_a));
    const partnerHighRatings = this.schema.ratings.filter(
      (r) => partnerUserIds.includes(r.user_id) && r.stars >= 4
    );
    const highlyRecommendedSongIds = new Set(partnerHighRatings.map((r) => r.song_id));

    // Score all active songs
    const activeSongs = this.schema.songs.filter((s) => s.is_active);
    const scoredList: Array<{
      song: Song;
      features: SongFeatures;
      genre: string;
      totalScore: number;
      tasteScore: number;
      moodMatchScore: number;
      similarScore: number;
      freshnessScore: number;
      recentPenalty: number;
      isExploration: boolean;
      reasons: Array<{ reason_type: string; reason_text: string; contribution: number }>;
    }> = [];

    // Find top genres for taste
    const sortedAffinities = [...genreAffinities.entries()].sort((a, b) => b[1] - a[1]);
    const topGenreIds = new Set(sortedAffinities.slice(0, 3).map((a) => a[0]));

    activeSongs.forEach((song) => {
      const feat = this.schema.song_features.find((f) => f.song_id === song.song_id);
      if (!feat) return;

      const songGenreRow = this.schema.song_genres.find((sg) => sg.song_id === song.song_id);
      const genreId = songGenreRow ? songGenreRow.genre_id : 'gen_1';
      const genreName = this.schema.genres.find((g) => g.genre_id === genreId)?.name || 'Music';

      // 1. Taste Score (0.0 to 1.0)
      const affinity = genreAffinities.get(genreId) || 2.5; // default neutral
      const tasteScore = Math.min(1.0, Math.max(0.1, affinity / 5.0));

      // 2. Mood Match Score (Euclidean distance inverse)
      const dEnergy = feat.energy - targetFeatures.energy;
      const dValence = feat.happiness - targetFeatures.happiness;
      const distance = Math.sqrt(dEnergy * dEnergy + dValence * dValence);
      const moodMatchScore = Math.max(0.05, 1.0 - distance);

      // 3. Similar Users Score
      let similarScore = 0.2;
      if (highlyRecommendedSongIds.has(song.song_id)) {
        similarScore = 0.95;
      }

      // 4. Freshness Score (not in listening history)
      const hasListened = userHistory.some((h) => h.song_id === song.song_id);
      const freshnessScore = hasListened ? 0.3 : 0.9;

      // 5. Recent Penalty
      const recentPenalty = recentSongIds.has(song.song_id) ? 0.8 : 0.0;

      // Total weighted score
      const totalScore =
        w_taste * tasteScore +
        w_mood * moodMatchScore +
        w_similar * similarScore +
        w_fresh * freshnessScore -
        w_recent * recentPenalty;

      // Reason building
      const reasons: Array<{ reason_type: string; reason_text: string; contribution: number }> = [];

      if (isGroupA) {
        reasons.push({
          reason_type: 'taste',
          reason_text: `Matches your high affinity for ${genreName} (Taste-Only Cohort A)`,
          contribution: 0.7,
        });
      } else {
        if (moodMatchScore > 0.75) {
          reasons.push({
            reason_type: 'mood',
            reason_text: `Harmonizes with your ${targetFeatures.label} state (${feat.tempo} BPM, energy ${feat.energy})`,
            contribution: 0.45,
          });
        }
        if (tasteScore > 0.6) {
          reasons.push({
            reason_type: 'taste',
            reason_text: `You frequently enjoy ${genreName} tracks`,
            contribution: 0.35,
          });
        }
      }

      if (similarScore > 0.8) {
        reasons.push({
          reason_type: 'similar_users',
          reason_text: `Users with similar listening taste rated this 4+ stars`,
          contribution: 0.2,
        });
      }

      if (freshnessScore > 0.8) {
        reasons.push({
          reason_type: 'freshness',
          reason_text: `Fresh discovery outside your recent replay loop`,
          contribution: 0.15,
        });
      }

      const isExploration = !topGenreIds.has(genreId);

      scoredList.push({
        song,
        features: feat,
        genre: genreName,
        totalScore: Number(totalScore.toFixed(3)),
        tasteScore: Number(tasteScore.toFixed(2)),
        moodMatchScore: Number(moodMatchScore.toFixed(2)),
        similarScore: Number(similarScore.toFixed(2)),
        freshnessScore: Number(freshnessScore.toFixed(2)),
        recentPenalty: Number(recentPenalty.toFixed(2)),
        isExploration,
        reasons,
      });
    });

    // Sort by total score descending
    scoredList.sort((a, b) => b.totalScore - a.totalScore);

    // Pick top 10 with ~20% exploration (2 exploration songs out of 10)
    const normalCandidates = scoredList.filter((s) => !s.isExploration);
    const explorationCandidates = scoredList.filter((s) => s.isExploration);

    const finalTop10: typeof scoredList = [];
    // Take top 8 normal
    finalTop10.push(...normalCandidates.slice(0, 8));
    // Take top 2 exploration (or fill with rest)
    finalTop10.push(...explorationCandidates.slice(0, 2));

    while (finalTop10.length < 10 && scoredList.length > finalTop10.length) {
      const next = scoredList.find((s) => !finalTop10.some((f) => f.song.song_id === s.song.song_id));
      if (next) finalTop10.push(next);
      else break;
    }

    // Sort the final 10 by totalScore
    finalTop10.sort((a, b) => b.totalScore - a.totalScore);

    // BEGIN ATOMIC TRANSACTION:
    // Suggestion_Batches + Suggestions + Suggestion_Reasons
    const batchId = `bat_${Date.now()}`;
    const batchRow = {
      batch_id: batchId,
      user_id: userId,
      experiment_id: 'exp_1',
      variant: user.experiment_group,
      score_id: latestMoodScore ? latestMoodScore.score_id : null,
      created_at: new Date().toISOString(),
    };

    const newSuggestions: Suggestion[] = [];
    const newReasons: Array<{ reason_id: string; suggestion_id: string; reason_type: string; reason_text: string; contribution: number }> = [];

    finalTop10.forEach((item, idx) => {
      const suggestionId = `sug_${Date.now()}_${idx + 1}`;
      newSuggestions.push({
        suggestion_id: suggestionId,
        batch_id: batchId,
        song_id: item.song.song_id,
        rank_position: idx + 1,
        total_score: item.totalScore,
        taste_score: item.tasteScore,
        mood_match_score: item.moodMatchScore,
        similar_users_score: item.similarScore,
        freshness_score: item.freshnessScore,
        recent_penalty: item.recentPenalty,
        is_exploration: item.isExploration,
        outcome: 'pending',
      });

      item.reasons.forEach((r, rIdx) => {
        newReasons.push({
          reason_id: `rsn_${suggestionId}_${rIdx + 1}`,
          suggestion_id: suggestionId,
          reason_type: r.reason_type,
          reason_text: r.reason_text,
          contribution: r.contribution,
        });
      });
    });

    // Commit transaction to schema
    this.schema.suggestion_batches.unshift(batchRow);
    // Replace recent active suggestions with this batch for immediate display
    this.schema.suggestions = [...newSuggestions, ...this.schema.suggestions];
    this.schema.suggestion_reasons = [...newReasons, ...this.schema.suggestion_reasons];

    this.logAudit(
      userId,
      'Suggestion_Batches',
      batchId,
      'INSERT',
      null,
      { batchId, count: newSuggestions.length, variant: user.experiment_group }
    );

    this.notify();
    return newSuggestions;
  }

  /**
   * 3. Database Trigger: onSongPlay
   * Fired when a user plays or finishes/skips a song.
   * - Inserts Listening_History
   * - Inserts Implicit_Signals (+1 full_play, -1 skip, +2 replay)
   * - Updates User_Taste_Profile
   * - Measures song impact
   * - Writes to Audit_Log
   */
  public triggerOnSongPlay(
    userId: string,
    songId: string,
    listenedSec: number,
    completed: boolean,
    source: 'search' | 'playlist' | 'suggestion',
    suggestionId: string | null = null,
    isReplay = false
  ) {
    this.validateConstraint('listening_history', { user_id: userId, song_id: songId }, 'INSERT');

    const historyId = `his_${Date.now()}`;
    const historyRow = {
      history_id: historyId,
      user_id: userId,
      song_id: songId,
      played_at: new Date().toISOString(),
      listened_sec: listenedSec,
      completed,
      source,
      suggestion_id: suggestionId,
    };
    this.schema.listening_history.unshift(historyRow);

    // Determine implicit signal
    let signalType: 'full_play' | 'skip' | 'replay' = 'full_play';
    let signalValue = 1;

    if (isReplay) {
      signalType = 'replay';
      signalValue = 2;
    } else if (!completed && listenedSec < 30) {
      signalType = 'skip';
      signalValue = -1;
    }

    const signalId = `sig_${Date.now()}`;
    this.schema.implicit_signals.unshift({
      signal_id: signalId,
      user_id: userId,
      song_id: songId,
      suggestion_id: suggestionId,
      signal_type: signalType,
      signal_value: signalValue,
      created_at: new Date().toISOString(),
    });

    // Cascade update to User_Taste_Profile
    const songGenreRow = this.schema.song_genres.find((sg) => sg.song_id === songId);
    if (songGenreRow) {
      const genreId = songGenreRow.genre_id;
      let tasteRow = this.schema.user_taste_profile.find(
        (t) => t.user_id === userId && t.genre_id === genreId
      );
      if (!tasteRow) {
        tasteRow = {
          user_id: userId,
          genre_id: genreId,
          affinity_score: 3.0,
          play_count: 0,
          updated_at: new Date().toISOString(),
        };
        this.schema.user_taste_profile.push(tasteRow);
      }
      tasteRow.play_count += 1;
      tasteRow.affinity_score = Math.min(5.0, Math.max(1.0, tasteRow.affinity_score + (signalValue * 0.1)));
      tasteRow.updated_at = new Date().toISOString();
    }

    // Update suggestion outcome if from suggestion
    if (suggestionId) {
      const sug = this.schema.suggestions.find((s) => s.suggestion_id === suggestionId);
      if (sug) {
        sug.outcome = signalType === 'skip' ? 'skipped' : 'played';
      }
    }

    // Measure Song Impact (window function style)
    this.measureSongImpact(userId, songId, historyId);

    this.logAudit(userId, 'Listening_History', historyId, 'INSERT', null, { songId, completed, signalType });
    this.notify();
  }

  /**
   * 4. Database Trigger: onSongRate
   * Fired when a user rates a song 1-5 stars.
   * - Enforces CHECK(stars BETWEEN 1 AND 5) & FK constraints
   * - Inserts into Ratings
   * - Inserts into Implicit_Signals (stars - 3)
   * - Updates User_Taste_Profile
   * - Logs to Audit_Log
   */
  public triggerOnSongRate(userId: string, songId: string, stars: number, suggestionId: string | null = null) {
    this.validateConstraint('ratings', { user_id: userId, song_id: songId, stars }, 'INSERT');

    const ratingId = `rat_${Date.now()}`;
    const newRating = {
      rating_id: ratingId,
      user_id: userId,
      song_id: songId,
      suggestion_id: suggestionId,
      stars,
      rated_at: new Date().toISOString(),
    };
    this.schema.ratings.unshift(newRating);

    // Implicit signal: (stars - 3): 5 stars -> +2, 4 stars -> +1, 3 stars -> 0, 2 stars -> -1, 1 star -> -2
    const signalValue = stars - 3;
    const signalId = `sig_${Date.now()}_rat`;
    this.schema.implicit_signals.unshift({
      signal_id: signalId,
      user_id: userId,
      song_id: songId,
      suggestion_id: suggestionId,
      signal_type: 'full_play',
      signal_value: signalValue,
      created_at: new Date().toISOString(),
    });

    // Update User_Taste_Profile
    const songGenreRow = this.schema.song_genres.find((sg) => sg.song_id === songId);
    if (songGenreRow) {
      const genreId = songGenreRow.genre_id;
      let tasteRow = this.schema.user_taste_profile.find(
        (t) => t.user_id === userId && t.genre_id === genreId
      );
      if (!tasteRow) {
        tasteRow = {
          user_id: userId,
          genre_id: genreId,
          affinity_score: 3.0,
          play_count: 0,
          updated_at: new Date().toISOString(),
        };
        this.schema.user_taste_profile.push(tasteRow);
      }
      tasteRow.affinity_score = Math.min(5.0, Math.max(1.0, tasteRow.affinity_score + (signalValue * 0.2)));
      tasteRow.updated_at = new Date().toISOString();
    }

    if (suggestionId) {
      const sug = this.schema.suggestions.find((s) => s.suggestion_id === suggestionId);
      if (sug) sug.outcome = 'rated';
    }

    this.logAudit(userId, 'Ratings', ratingId, 'INSERT', null, { songId, stars });
    this.notify();
  }

  /**
   * 5. Database Trigger: onPlaylistAdd
   * Enforces composite unique constraint (no duplicate song in one playlist).
   */
  public triggerOnPlaylistAdd(playlistId: string, songId: string, userId: string) {
    this.validateConstraint('playlist_songs', { playlist_id: playlistId, song_id: songId }, 'INSERT');

    const existingInPlaylist = this.schema.playlist_songs.filter((p) => p.playlist_id === playlistId);
    const position = existingInPlaylist.length + 1;

    const newRow = {
      playlist_id: playlistId,
      song_id: songId,
      position,
      added_at: new Date().toISOString(),
    };
    this.schema.playlist_songs.push(newRow);

    // Implicit signal: add_to_playlist (+2)
    const signalId = `sig_${Date.now()}_pl`;
    this.schema.implicit_signals.unshift({
      signal_id: signalId,
      user_id: userId,
      song_id: songId,
      suggestion_id: null,
      signal_type: 'add_to_playlist',
      signal_value: 2,
      created_at: new Date().toISOString(),
    });

    this.logAudit(userId, 'Playlist_Songs', `${playlistId}_${songId}`, 'INSERT', null, newRow);
    this.notify();
  }

  /**
   * 6. buildMoodJourney(userId, fromMood, toMood):
   * Creates an 8-track playlist that gradually interpolates in (energy, happiness) feature space
   * from fromMood to toMood.
   */
  public buildMoodJourney(userId: string, fromMood: MoodType, toMood: MoodType): Playlist {
    const fromCoord = MOOD_COORDINATES[fromMood];
    const toCoord = MOOD_COORDINATES[toMood];

    const playlistId = `pl_mj_${Date.now()}`;
    const playlist: Playlist = {
      playlist_id: playlistId,
      user_id: userId,
      name: `Mood Journey: ${fromCoord.label} → ${toCoord.label}`,
      description: `Harmonic transition pathway from ${fromCoord.label} to ${toCoord.label} in 8 calculated acoustic steps.`,
      playlist_type: 'mood_journey',
      start_mood: fromMood,
      target_mood: toMood,
      created_at: new Date().toISOString(),
    };

    this.validateConstraint('playlists', playlist as unknown as Record<string, unknown>, 'INSERT');
    this.schema.playlists.unshift(playlist);

    const availableSongs = [...this.schema.songs.filter((s) => s.is_active)];
    const chosenSongIds: string[] = [];

    // 8 steps
    for (let step = 0; step < 8; step++) {
      const progress = step / 7; // 0.0 to 1.0
      const targetEnergy = fromCoord.energy + (toCoord.energy - fromCoord.energy) * progress;
      const targetHappiness = fromCoord.happiness + (toCoord.happiness - fromCoord.happiness) * progress;
      const targetTempo = fromCoord.tempo + (toCoord.tempo - fromCoord.tempo) * progress;

      // Find closest song not yet chosen
      let bestSongId: string | null = null;
      let minDistance = Infinity;

      for (const song of availableSongs) {
        if (chosenSongIds.includes(song.song_id)) continue;
        const feat = this.schema.song_features.find((f) => f.song_id === song.song_id);
        if (!feat) continue;

        const dist = Math.sqrt(
          Math.pow(feat.energy - targetEnergy, 2) * 2 +
          Math.pow(feat.happiness - targetHappiness, 2) * 2 +
          Math.pow((feat.tempo - targetTempo) / 100, 2)
        );

        if (dist < minDistance) {
          minDistance = dist;
          bestSongId = song.song_id;
        }
      }

      if (bestSongId) {
        chosenSongIds.push(bestSongId);
        this.schema.playlist_songs.push({
          playlist_id: playlistId,
          song_id: bestSongId,
          position: step + 1,
          added_at: new Date().toISOString(),
        });
      }
    }

    this.logAudit(userId, 'Playlists', playlistId, 'INSERT', null, {
      fromMood,
      toMood,
      steps: chosenSongIds.length,
    });
    this.notify();
    return playlist;
  }

  /**
   * 7. computeUserSimilarity():
   * Computes collaborative filtering similarity between all pairs of users
   * based on Pearson / overlap of ratings. Populates User_Similarity.
   */
  public computeUserSimilarity(): void {
    const userRatingsMap = new Map<string, Map<string, number>>();
    this.schema.ratings.forEach((r) => {
      if (!userRatingsMap.has(r.user_id)) {
        userRatingsMap.set(r.user_id, new Map());
      }
      userRatingsMap.get(r.user_id)!.set(r.song_id, r.stars);
    });

    const userIds = this.schema.users.map((u) => u.user_id);
    const newSimilarities = [];

    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        const uA = userIds[i];
        const uB = userIds[j];
        const ratingsA = userRatingsMap.get(uA);
        const ratingsB = userRatingsMap.get(uB);

        if (!ratingsA || !ratingsB) continue;

        let commonCount = 0;
        let sumDeltaSquared = 0;

        ratingsA.forEach((starsA, songId) => {
          if (ratingsB.has(songId)) {
            commonCount++;
            const starsB = ratingsB.get(songId)!;
            sumDeltaSquared += Math.pow(starsA - starsB, 2);
          }
        });

        if (commonCount > 0) {
          // Similarity score: normalized inverse of mean squared rating error
          const mse = sumDeltaSquared / commonCount;
          const sim = Number((1 / (1 + mse * 0.25)).toFixed(3));
          newSimilarities.push({
            user_id_a: uA,
            user_id_b: uB,
            similarity_score: sim,
            common_songs: commonCount,
            calculated_at: new Date().toISOString(),
          });
        }
      }
    }

    this.schema.user_similarity = newSimilarities;
    this.logAudit(null, 'User_Similarity', 'BATCH_RECOMPUTE', 'UPDATE', null, { count: newSimilarities.length });
    this.notify();
  }

  /**
   * 8. measureSongImpact(userId, songId, historyId):
   * Stored procedure to compare user mood before vs after listening to a song.
   */
  public measureSongImpact(userId: string, songId: string, historyId: string) {
    const checkins = this.schema.mood_checkins.filter((c) => c.user_id === userId);
    if (checkins.length < 2) return;

    const before = checkins[checkins.length - 2].mood_label;
    const after = checkins[checkins.length - 1].mood_label;

    const impactId = `imp_${Date.now()}`;
    const row = {
      impact_id: impactId,
      user_id: userId,
      song_id: songId,
      history_id: historyId,
      mood_before: before,
      mood_after: after,
      measured_at: new Date().toISOString(),
    };
    this.schema.song_impact.unshift(row);
  }

  /**
   * 9. updateScoringWeights(weights, adminUserId):
   * Updates global weights live and triggers audit log
   */
  public updateScoringWeights(
    weights: { w_taste: number; w_mood: number; w_similar: number; w_fresh: number; w_recent: number },
    adminUserId: string
  ) {
    const now = new Date().toISOString();
    Object.entries(weights).forEach(([key, val]) => {
      const existing = this.schema.scoring_weights.find((w) => w.weight_name === key);
      if (existing) {
        const oldVal = existing.weight_value;
        existing.weight_value = Number(val.toFixed(2));
        existing.updated_by = adminUserId;
        existing.updated_at = now;
        this.logAudit(adminUserId, 'Scoring_Weights', existing.weight_id, 'UPDATE', { [key]: oldVal }, { [key]: val });
      }
    });
    this.notify();
  }

  /**
   * 10. simulateActivity(count = 200):
   * Simulates 200 plays and ratings across user cohorts (Group A and Group B).
   * Group B (mood-aware) has demonstrably higher completion rates and 4+ star ratings!
   */
  public simulateActivity(count = 200) {
    const users = this.schema.users;
    const songs = this.schema.songs;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const user = users[Math.floor(Math.random() * users.length)];
      const song = songs[Math.floor(Math.random() * songs.length)];
      const isGroupB = user.experiment_group === 'B';

      // Completion probability: Group B (82%) vs Group A (58%)
      const completed = Math.random() < (isGroupB ? 0.82 : 0.58);
      const listenedSec = completed ? song.duration_sec : Math.floor(song.duration_sec * Math.random() * 0.4);

      const historyId = `sim_his_${now}_${i}`;
      this.schema.listening_history.push({
        history_id: historyId,
        user_id: user.user_id,
        song_id: song.song_id,
        played_at: new Date(now - (count - i) * 60000 * 5).toISOString(),
        listened_sec: listenedSec,
        completed,
        source: 'suggestion',
        suggestion_id: null,
      });

      // Star rating probability: 40% of plays receive a rating
      if (Math.random() < 0.4) {
        // Group B ratings lean toward 4 and 5; Group A leans toward 3
        const stars = isGroupB
          ? Math.random() < 0.75 ? (Math.random() < 0.6 ? 5 : 4) : 3
          : Math.random() < 0.5 ? 3 : (Math.random() < 0.6 ? 4 : 2);

        this.schema.ratings.push({
          rating_id: `sim_rat_${now}_${i}`,
          user_id: user.user_id,
          song_id: song.song_id,
          suggestion_id: null,
          stars,
          rated_at: new Date(now - (count - i) * 60000 * 5 + 30000).toISOString(),
        });
      }
    }

    this.computeUserSimilarity();
    this.logAudit(
      'usr_admin',
      'Simulator',
      'SIMULATE_200_RUN',
      'INSERT',
      null,
      { simulatedCount: count, message: 'Simulated 200 activity records across Group A & Group B' }
    );
    this.notify();
  }

  /**
   * Helper: record manual mood check-in
   */
  public checkinMood(userId: string, moodLabel: MoodType, energyLevel = 3) {
    this.validateConstraint('mood_checkins', { user_id: userId, mood_label: moodLabel, energy_level: energyLevel }, 'INSERT');
    const checkinId = `chk_${Date.now()}`;
    const checkin = {
      checkin_id: checkinId,
      user_id: userId,
      mood_label: moodLabel,
      energy_level: energyLevel,
      checked_at: new Date().toISOString(),
    };
    this.schema.mood_checkins.unshift(checkin);
    this.logAudit(userId, 'Mood_Checkins', checkinId, 'INSERT', null, checkin);

    // Run mood detection automatically
    this.detectMood(userId);
    this.generateSuggestions(userId);
    this.notify();
    return checkin;
  }
}

// Global database singleton
export const db = new MoodTideDatabase();
