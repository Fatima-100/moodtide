import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { MOOD_COORDINATES } from '../lib/db';
import { MoodType, Playlist } from '../types/database';
import {
  Compass,
  ArrowRight,
  Play,
  Pause,
  ListPlus,
  Sparkles,
  TrendingUp,
  Activity,
  Check,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export const MoodJourneyPage: React.FC = () => {
  const {
    db,
    schema,
    currentUser,
    playSong,
    currentSong,
    isPlaying,
    pauseSong,
    resumeSong,
    addToast,
  } = useApp();

  const [fromMood, setFromMood] = useState<MoodType>('stressed');
  const [toMood, setToMood] = useState<MoodType>('calm');
  const [journeyPlaylist, setJourneyPlaylist] = useState<Playlist | null>(null);

  const moodOptions: MoodType[] = ['stressed', 'sad', 'calm', 'happy', 'energetic'];

  const handleGenerateJourney = () => {
    const pl = db.buildMoodJourney(currentUser.user_id, fromMood, toMood);
    setJourneyPlaylist(pl);
    addToast({
      type: 'success',
      title: '8-Step Mood Journey Built',
      message: `Calculated linear acoustic progression from ${fromMood} to ${toMood}. Playlist created in database!`,
    });
  };

  // Get songs in the journey
  const activeJourney = journeyPlaylist || schema.playlists.find((p) => p.playlist_type === 'mood_journey') || null;

  const journeySongs = activeJourney
    ? schema.playlist_songs
        .filter((ps) => ps.playlist_id === activeJourney.playlist_id)
        .sort((a, b) => a.position - b.position)
        .map((ps) => {
          const s = schema.songs.find((song) => song.song_id === ps.song_id);
          const feat = s ? schema.song_features.find((f) => f.song_id === s.song_id) : null;
          const artist = s ? schema.artists.find((a) => a.artist_id === s.artist_id) : null;
          return {
            ...ps,
            song: s,
            feat,
            artist,
          };
        })
    : [];

  // Chart data for the 8 steps
  const chartData = journeySongs.map((js, index) => ({
    step: `Step ${index + 1}`,
    title: js.song?.title || `Track ${index + 1}`,
    energy: js.feat ? Math.round(js.feat.energy * 100) : 50,
    happiness: js.feat ? Math.round(js.feat.happiness * 100) : 50,
    tempo: js.feat ? js.feat.tempo : 100,
  }));

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-teal-400 text-xs font-semibold uppercase tracking-wider font-mono">
            <Compass className="w-4 h-4" />
            <span>Harmonic Transition Algorithm</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-1">
            Mood Journey Generator
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
            Calculates an 8-song acoustic progression that gradually transitions your state from{' '}
            <strong className="text-zinc-200 capitalize">{fromMood}</strong> toward{' '}
            <strong className="text-zinc-200 capitalize">{toMood}</strong> without abrupt metric spikes.
          </p>
        </div>
      </div>

      {/* Control Card: Select From & To */}
      <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-6 backdrop-blur-xl shadow-xl">
        <div className="grid grid-cols-1 md:grid-cols-5 items-center gap-4">
          {/* From Mood */}
          <div className="md:col-span-2 space-y-2">
            <label className="text-xs font-semibold uppercase font-mono tracking-wider text-zinc-400">
              Current Headspace (From)
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {moodOptions.map((m) => (
                <button
                  key={m}
                  onClick={() => setFromMood(m)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize border transition-all ${
                    fromMood === m
                      ? 'bg-zinc-800 border-rose-400 text-white shadow-md'
                      : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">
              Energy {(MOOD_COORDINATES[fromMood].energy * 100).toFixed(0)}% · Valence {(MOOD_COORDINATES[fromMood].happiness * 100).toFixed(0)}%
            </span>
          </div>

          {/* Direction Indicator */}
          <div className="flex flex-col items-center justify-center text-zinc-500 py-2">
            <div className="w-10 h-10 rounded-full bg-zinc-800/60 border border-zinc-700/60 flex items-center justify-center text-teal-400 shadow-sm">
              <ArrowRight className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono uppercase mt-1">8 Interpolated Steps</span>
          </div>

          {/* To Mood */}
          <div className="md:col-span-2 space-y-2">
            <label className="text-xs font-semibold uppercase font-mono tracking-wider text-zinc-400">
              Target Headspace (To)
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {moodOptions.map((m) => (
                <button
                  key={m}
                  onClick={() => setToMood(m)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize border transition-all ${
                    toMood === m
                      ? 'bg-zinc-800 border-teal-400 text-white shadow-md'
                      : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">
              Energy {(MOOD_COORDINATES[toMood].energy * 100).toFixed(0)}% · Valence {(MOOD_COORDINATES[toMood].happiness * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800/80 flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            Stored procedure finds nearest neighbors in acoustic feature space for each step.
          </span>
          <button
            onClick={handleGenerateJourney}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-zinc-950 font-bold text-xs transition-colors shadow-lg shadow-teal-500/20 active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate & Save Mood Journey</span>
          </button>
        </div>
      </div>

      {/* Trajectory Visualizer Chart */}
      {chartData.length > 0 && (
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 border-b border-zinc-800/80 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-400" />
              <h3 className="text-sm font-bold text-white">
                Acoustic Trajectory Curve ({activeJourney?.name})
              </h3>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                <span className="text-zinc-300">Energy (%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400" />
                <span className="text-zinc-300">Happiness / Valence (%)</span>
              </div>
            </div>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="step" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} domain={[0, 100]} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '0.75rem', fontSize: '12px' }}
                  labelStyle={{ color: '#fafafa', fontWeight: 'bold' }}
                />
                <Line
                  type="monotone"
                  dataKey="energy"
                  stroke="#fb7185"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#fb7185' }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="happiness"
                  stroke="#2dd4bf"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#2dd4bf' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 8-Step Track Cards Grid */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
          8 Journey Steps in Sequence
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {journeySongs.map((js, idx) => {
            const song = js.song;
            if (!song) return null;
            const isCurrent = currentSong?.song_id === song.song_id;
            const isPlayingCurrent = isCurrent && isPlaying;

            return (
              <div
                key={js.song_id}
                className={`p-3.5 rounded-xl border transition-all bg-zinc-900/40 ${
                  isCurrent
                    ? 'border-teal-500/80 bg-zinc-900/90 shadow-md'
                    : 'border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mb-2">
                  <span className="font-bold text-teal-400">Step 0{idx + 1}</span>
                  <span>{js.feat?.tempo} BPM</span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-white truncate">{song.title}</h4>
                    <p className="text-[11px] text-zinc-400 truncate">{js.artist?.name || 'Artist'}</p>
                  </div>

                  <button
                    onClick={() => {
                      if (isPlayingCurrent) pauseSong();
                      else if (isCurrent) resumeSong();
                      else playSong(song, 'playlist');
                    }}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      isPlayingCurrent
                        ? 'bg-teal-400 text-zinc-950'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-teal-500 hover:text-zinc-950'
                    }`}
                  >
                    {isPlayingCurrent ? (
                      <Pause className="w-3 h-3 fill-current" />
                    ) : (
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                    )}
                  </button>
                </div>

                {js.feat && (
                  <div className="mt-3 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                    <span>E: {(js.feat.energy * 100).toFixed(0)}%</span>
                    <span>V: {(js.feat.happiness * 100).toFixed(0)}%</span>
                    <span>D: {(js.feat.danceability * 100).toFixed(0)}%</span>
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
