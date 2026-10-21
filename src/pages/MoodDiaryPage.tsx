import React from 'react';
import { useApp } from '../context/AppContext';
import { MOOD_COORDINATES } from '../lib/db';
import { MoodType } from '../types/database';
import { Calendar, TrendingUp, Sparkles, Heart, ArrowUpRight, Music, Play, Pause } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export const MoodDiaryPage: React.FC = () => {
  const { schema, currentUser, playSong, currentSong, isPlaying, pauseSong, resumeSong } = useApp();

  // Mood Checkins for current user
  const userCheckins = schema.mood_checkins
    .filter((c) => c.user_id === currentUser.user_id)
    .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());

  // Mood Scores for current user
  const userScores = schema.mood_scores
    .filter((s) => s.user_id === currentUser.user_id)
    .sort((a, b) => new Date(a.calculated_at).getTime() - new Date(b.calculated_at).getTime());

  // Chart data: progression over time
  const timelineData = userScores.slice(-10).map((s, idx) => ({
    time: `Log #${idx + 1}`,
    score: s.mood_score,
    energy: Math.round(s.avg_energy * 100),
    mood: s.detected_mood,
  }));

  // Top Mood Lifters from Song_Impact
  const impacts = schema.song_impact.filter((i) => i.user_id === currentUser.user_id);

  // Group impacts by song
  const lifters = impacts.map((imp) => {
    const song = schema.songs.find((s) => s.song_id === imp.song_id);
    const artist = song ? schema.artists.find((a) => a.artist_id === song.artist_id) : null;
    const feat = song ? schema.song_features.find((f) => f.song_id === song.song_id) : null;
    return {
      ...imp,
      song,
      artist,
      feat,
    };
  });

  // Weekly Calendar simulation (7 days)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const calendarDays = [
    { day: 'Mon', mood: 'calm' as MoodType, energy: 2, label: 'Oct 14' },
    { day: 'Tue', mood: 'energetic' as MoodType, energy: 4, label: 'Oct 15' },
    { day: 'Wed', mood: 'stressed' as MoodType, energy: 3, label: 'Oct 16' },
    { day: 'Thu', mood: 'calm' as MoodType, energy: 3, label: 'Oct 17' },
    { day: 'Fri', mood: 'happy' as MoodType, energy: 5, label: 'Oct 18' },
    { day: 'Sat', mood: 'calm' as MoodType, energy: 2, label: 'Oct 19' },
    { day: 'Sun', mood: (userScores.slice(-1)[0]?.detected_mood || 'calm') as MoodType, energy: 3, label: 'Today' },
  ];

  const moodColors: Record<MoodType, string> = {
    happy: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    calm: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
    sad: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    energetic: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    stressed: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-8 animate-in fade-in duration-300">
      <div>
        <div className="flex items-center gap-2 text-teal-400 text-xs font-semibold uppercase tracking-wider font-mono">
          <Calendar className="w-4 h-4" />
          <span>Longitudinal Affective Telemetry</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-1">
          Mood Diary & Emotional Impact
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
          Visualizes your affective trajectory over time from <code className="text-teal-400 font-mono">Mood_Checkins</code>,
          evaluated by <code className="text-teal-400 font-mono">Mood_Scores</code>, and measures which songs elevated your emotional state.
        </p>
      </div>

      {/* Weekly Colour Calendar */}
      <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
        <h3 className="text-sm font-bold text-white mb-3">Weekly Affective Calendar (Oct 14 - Oct 20)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
          {calendarDays.map((item) => {
            const coord = MOOD_COORDINATES[item.mood];
            return (
              <div
                key={item.day}
                className={`p-3.5 rounded-xl border flex flex-col justify-between min-h-[105px] transition-all ${
                  moodColors[item.mood]
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-white">{item.day}</span>
                  <span className="text-[10px] text-zinc-400">{item.label}</span>
                </div>

                <div className="mt-2">
                  <p className="text-sm font-extrabold capitalize">{item.mood}</p>
                  <span className="text-[10px] opacity-80 font-mono">
                    Energy Level: {item.energy}/5
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mood Progression Line Chart */}
      <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800/80 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-400" />
            <h3 className="text-sm font-bold text-white">Affective Valence & Momentum Over Time</h3>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-400" />
              <span className="text-zinc-300">Mood Score (0-100)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="text-zinc-300">Acoustic Energy (%)</span>
            </div>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timelineData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="time" stroke="#71717a" fontSize={11} tickLine={false} />
              <YAxis stroke="#71717a" fontSize={11} domain={[0, 100]} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '0.75rem', fontSize: '12px' }}
                labelStyle={{ color: '#fafafa', fontWeight: 'bold' }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#2dd4bf"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#2dd4bf' }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="energy"
                stroke="#fbbf24"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#fbbf24' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Mood Lifters (Song_Impact) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Top Mood Lifters</h2>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Derived from <code className="text-teal-400 font-mono">Song_Impact</code> window calculation: tracks that caused positive state shifts (e.g. Stressed &rarr; Calm)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lifters.length === 0 ? (
            <div className="p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center text-zinc-500 text-xs md:col-span-3">
              Play and rate more songs to record positive shifts into the Song_Impact table!
            </div>
          ) : (
            lifters.map((item) => {
              const song = item.song;
              if (!song) return null;
              const isCurrent = currentSong?.song_id === song.song_id;
              const isPlayingCurrent = isCurrent && isPlaying;

              return (
                <div
                  key={item.impact_id}
                  className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-900/70 transition-all flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                        Impact #{item.impact_id.slice(-6)}
                      </span>
                      <h4 className="text-sm font-bold text-white truncate mt-0.5">{song.title}</h4>
                      <p className="text-xs text-zinc-400 truncate">{item.artist?.name || 'Artist'}</p>
                    </div>

                    <button
                      onClick={() => {
                        if (isPlayingCurrent) pauseSong();
                        else if (isCurrent) resumeSong();
                        else playSong(song, 'playlist');
                      }}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isPlayingCurrent
                          ? 'bg-teal-400 text-zinc-950'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-teal-500 hover:text-zinc-950'
                      }`}
                    >
                      {isPlayingCurrent ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/60 flex items-center justify-between text-xs">
                    <span className="capitalize font-medium text-rose-300">
                      {item.mood_before}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-teal-400" />
                    <span className="capitalize font-bold text-teal-300">
                      {item.mood_after}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
