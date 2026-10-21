/**
 * MoodTide Database Types
 * Comprehensive relational schema matching a 25-table PostgreSQL database.
 */

export type MoodType = 'happy' | 'calm' | 'sad' | 'energetic' | 'stressed';

export interface Artist {
  artist_id: string; // PK
  name: string;
  country: string;
  created_at: string;
}

export interface Album {
  album_id: string; // PK
  artist_id: string; // FK -> Artists.artist_id
  title: string;
  release_year: number;
  cover_url: string;
}

export interface Genre {
  genre_id: string; // PK
  name: string; // UNIQUE
}

export interface Song {
  song_id: string; // PK
  artist_id: string; // FK -> Artists.artist_id
  album_id: string | null; // FK -> Albums.album_id (nullable)
  title: string;
  duration_sec: number;
  release_year: number;
  audio_url: string;
  popularity: number; // 0-100
  is_active: boolean;
  created_at: string;
}

export interface SongGenre {
  song_id: string; // Composite PK & FK -> Songs.song_id
  genre_id: string; // Composite PK & FK -> Genres.genre_id
}

export interface SongFeatures {
  song_id: string; // PK & FK -> Songs.song_id
  energy: number; // CHECK 0.0 - 1.0
  happiness: number; // CHECK 0.0 - 1.0 (valence)
  tempo: number; // BPM (40 - 220)
  danceability: number; // CHECK 0.0 - 1.0
  acousticness: number; // CHECK 0.0 - 1.0
}

export type RoleName = 'user' | 'admin';

export interface Role {
  role_id: string; // PK
  role_name: RoleName; // UNIQUE
}

export interface User {
  user_id: string; // PK
  role_id: string; // FK -> Roles.role_id
  username: string;
  email: string; // UNIQUE
  password_hash: string;
  experiment_group: 'A' | 'B'; // A/B testing cohort assignment
  created_at: string;
  last_login: string;
}

export interface AuthSession {
  session_id: string; // PK
  user_id: string; // FK -> Users.user_id
  token_hash: string;
  created_at: string;
  expires_at: string;
  is_revoked: boolean;
}

export type PlaylistType = 'normal' | 'mood_journey';

export interface Playlist {
  playlist_id: string; // PK
  user_id: string; // FK -> Users.user_id
  name: string;
  description: string;
  playlist_type: PlaylistType;
  start_mood: MoodType | null;
  target_mood: MoodType | null;
  created_at: string;
}

export interface PlaylistSong {
  playlist_id: string; // Composite PK & FK -> Playlists.playlist_id
  song_id: string; // Composite PK & FK -> Songs.song_id (Unique per playlist)
  position: number;
  added_at: string;
}

export type HistorySource = 'search' | 'playlist' | 'suggestion';

export interface ListeningHistory {
  history_id: string; // PK
  user_id: string; // FK -> Users.user_id
  song_id: string; // FK -> Songs.song_id
  played_at: string;
  listened_sec: number;
  completed: boolean;
  source: HistorySource;
  suggestion_id: string | null; // FK -> Suggestions.suggestion_id (nullable)
}

export interface MoodCheckin {
  checkin_id: string; // PK
  user_id: string; // FK -> Users.user_id
  mood_label: MoodType;
  energy_level: number; // CHECK 1-5
  checked_at: string;
}

export interface MoodScore {
  score_id: string; // PK
  user_id: string; // FK -> Users.user_id
  calculated_at: string;
  detected_mood: MoodType;
  mood_score: number; // 0-100
  skip_count: number;
  replay_count: number;
  time_of_day: string; // morning | afternoon | evening | night
  avg_energy: number;
  avg_tempo: number;
  checkin_id: string | null; // FK -> MoodCheckins.checkin_id (nullable)
}

export interface SuggestionBatch {
  batch_id: string; // PK
  user_id: string; // FK -> Users.user_id
  experiment_id: string | null; // FK -> Experiments.experiment_id (nullable)
  variant: 'A' | 'B';
  score_id: string | null; // FK -> MoodScores.score_id (nullable)
  created_at: string;
}

export type SuggestionOutcome = 'pending' | 'played' | 'skipped' | 'rated' | 'ignored';

export interface Suggestion {
  suggestion_id: string; // PK
  batch_id: string; // FK -> SuggestionBatches.batch_id
  song_id: string; // FK -> Songs.song_id
  rank_position: number;
  total_score: number;
  taste_score: number;
  mood_match_score: number;
  similar_users_score: number;
  freshness_score: number;
  recent_penalty: number;
  is_exploration: boolean;
  outcome: SuggestionOutcome;
}

export interface SuggestionReason {
  reason_id: string; // PK
  suggestion_id: string; // FK -> Suggestions.suggestion_id
  reason_type: string;
  reason_text: string;
  contribution: number; // 0-1 percentage of final score
}

export interface Rating {
  rating_id: string; // PK
  user_id: string; // FK -> Users.user_id
  song_id: string; // FK -> Songs.song_id
  suggestion_id: string | null; // FK -> Suggestions.suggestion_id (nullable)
  stars: number; // CHECK 1 - 5
  rated_at: string;
}

export type ImplicitSignalType = 'full_play' | 'skip' | 'replay' | 'add_to_playlist';

export interface ImplicitSignal {
  signal_id: string; // PK
  user_id: string; // FK -> Users.user_id
  song_id: string; // FK -> Songs.song_id
  suggestion_id: string | null; // FK -> Suggestions.suggestion_id (nullable)
  signal_type: ImplicitSignalType;
  signal_value: number; // e.g. +1, -1, +2
  created_at: string;
}

export interface UserTasteProfile {
  user_id: string; // Composite PK & FK -> Users.user_id
  genre_id: string; // Composite PK & FK -> Genres.genre_id
  affinity_score: number; // dynamic float
  play_count: number;
  updated_at: string;
}

export interface UserSimilarity {
  user_id_a: string; // Composite PK & FK -> Users.user_id
  user_id_b: string; // Composite PK & FK -> Users.user_id
  similarity_score: number; // 0.0 - 1.0
  common_songs: number;
  calculated_at: string;
}

export interface ScoringWeight {
  weight_id: string; // PK
  weight_name: string; // UNIQUE (w_taste, w_mood, w_similar, w_fresh, w_recent)
  weight_value: number;
  updated_by: string; // FK -> Users.user_id
  updated_at: string;
}

export interface Experiment {
  experiment_id: string; // PK
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  status: 'active' | 'completed' | 'draft';
}

export interface SongImpact {
  impact_id: string; // PK
  user_id: string; // FK -> Users.user_id
  song_id: string; // FK -> Songs.song_id
  history_id: string; // FK -> ListeningHistory.history_id
  mood_before: MoodType;
  mood_after: MoodType;
  measured_at: string;
}

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditLog {
  log_id: string; // PK
  user_id: string | null; // FK -> Users.user_id (nullable)
  table_name: string;
  record_id: string;
  action: AuditAction;
  old_data: string | null; // JSON text
  new_data: string | null; // JSON text
  changed_at: string;
}

/**
 * Entire in-memory Database Schema
 */
export interface DatabaseSchema {
  artists: Artist[];
  albums: Album[];
  genres: Genre[];
  songs: Song[];
  song_genres: SongGenre[];
  song_features: SongFeatures[];
  roles: Role[];
  users: User[];
  auth_sessions: AuthSession[];
  playlists: Playlist[];
  playlist_songs: PlaylistSong[];
  listening_history: ListeningHistory[];
  mood_checkins: MoodCheckin[];
  mood_scores: MoodScore[];
  suggestion_batches: SuggestionBatch[];
  suggestions: Suggestion[];
  suggestion_reasons: SuggestionReason[];
  ratings: Rating[];
  implicit_signals: ImplicitSignal[];
  user_taste_profile: UserTasteProfile[];
  user_similarity: UserSimilarity[];
  scoring_weights: ScoringWeight[];
  experiments: Experiment[];
  song_impact: SongImpact[];
  audit_log: AuditLog[];
}

export type TableKey = keyof DatabaseSchema;

export interface TableMeta {
  key: TableKey;
  tableName: string;
  category: 'Music Catalog' | 'Users & Auth' | 'Activity & Mood' | 'Suggestions' | 'Feedback & Learning' | 'Control & Testing' | 'Impact & Safety';
  primaryKey: string[];
  foreignKeys: { column: string; references: string }[];
  description: string;
}

export interface ConstraintViolation {
  table: string;
  type: 'PRIMARY_KEY' | 'FOREIGN_KEY' | 'UNIQUE' | 'CHECK' | 'DUPLICATE_PLAYLIST_SONG';
  message: string;
  details?: Record<string, unknown>;
}
