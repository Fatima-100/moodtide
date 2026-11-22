import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { catalogApi } from '../lib/api';
import { Search, Play, Pause, X, Music2 } from 'lucide-react';

// same mood targets the backend uses, so the match % agrees with the suggestions
const MOOD_POINT: Record<string, { e: number; h: number }> = {
  happy: { e: 0.75, h: 0.85 },
  calm: { e: 0.32, h: 0.65 },
  sad: { e: 0.28, h: 0.22 },
  energetic: { e: 0.88, h: 0.72 },
  stressed: { e: 0.65, h: 0.28 },
};

const REGIONS = [
  { id: 'all', label: 'Everything', hint: 'A mix of all music' },
  { id: 'pakistani', label: 'Pakistani', hint: 'Songs from Pakistan' },
  { id: 'punjabi', label: 'Punjabi', hint: 'Punjabi songs' },
  { id: 'asian', label: 'Asian', hint: 'Bollywood, K-pop, J-pop and more' },
  { id: 'international', label: 'Universal', hint: 'International and English music' },
];

const PAGE = 40; // songs loaded per click

const SORTS = [
  { id: 'popular', label: 'Most popular' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'title', label: 'Song A-Z' },
  { id: 'artist', label: 'Singer A-Z' },
];

const moodMatch = (song: any, mood: string) => {
  const t = MOOD_POINT[mood];
  if (!t || song.energy == null || song.happiness == null) return null;
  return Math.round(100 * Math.max(0, 1 - Math.hypot(song.energy - t.e, song.happiness - t.h)));
};

export const BrowsePage: React.FC = () => {
  const { playSong, currentSong, isPlaying, pauseSong, resumeSong, currentMood } = useApp();
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [artist, setArtist] = useState<{ artist_id: string; name: string } | null>(null);
  const [sort, setSort] = useState('popular');
  const [region, setRegion] = useState('all');
  const [songs, setSongs] = useState<any[]>([]);
  const [genres, setGenres] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  // genres and singers load once
  useEffect(() => {
    catalogApi.genres().then(setGenres).catch(() => {});
    catalogApi.artists().then(setArtists).catch(() => {});
  }, []);

  // songs reload whenever a filter changes (search waits 300 ms after typing stops)
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const rows = await catalogApi.songs({ q, genre, artist: artist?.artist_id, sort, limit: PAGE, region });
        setSongs(rows);
        setHasMore(rows.length === PAGE);
      } catch (e: any) {
        setError(e.message || 'Could not load songs');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, genre, artist, sort, region]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const rows = await catalogApi.songs({ q, genre, artist: artist?.artist_id, sort, limit: PAGE, offset: songs.length, region });
      setSongs((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.song_id === r.song_id))]);
      setHasMore(rows.length === PAGE);
    } catch (e: any) {
      setError(e.message || 'Could not load more songs');
    } finally {
      setLoadingMore(false);
    }
  };

  const togglePlay = (song: any) => {
    if (currentSong?.song_id === song.song_id) {
      isPlaying ? pauseSong() : resumeSong();
    } else {
      playSong(song, 'search', null);
    }
  };

  const hasFilter = q || genre || artist;
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap ${
      active ? 'bg-teal-400 text-zinc-950 border-teal-400' : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600'
    }`;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6 pb-28">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search songs, singers or albums"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-9 py-2.5 text-sm text-zinc-100 outline-none focus:border-teal-400"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort songs"
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-teal-400"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setGenre(null)} className={chip(genre === null)}>All categories</button>
        {genres.map((g) => (
          <button key={g.genre_id} onClick={() => setGenre(genre === g.genre_id ? null : g.genre_id)} className={chip(genre === g.genre_id)}>
            {g.name}
          </button>
        ))}
      </div>

      {/* Kind of music */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {REGIONS.map((r) => (
          <button key={r.id} onClick={() => setRegion(r.id)} title={r.hint} className={chip(region === r.id)}>{r.label}</button>
        ))}
      </div>

      {/* Singers */}
      {artists.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">Singers</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {artists.slice(0, 20).map((a) => {
              const active = artist?.artist_id === a.artist_id;
              return (
                <button
                  key={a.artist_id}
                  onClick={() => setArtist(active ? null : { artist_id: a.artist_id, name: a.name })}
                  className="flex flex-col items-center gap-1.5 w-20 shrink-0"
                >
                  <div className={`w-16 h-16 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center border-2 ${active ? 'border-teal-400' : 'border-transparent'}`}>
                    {a.cover_url ? <img src={a.cover_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-5 h-5 text-zinc-500" />}
                  </div>
                  <span className={`text-[11px] text-center leading-tight line-clamp-2 ${active ? 'text-teal-300' : 'text-zinc-400'}`}>{a.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Active filters */}
      {hasFilter && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>{songs.length} result{songs.length === 1 ? '' : 's'}</span>
          {artist && <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200">{artist.name}</span>}
          <button onClick={() => { setQ(''); setGenre(null); setArtist(null); }} className="text-teal-400 hover:underline">Clear filters</button>
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      {loading && songs.length === 0 ? (
        <p className="text-sm text-zinc-400">Loading songs…</p>
      ) : songs.length === 0 && !error ? (
        <p className="text-sm text-zinc-500">No songs match. Try a different word or clear the filters.</p>
      ) : (
        <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 ${loading ? 'opacity-60' : ''}`}>
          {songs.map((s) => {
            const match = moodMatch(s, currentMood);
            const playingThis = currentSong?.song_id === s.song_id && isPlaying;
            return (
              <div key={s.song_id} className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <button onClick={() => togglePlay(s)} aria-label={playingThis ? 'Pause' : 'Play'} className="relative block w-full aspect-square rounded-lg overflow-hidden bg-zinc-800">
                  {s.cover_url ? <img src={s.cover_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-8 h-8 text-zinc-600 absolute inset-0 m-auto" />}
                  <span className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${playingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}>
                    {playingThis ? <Pause className="w-8 h-8 text-white" /> : <Play className="w-8 h-8 text-white" />}
                  </span>
                </button>
                <h3 className="mt-2 text-sm font-semibold text-white truncate" title={s.title}>{s.title}</h3>
                <button onClick={() => setArtist({ artist_id: s.artist_id, name: s.artist })} className="text-xs text-zinc-400 hover:text-teal-300 truncate block max-w-full text-left">
                  {s.artist}
                </button>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
                  <span className="truncate">{[s.genre, s.release_year].filter(Boolean).join(' · ')}</span>
                  {match != null && <span className="text-teal-400 font-medium shrink-0 ml-2">{match}% {currentMood}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <div className="text-center">
          <button onClick={loadMore} disabled={loadingMore} className="px-5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-sm font-medium text-zinc-200 disabled:opacity-60">
            {loadingMore ? 'Loading…' : 'Load more songs'}
          </button>
        </div>
      )}
    </div>
  );
};