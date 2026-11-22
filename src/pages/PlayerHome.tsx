import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { MoodType } from '../lib/mood';
import { useViewMode } from '../lib/viewMode';
import { AddToPlaylistButton } from '../components/AddToPlaylistButton';
import {
  Play, Pause, Star, Sparkles, Activity, Compass, Smile, CloudRain, Flame,
  AlertCircle, HelpCircle, Music2, RefreshCw, Loader2,
} from 'lucide-react';

const MOODS: Array<{
  id: MoodType; label: string; hint: string;
  icon: React.ComponentType<{ className?: string }>; ring: string; text: string;
}> = [
  { id: 'happy', label: 'Happy', hint: 'Upbeat and bright', icon: Smile, ring: 'border-amber-400 shadow-amber-500/20', text: 'text-amber-300' },
  { id: 'calm', label: 'Calm', hint: 'Slow and soft', icon: Compass, ring: 'border-teal-400 shadow-teal-500/20', text: 'text-teal-300' },
  { id: 'sad', label: 'Sad', hint: 'Mellow and reflective', icon: CloudRain, ring: 'border-indigo-400 shadow-indigo-500/20', text: 'text-indigo-300' },
  { id: 'energetic', label: 'Energetic', hint: 'Fast and strong', icon: Flame, ring: 'border-rose-400 shadow-rose-500/20', text: 'text-rose-300' },
  { id: 'stressed', label: 'Stressed', hint: 'Tense, need to unwind', icon: AlertCircle, ring: 'border-violet-400 shadow-violet-500/20', text: 'text-violet-300' },
];

const REGIONS = [
  { id: 'all', label: 'Everything', hint: 'A mix of all music' },
  { id: 'pakistani', label: 'Pakistani', hint: 'Songs from Pakistan' },
  { id: 'punjabi', label: 'Punjabi', hint: 'Punjabi songs' },
  { id: 'asian', label: 'Asian', hint: 'Bollywood, K-pop, J-pop and more' },
  { id: 'international', label: 'Universal', hint: 'International and English music' },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
};
const energyLabel = (n: number) => ['Very low', 'Low', 'Medium', 'High', 'Very high'][n - 1];
const tempoWord = (bpm?: number) => (!bpm ? '' : bpm < 80 ? 'Slow' : bpm < 110 ? 'Medium' : 'Fast');

export const PlayerHome: React.FC = () => {
  const {
    currentUser, isAuthenticated, currentMood, latestMoodScore, suggestions, batch,
    checkinMood, runMoodDetection, refreshSuggestions, regionPref, setRegionPref, playSong, currentSong, isPlaying,
    pauseSong, resumeSong, rateSong,
  } = useApp();
  const { simple } = useViewMode();

  const [energy, setEnergy] = useState(3);
  const [busyMood, setBusyMood] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [genre, setGenre] = useState<string | null>(null);
  const [reasonOpen, setReasonOpen] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, number>>({});
  const [hoverStar, setHoverStar] = useState<{ id: string; n: number } | null>(null);
  const [shown, setShown] = useState(10); // how many suggestions are visible

  if (!isAuthenticated || !currentUser) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-white">Sign in to get started</h2>
        <p className="text-zinc-400 mt-2">Create an account or log in to check your mood and get song recommendations.</p>
      </div>
    );
  }

  const activeMood = latestMoodScore?.detected_mood || currentMood;
  const moodInfo = MOODS.find((m) => m.id === activeMood);
  const genres = Array.from(new Set(suggestions.map((s: any) => s.genre).filter(Boolean))) as string[];
  const filtered = genre ? suggestions.filter((s: any) => s.genre === genre) : suggestions;
  const visible = filtered.slice(0, shown);

  const pickMood = async (m: MoodType) => {
    if (busyMood) return;
    setBusyMood(m);
    setGenre(null);
    setShown(10);
    try { await checkinMood(m, energy); } finally { setBusyMood(null); }
  };

  const refresh = async (fn: () => Promise<void>) => {
    setRefreshing(true);
    try { await fn(); } finally { setRefreshing(false); }
  };

  const playMix = () => {
    if (suggestions.length) playSong(suggestions[0], 'suggestion', suggestions[0].suggestion_id);
  };

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap ${
      active ? 'bg-teal-400 text-zinc-950 border-teal-400' : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600'
    }`;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-8 pb-28">
      {/* Mood picker */}
      <section className="rounded-3xl bg-zinc-900/60 border border-zinc-800/80 p-6 sm:p-8 backdrop-blur-xl">
        <p className="text-sm text-zinc-400">
          {greeting()}, <strong className="text-zinc-200">{currentUser.username}</strong>
          {!simple && currentUser.experiment_group && (
            <span className="ml-2 px-2 py-0.5 rounded bg-zinc-800 text-teal-400 border border-zinc-700/80 text-xs font-mono">
              Cohort {currentUser.experiment_group}
            </span>
          )}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-1">How are you feeling right now?</h1>
        <p className="text-sm text-zinc-400 mt-1">Tap a mood and we’ll choose songs to match.</p>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {MOODS.map((m) => {
            const selected = activeMood === m.id;
            const Icon = m.icon;
            const loading = busyMood === m.id;
            return (
              <button
                key={m.id}
                onClick={() => pickMood(m.id)}
                disabled={!!busyMood}
                aria-pressed={selected}
                className={`text-left rounded-2xl border p-4 transition active:scale-[0.98] disabled:opacity-70 ${
                  selected ? `bg-zinc-800 shadow-lg ${m.ring}` : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-600'
                }`}
              >
                {loading ? <Loader2 className={`w-6 h-6 animate-spin ${m.text}`} /> : <Icon className={`w-6 h-6 ${selected ? m.text : 'text-zinc-400'}`} />}
                <p className={`mt-3 text-sm font-semibold ${selected ? 'text-white' : 'text-zinc-200'}`}>{m.label}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">{m.hint}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-zinc-400">
          <label htmlFor="energy" className="shrink-0">How much energy do you have? <span className="text-zinc-200 font-medium">{energyLabel(energy)}</span></label>
          <input id="energy" type="range" min={1} max={5} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="w-full sm:w-56 accent-teal-400 cursor-pointer" />
        </div>

        <div className="mt-6">
          <p className="text-xs text-zinc-400 mb-2">What kind of music do you want?</p>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((r) => (
              <button key={r.id} onClick={() => setRegionPref(r.id)} aria-pressed={regionPref === r.id} title={r.hint} className={chip(regionPref === r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          {regionPref !== 'all' && suggestions.length > 0 &&
  !suggestions.some((s: any) =>
    regionPref === 'asian' ? ['indian', 'korean', 'japanese'].includes(s.region) : s.region === regionPref) && (
            <p className="text-xs text-amber-300 mt-2">
              There are no {REGIONS.find((r) => r.id === regionPref)?.label} songs in the library yet, so you see similar songs instead.
            </p>
          )}
        </div>
      </section>

      {/* What the app understands + main action */}
      <section className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Activity className="w-4 h-4 text-teal-400" /> {simple ? 'What the app understands right now' : 'Detected mood'}
          </div>
          <p className="mt-2 text-base text-white">
            Your mood looks <strong className={`capitalize ${moodInfo?.text || 'text-teal-300'}`}>{activeMood}</strong>
            {suggestions.length > 0 ? `, so your mix below is built for it.` : '. Pick a mood above to get songs.'}
          </p>
          {!simple && (
            <p className="text-xs text-zinc-500 mt-1 font-mono">
              score {latestMoodScore?.mood_score ?? '—'} · skip streak {latestMoodScore?.skip_count ?? 0} · avg energy {latestMoodScore?.avg_energy != null ? `${(latestMoodScore.avg_energy * 100).toFixed(0)}%` : '—'}
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={playMix} disabled={!suggestions.length} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 text-zinc-950 text-sm font-semibold hover:bg-teal-400 disabled:opacity-50">
            <Play className="w-4 h-4 fill-current" /> Play my mood mix
          </button>
          <button onClick={() => refresh(runMoodDetection)} disabled={refreshing} className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-xs font-medium text-zinc-300 disabled:opacity-60">
            {simple ? 'Re-check my mood' : 'Re-evaluate'}
          </button>
        </div>
      </section>

      {/* Suggestions */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400" />
              <h2 className="text-xl font-bold text-white">{simple ? 'Songs picked for you' : 'Suggestion Feed'}</h2>
              {!simple && batch && <span className="text-xs font-mono text-zinc-400">(Batch {String(batch.batch_id).slice(-6)})</span>}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {suggestions.length === 0 ? 'No songs yet. Pick a mood above.' : 'Ranked for your current mood and taste.'}
            </p>
          </div>
          <button onClick={() => refresh(refreshSuggestions)} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-xs font-medium text-zinc-300 disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {simple ? 'Refresh my list' : 'Refresh Suggestions'}
          </button>
        </div>

        {genres.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setGenre(null)} className={chip(genre === null)}>All</button>
            {genres.map((g) => (
              <button key={g} onClick={() => setGenre(genre === g ? null : g)} className={chip(genre === g)}>{g}</button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((sug: any) => {
            const isCurrent = currentSong?.song_id === sug.song_id;
            const playingNow = isCurrent && isPlaying;
            const match = sug.mood_match_score != null ? Math.round(sug.mood_match_score * 100) : null;
            const myRating = rated[sug.suggestion_id] || 0;
            const shownStars = hoverStar && hoverStar.id === sug.suggestion_id ? hoverStar.n : myRating;
            return (
              <div key={sug.suggestion_id} className={`rounded-2xl border p-4 bg-zinc-900/40 hover:bg-zinc-900/70 transition ${isCurrent ? 'border-teal-500/60 shadow-lg shadow-teal-500/10' : 'border-zinc-800/80'}`}>
                <div className="flex items-start gap-3.5">
                  <button
                    onClick={() => (playingNow ? pauseSong() : isCurrent ? resumeSong() : playSong(sug, 'suggestion', sug.suggestion_id))}
                    aria-label={playingNow ? `Pause ${sug.title}` : `Play ${sug.title}`}
                    className="relative w-16 h-16 rounded-xl overflow-hidden bg-zinc-800 shrink-0 group"
                  >
                    {sug.cover_url ? <img src={sug.cover_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-6 h-6 text-zinc-600 absolute inset-0 m-auto" />}
                    <span className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${playingNow ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
                      {playingNow ? <Pause className="w-6 h-6 text-white fill-current" /> : <Play className="w-6 h-6 text-white fill-current" />}
                    </span>
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-bold text-white truncate" title={sug.title}>{sug.title}</h4>
                      <AddToPlaylistButton song={sug} />
                    </div>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">{sug.artist}{sug.genre ? ` · ${sug.genre}` : ''}</p>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      {[tempoWord(sug.tempo) && `${tempoWord(sug.tempo)} tempo`, !simple && sug.total_score != null && `Score ${Number(sug.total_score).toFixed(2)}`].filter(Boolean).join(' · ')}
                    </p>
                    {sug.is_exploration ? (
                      <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                        <Compass className="w-3 h-3" /> Something new
                      </span>
                    ) : match != null && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-zinc-800 overflow-hidden" role="img" aria-label={`Mood match ${match}%`}>
                          <div className="h-full bg-teal-400" style={{ width: `${match}%` }} />
                        </div>
                        <span className="text-[10px] text-zinc-400 font-mono">{match}% match</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800/60">
                  <div className="flex items-center gap-0.5" onMouseLeave={() => setHoverStar(null)}>
                    <span className="text-[11px] text-zinc-400 mr-1.5">{myRating ? 'Your rating:' : 'Rate:'}</span>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        aria-label={`Rate ${n} stars`}
                        onMouseEnter={() => setHoverStar({ id: sug.suggestion_id, n })}
                        onClick={() => { setRated((r) => ({ ...r, [sug.suggestion_id]: n })); rateSong(sug.song_id, n, sug.suggestion_id); }}
                        className="p-0.5"
                      >
                        <Star className={`w-4 h-4 ${n <= shownStars ? 'text-amber-400 fill-amber-400' : 'text-zinc-600'}`} />
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setReasonOpen(reasonOpen === sug.suggestion_id ? null : sug.suggestion_id)} className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-1">
                    <HelpCircle className="w-3 h-3" /> Why this song?
                  </button>
                </div>

                {reasonOpen === sug.suggestion_id && (
                  <div className="mt-3 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-1.5">
                    <span className="font-semibold text-zinc-200">Why we picked this</span>
                    {(sug.reasons || []).length > 0 ? (
                      sug.reasons.map((r: any, i: number) => <div key={i} className="text-zinc-300">· {r.reason_text}</div>)
                    ) : (
                      <p className="text-zinc-500">Matched to your current mood and listening taste.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filtered.length > shown && (
          <div className="text-center">
            <button onClick={() => setShown((n) => n + 10)} className="px-5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-sm font-medium text-zinc-200">
              Show more songs ({filtered.length - shown} left)
            </button>
          </div>
        )}
      </section>
    </div>
  );
};