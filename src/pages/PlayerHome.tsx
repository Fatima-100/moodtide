import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { MOOD_COORDINATES } from '../lib/db';
import { MoodType, Song } from '../types/database';
import {
  Play,
  Pause,
  Star,
  Sparkles,
  Info,
  Terminal,
  Activity,
  Compass,
  Zap,
  Smile,
  CloudRain,
  Flame,
  AlertCircle,
  HelpCircle,
  Clock,
  Heart,
} from 'lucide-react';

export const PlayerHome: React.FC = () => {
  const {
    schema,
    currentUser,
    currentMood,
    checkinMood,
    runMoodDetection,
    playSong,
    currentSong,
    isPlaying,
    pauseSong,
    resumeSong,
    rateSong,
    openSqlModal,
  } = useApp();

  const [activeReasonModal, setActiveReasonModal] = useState<string | null>(null);
  const [energyInput, setEnergyInput] = useState<number>(3);

  // Latest mood score row
  const latestMoodScore = schema.mood_scores
    .filter((s) => s.user_id === currentUser.user_id)
    .sort((a, b) => new Date(b.calculated_at).getTime() - new Date(a.calculated_at).getTime())[0];

  // Latest checkin
  const latestCheckin = schema.mood_checkins
    .filter((c) => c.user_id === currentUser.user_id)
    .sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())[0];

  // Active suggestions for current user
  const latestBatch = schema.suggestion_batches
    .filter((b) => b.user_id === currentUser.user_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  const currentSuggestions = latestBatch
    ? schema.suggestions
        .filter((s) => s.batch_id === latestBatch.batch_id)
        .sort((a, b) => a.rank_position - b.rank_position)
    : schema.suggestions.slice(0, 10);

  // Mood buttons config
  const moodButtons: Array<{ id: MoodType; label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = [
    { id: 'happy', label: 'Happy', icon: Smile, color: 'hover:border-amber-400 hover:text-amber-300' },
    { id: 'calm', label: 'Calm', icon: Compass, color: 'hover:border-teal-400 hover:text-teal-300' },
    { id: 'sad', label: 'Sad', icon: CloudRain, color: 'hover:border-indigo-400 hover:text-indigo-300' },
    { id: 'energetic', label: 'Energetic', icon: Flame, color: 'hover:border-rose-400 hover:text-rose-300' },
    { id: 'stressed', label: 'Stressed', icon: AlertCircle, color: 'hover:border-violet-400 hover:text-violet-300' },
  ];

  const handleShowSql = () => {
    const sql = `-- =======================================================================
-- MoodTide Suggestion Engine: Scoring & Ranking Stored Procedure
-- Generated for User ID: '${currentUser.user_id}' (${currentUser.username})
-- Experiment Cohort: Group ${currentUser.experiment_group} (${currentUser.experiment_group === 'A' ? 'Taste-Only' : 'Mood-Aware'})
-- =======================================================================

BEGIN TRANSACTION;

-- 1. Fetch Scoring Hyperparameters
WITH weights AS (
  SELECT
    MAX(CASE WHEN weight_name = 'w_taste' THEN weight_value END) as w_taste,
    MAX(CASE WHEN weight_name = 'w_mood' THEN ${currentUser.experiment_group === 'A' ? '0.0' : 'weight_value'} END) as w_mood,
    MAX(CASE WHEN weight_name = 'w_similar' THEN weight_value END) as w_similar,
    MAX(CASE WHEN weight_name = 'w_fresh' THEN weight_value END) as w_fresh,
    MAX(CASE WHEN weight_name = 'w_recent' THEN weight_value END) as w_recent
  FROM Scoring_Weights
),

-- 2. User Target Mood Acoustic Vector
target_mood AS (
  SELECT
    '${currentMood}' AS detected_mood,
    ${MOOD_COORDINATES[currentMood].energy} AS target_energy,
    ${MOOD_COORDINATES[currentMood].happiness} AS target_happiness
),

-- 3. Collaborative Filtering: Similar User Neighbors
similar_users AS (
  SELECT 
    CASE WHEN user_id_a = '${currentUser.user_id}' THEN user_id_b ELSE user_id_a END as neighbor_id,
    similarity_score
  FROM User_Similarity
  WHERE (user_id_a = '${currentUser.user_id}' OR user_id_b = '${currentUser.user_id}')
  ORDER BY similarity_score DESC
  LIMIT 5
),

-- 4. Candidate Song Scoring & Feature Distance Calculation
candidate_scores AS (
  SELECT
    s.song_id,
    s.title,
    s.popularity,
    sf.energy,
    sf.happiness,
    sf.tempo,
    COALESCE(utp.affinity_score / 5.0, 0.5) AS taste_match,
    -- Euclidean distance in (energy, valence) space
    GREATEST(0.05, 1.0 - SQRT(
      POW(sf.energy - tm.target_energy, 2) + 
      POW(sf.happiness - tm.target_happiness, 2)
    )) AS mood_match,
    COALESCE(AVG(r.stars) / 5.0, 0.2) AS similar_boost,
    CASE WHEN lh.history_id IS NULL THEN 0.9 ELSE 0.3 END AS freshness,
    CASE WHEN rec.history_id IS NOT NULL THEN 0.8 ELSE 0.0 END AS recent_penalty
  FROM Songs s
  JOIN Song_Features sf ON s.song_id = sf.song_id
  CROSS JOIN target_mood tm
  CROSS JOIN weights w
  LEFT JOIN Song_Genre sg ON s.song_id = sg.song_id
  LEFT JOIN User_Taste_Profile utp ON utp.user_id = '${currentUser.user_id}' AND utp.genre_id = sg.genre_id
  LEFT JOIN Ratings r ON r.song_id = s.song_id AND r.user_id IN (SELECT neighbor_id FROM similar_users)
  LEFT JOIN Listening_History lh ON lh.song_id = s.song_id AND lh.user_id = '${currentUser.user_id}'
  LEFT JOIN (
    SELECT DISTINCT song_id, history_id 
    FROM Listening_History 
    WHERE user_id = '${currentUser.user_id}' 
    ORDER BY played_at DESC LIMIT 15
  ) rec ON rec.song_id = s.song_id
  WHERE s.is_active = TRUE
  GROUP BY s.song_id, sf.energy, sf.happiness, sf.tempo, utp.affinity_score, tm.target_energy, tm.target_happiness, lh.history_id, rec.history_id
)

-- 5. Final Ranked Output with Exploration Partitioning
SELECT
  cs.song_id,
  cs.title,
  (w.w_taste * cs.taste_match +
   w.w_mood * cs.mood_match +
   w.w_similar * cs.similar_boost +
   w.w_fresh * cs.freshness -
   w.w_recent * cs.recent_penalty) AS total_score,
  cs.taste_match,
  cs.mood_match,
  cs.similar_boost,
  cs.freshness
FROM candidate_scores cs
CROSS JOIN weights w
ORDER BY total_score DESC
LIMIT 10;

COMMIT;`;

    openSqlModal('PostgreSQL Stored Procedure: generate_suggestions()', sql);
  };

  const handleShowMoodSql = () => {
    const sql = `-- =======================================================================
-- MoodTide Stored Procedure: detect_mood(p_user_id VARCHAR)
-- Non-AI Deterministic Rule-Based State Machine
-- =======================================================================

CREATE OR REPLACE FUNCTION detect_mood(p_user_id VARCHAR)
RETURNS Mood_Scores AS $$
DECLARE
  v_skip_count INT := 0;
  v_replay_count INT := 0;
  v_avg_energy NUMERIC(3,2) := 0.5;
  v_avg_tempo INT := 100;
  v_detected_mood Mood_Type := 'calm';
  v_mood_score INT := 75;
  v_time_of_day VARCHAR := 'afternoon';
  v_new_score Mood_Scores;
BEGIN
  -- 1. Window evaluation: detect consecutive skip streak in last 10 tracks
  SELECT COUNT(*) INTO v_skip_count
  FROM (
    SELECT completed, listened_sec
    FROM Listening_History
    WHERE user_id = p_user_id
    ORDER BY played_at DESC
    LIMIT 5
  ) sub
  WHERE completed = FALSE AND listened_sec < 25;

  -- 2. Aggregate acoustic momentum of the last 5 played tracks
  SELECT 
    COALESCE(AVG(sf.energy), 0.5),
    COALESCE(AVG(sf.tempo), 100)
  INTO v_avg_energy, v_avg_tempo
  FROM (
    SELECT song_id FROM Listening_History
    WHERE user_id = p_user_id
    ORDER BY played_at DESC LIMIT 5
  ) recent
  JOIN Song_Features sf ON recent.song_id = sf.song_id;

  -- 3. Deterministic Decision Tree Rules:
  IF v_skip_count >= 3 THEN
    v_detected_mood := 'stressed';
    v_mood_score := 40;
  ELSIF v_avg_energy > 0.70 AND v_avg_tempo > 120 THEN
    v_detected_mood := 'energetic';
    v_mood_score := 85;
  ELSIF v_avg_energy < 0.35 AND v_avg_tempo < 75 THEN
    v_detected_mood := 'sad';
    v_mood_score := 48;
  ELSE
    v_detected_mood := 'calm';
    v_mood_score := 80;
  END IF;

  -- 4. INSERT into Mood_Scores & trigger Audit_Log
  INSERT INTO Mood_Scores (
    score_id, user_id, calculated_at, detected_mood, mood_score,
    skip_count, replay_count, time_of_day, avg_energy, avg_tempo
  ) VALUES (
    'msc_' || EXTRACT(EPOCH FROM NOW()), p_user_id, NOW(), v_detected_mood, v_mood_score,
    v_skip_count, v_replay_count, v_time_of_day, v_avg_energy, v_avg_tempo
  ) RETURNING * INTO v_new_score;

  RETURN v_new_score;
END;
$$ LANGUAGE plpgsql;`;

    openSqlModal('PostgreSQL Stored Procedure: detect_mood()', sql);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-8 animate-in fade-in duration-300">
      {/* Hero Welcome & Mood Bar */}
      <div className="relative rounded-3xl bg-zinc-900/60 border border-zinc-800/80 p-6 sm:p-8 backdrop-blur-xl overflow-hidden shadow-2xl">
        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
              <span>User Session:</span>
              <strong className="text-zinc-200">{currentUser.username}</strong>
              <span>·</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-teal-400 border border-zinc-700/80">
                Cohort {currentUser.experiment_group} ({currentUser.experiment_group === 'A' ? 'Taste-Only' : 'Mood-Aware'})
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-2 text-balance">
              How are you feeling right now?
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-xl">
              Tap a mood to insert a record into <code className="text-teal-400 font-mono">Mood_Checkins</code>.
              The suggestion engine recalculates your top 10 songs in real time.
            </p>
          </div>

          {/* 1-Tap Mood Checkin Buttons */}
          <div className="flex flex-col gap-2 w-full lg:w-auto">
            <div className="flex flex-wrap items-center gap-2">
              {moodButtons.map((m) => {
                const isSelected = currentMood === m.id;
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => checkinMood(m.id, energyInput)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 active:scale-95 ${
                      isSelected
                        ? 'bg-zinc-800 border-teal-400 text-white shadow-lg shadow-teal-500/10'
                        : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 ' + m.color
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 px-2 pt-1 text-[11px] text-zinc-400 font-mono">
              <span>Energy Scale (1-5): {energyInput}</span>
              <input
                type="range"
                min={1}
                max={5}
                value={energyInput}
                onChange={(e) => setEnergyInput(Number(e.target.value))}
                className="w-28 h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-teal-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Detected Mood Rule Card + System Rule Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Detected Mood Card */}
        <div className="md:col-span-2 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-5 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Activity className="w-4 h-4 text-teal-400" />
              <span>Real-Time Rule Evaluation: <code className="font-mono text-teal-400">detectMood()</code></span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleShowMoodSql}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-300 border border-zinc-700 transition-colors"
              >
                <Terminal className="w-3 h-3 text-teal-400" />
                <span>Show SQL</span>
              </button>
              <button
                onClick={runMoodDetection}
                className="px-2.5 py-1 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 text-[11px] font-medium transition-colors"
              >
                Re-evaluate Rules
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">Detected State</span>
              <p className="text-base font-bold text-white capitalize mt-0.5">{latestMoodScore?.detected_mood || currentMood}</p>
              <span className="text-[10px] text-zinc-400 font-mono">Score: {latestMoodScore?.mood_score || 80}/100</span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">Skip Streak</span>
              <p className={`text-base font-bold mt-0.5 ${latestMoodScore && latestMoodScore.skip_count >= 3 ? 'text-violet-400' : 'text-zinc-200'}`}>
                {latestMoodScore?.skip_count || 0} Skips
              </p>
              <span className="text-[10px] text-zinc-500 font-mono">&ge; 3 triggers stressed</span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">Acoustic Momentum</span>
              <p className="text-base font-bold text-zinc-200 mt-0.5">{((latestMoodScore?.avg_energy || 0.4) * 100).toFixed(0)}% Energy</p>
              <span className="text-[10px] text-zinc-500 font-mono">{latestMoodScore?.avg_tempo || 85} BPM avg</span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">Time & Replays</span>
              <p className="text-base font-bold text-zinc-200 capitalize mt-0.5">{latestMoodScore?.time_of_day || 'afternoon'}</p>
              <span className="text-[10px] text-zinc-500 font-mono">{latestMoodScore?.replay_count || 0} recent loops</span>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-xl bg-zinc-950/40 border border-zinc-800/40 text-xs text-zinc-400 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-zinc-200">Rule Trigger Explanation: </strong>
              <span>
                {latestMoodScore?.skip_count && latestMoodScore.skip_count >= 3
                  ? `Active Rule: Skip count exceeded threshold (3+). System flagged stressed state and prioritized soothing ambient textures.`
                  : latestCheckin
                  ? `Active Rule: Harmonized with manual check-in (${latestCheckin.mood_label}, level ${latestCheckin.energy_level}/5) recorded in Mood_Checkins.`
                  : `Active Rule: Time of day (${latestMoodScore?.time_of_day}) combined with historical acoustic momentum.`}
              </span>
            </div>
          </div>
        </div>

        {/* Experiment & Database Summary */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-5 backdrop-blur-md flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200 border-b border-zinc-800/80 pb-3">
              <Compass className="w-4 h-4 text-amber-400" />
              <span>Experiment Cohort Tracking</span>
            </div>
            <div className="mt-3 space-y-2 text-xs text-zinc-400">
              <div className="flex justify-between items-center py-1 border-b border-zinc-800/40">
                <span>Assigned Group:</span>
                <span className="font-semibold text-zinc-200">
                  {currentUser.experiment_group === 'A' ? 'Group A (Taste Only)' : 'Group B (Mood Aware)'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-800/40">
                <span>Taste Weight (w_taste):</span>
                <span className="font-mono text-zinc-300">0.35</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-800/40">
                <span>Mood Weight (w_mood):</span>
                <span className="font-mono text-zinc-300">
                  {currentUser.experiment_group === 'A' ? '0.00 (Disabled)' : '0.30 (Active)'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-800/40">
                <span>Exploration Policy:</span>
                <span className="font-mono text-teal-400">20% outside top taste</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between">
            <button
              onClick={handleShowSql}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5 text-teal-400" />
              <span>Show Recommendation SQL Query</span>
            </button>
          </div>
        </div>
      </div>

      {/* Suggestion Feed Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Adaptive Suggestion Feed</h2>
              <span className="text-xs font-mono text-zinc-400">
                (Batch {latestBatch?.batch_id.slice(-6) || 'initial'})
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Top 10 ranked songs calculated with PostgreSQL formula · 2 exploration songs included
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => runMoodDetection()}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 transition-colors"
            >
              Refresh Suggestions
            </button>
            <button
              onClick={handleShowSql}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 text-xs font-medium transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Show SQL Transaction</span>
            </button>
          </div>
        </div>

        {/* Suggestion List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentSuggestions.map((sug) => {
            const song = schema.songs.find((s) => s.song_id === sug.song_id);
            if (!song) return null;
            const feat = schema.song_features.find((f) => f.song_id === song.song_id);
            const artist = schema.artists.find((a) => a.artist_id === song.artist_id);
            const songGenreRow = schema.song_genres.find((sg) => sg.song_id === song.song_id);
            const genre = schema.genres.find((g) => g.genre_id === songGenreRow?.genre_id);

            // User rating for this song
            const userRating = schema.ratings.find(
              (r) => r.user_id === currentUser.user_id && r.song_id === song.song_id
            );

            // Reasons for this suggestion
            const reasons = schema.suggestion_reasons.filter((r) => r.suggestion_id === sug.suggestion_id);

            const isCurrentTrack = currentSong?.song_id === song.song_id;
            const isPlayingNow = isCurrentTrack && isPlaying;

            return (
              <div
                key={sug.suggestion_id}
                className={`group relative rounded-2xl border p-4.5 transition-all duration-200 bg-zinc-900/40 hover:bg-zinc-900/70 ${
                  isCurrentTrack
                    ? 'border-teal-500/60 shadow-lg shadow-teal-500/10'
                    : 'border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Play button + Title + Artist */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <button
                      onClick={() => {
                        if (isPlayingNow) pauseSong();
                        else if (isCurrentTrack) resumeSong();
                        else playSong(song, 'suggestion', sug.suggestion_id);
                      }}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow-md ${
                        isPlayingNow
                          ? 'bg-teal-400 text-zinc-950'
                          : 'bg-zinc-800 text-white hover:bg-teal-500 hover:text-zinc-950'
                      }`}
                    >
                      {isPlayingNow ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                    </button>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-500">#{sug.rank_position}</span>
                        <h4 className="text-sm font-bold text-white truncate">{song.title}</h4>
                      </div>
                      <p className="text-xs text-zinc-400 truncate mt-0.5">
                        {artist?.name || 'Artist'} · {genre?.name || 'Genre'}
                      </p>

                      {/* Unboxed Metadata with typographic separators */}
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono mt-1">
                        <span>{feat?.tempo} BPM</span>
                        <span aria-hidden="true">·</span>
                        <span>Energy {((feat?.energy || 0) * 100).toFixed(0)}%</span>
                        <span aria-hidden="true">·</span>
                        <span>Score: {sug.total_score.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Tags & Exploration */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {sug.is_exploration ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                        <Compass className="w-3 h-3" />
                        <span>Exploration</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-400 font-mono">
                        Mood match: {((sug.mood_match_score || 0) * 100).toFixed(0)}%
                      </span>
                    )}

                    {/* Why this song? Trigger */}
                    <button
                      onClick={() =>
                        setActiveReasonModal(
                          activeReasonModal === sug.suggestion_id ? null : sug.suggestion_id
                        )
                      }
                      className="text-[11px] text-teal-400 hover:text-teal-300 font-medium flex items-center gap-1 hover:underline"
                    >
                      <HelpCircle className="w-3 h-3" />
                      <span>Why this song?</span>
                    </button>
                  </div>
                </div>

                {/* Star Rating Section (Triggers onSongRate stored procedure) */}
                <div className="flex items-center justify-between gap-4 mt-3 pt-3 border-t border-zinc-800/60">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-zinc-400 mr-1.5">Rate:</span>
                    {[1, 2, 3, 4, 5].map((star) => {
                      const isFilled = userRating && userRating.stars >= star;
                      return (
                        <button
                          key={star}
                          onClick={() => rateSong(song.song_id, star, sug.suggestion_id)}
                          className="p-1 hover:scale-110 transition-transform text-zinc-600 hover:text-amber-400"
                          title={`Rate ${star} star${star > 1 ? 's' : ''} (Runs CHECK constraint & updates taste)`}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isFilled ? 'text-amber-400 fill-amber-400' : 'text-zinc-600'
                            }`}
                          />
                        </button>
                      );
                    })}
                    {userRating && (
                      <span className="text-[10px] text-amber-400 font-mono ml-1">
                        ({userRating.stars}★)
                      </span>
                    )}
                  </div>

                  <span className="text-[10px] font-mono text-zinc-400">
                    Taste: {(sug.taste_score * 100).toFixed(0)}% · Similar: {(sug.similar_users_score * 100).toFixed(0)}%
                  </span>
                </div>

                {/* "Why this song?" Dropdown / Drawer */}
                {activeReasonModal === sug.suggestion_id && (
                  <div className="mt-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-2 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-200">
                        Recommendation Rationale Breakdown
                      </span>
                      <span className="text-[10px] font-mono text-teal-400">
                        Suggestion_Reasons table
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {reasons.length > 0 ? (
                        reasons.map((r) => (
                          <div key={r.reason_id} className="flex items-start justify-between gap-2 text-zinc-300">
                            <span className="leading-relaxed">· {r.reason_text}</span>
                            <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                              +{(r.contribution * 100).toFixed(0)}% weight
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-zinc-500 text-xs">
                          High harmonic match with current mood profile and baseline listening frequency.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
