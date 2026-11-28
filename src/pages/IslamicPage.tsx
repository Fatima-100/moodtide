import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Category { genre_id: string; name: string }
interface IslamicSong {
  song_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration_sec: number | null;
  external_id: string | null;
  external_url: string | null;
  genre: string | null;
}

const fmtDuration = (s: number | null) =>
  s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';

export const IslamicPage = () => {
  const [cats, setCats] = useState<Category[]>([]);
  const [cat, setCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<IslamicSong[] | null>(null);
  const [playing, setPlaying] = useState<IslamicSong | null>(null);
  const [error, setError] = useState('');

  // categories (Naat, Hamd, Qasida, Darood, ...)
  useEffect(() => {
    api<Category[]>('/genres?type=islamic')
      .then(setCats)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the categories.'));
  }, []);

  // wait a moment after typing before searching
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    setSongs(null);
    const qs = new URLSearchParams({ type: 'islamic', limit: '100', sort: 'popular' });
    if (cat !== 'all') qs.set('genre', cat);
    if (query) qs.set('q', query);
    api<IslamicSong[]>(`/songs?${qs.toString()}`)
      .then((r) => { if (live) { setSongs(r); setError(''); } })
      .catch((e) => { if (live) { setError(e instanceof Error ? e.message : 'Could not load the list.'); setSongs([]); } });
    return () => { live = false; };
  }, [cat, query]);

  const pill = (on: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
      on ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' : 'border-white/10 text-zinc-300 hover:border-white/30'
    }`;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight">Islamic</h1>
      <p className="mt-2 max-w-xl text-zinc-400">
        Naat, hamd, qasida, darood, kalam and more. Nothing you play here changes your mood readings or your music suggestions.
      </p>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* player */}
      {playing && (
        <section className="mt-6 rounded-2xl border border-emerald-400/20 bg-white/5 p-4">
          {playing.external_id ? (
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
              <iframe
                key={playing.song_id}
                title={playing.title}
                className="h-full w-full"
                src={`https://www.youtube.com/embed/${playing.external_id}?autoplay=1&rel=0`}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              This item has no embedded player.{' '}
              {playing.external_url && <a className="underline" href={playing.external_url} target="_blank" rel="noreferrer">Open on YouTube</a>}
            </p>
          )}
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{playing.title}</p>
              <p className="truncate text-sm text-zinc-400">{playing.artist}</p>
            </div>
            <button
              type="button"
              onClick={() => setPlaying(null)}
              className="shrink-0 rounded-lg border border-white/15 px-3 py-1 text-sm text-zinc-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Close
            </button>
          </div>
        </section>
      )}

      {/* categories + search */}
      <div className="mt-6 flex flex-wrap items-center gap-2" role="tablist" aria-label="Category">
        <button type="button" role="tab" aria-selected={cat === 'all'} className={pill(cat === 'all')} onClick={() => setCat('all')}>
          All
        </button>
        {cats.map((c) => (
          <button key={c.genre_id} type="button" role="tab" aria-selected={cat === c.genre_id} className={pill(cat === c.genre_id)} onClick={() => setCat(c.genre_id)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="islamic-search" className="sr-only">Search the Islamic section</label>
        <input
          id="islamic-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or reciter"
          className="w-full max-w-md rounded-xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        />
      </div>

      {/* list */}
      <section className="mt-6">
        {songs === null ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : songs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center text-zinc-400">
            {query || cat !== 'all' ? 'Nothing matches. Try another category or search.' : 'No Islamic items have been added yet.'}
          </div>
        ) : (
          <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
            {songs.map((s) => {
              const on = playing?.song_id === s.song_id;
              return (
                <li key={s.song_id}>
                  <button
                    type="button"
                    onClick={() => setPlaying(s)}
                    aria-current={on}
                    className={`flex w-full items-center gap-4 px-5 py-3 text-left transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${on ? 'bg-emerald-400/10' : ''}`}
                  >
                    {s.cover_url ? (
                      <img src={s.cover_url} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="h-12 w-12 shrink-0 rounded-lg bg-zinc-800" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.title}</span>
                      <span className="block truncate text-xs text-zinc-400">{s.artist}</span>
                    </span>
                    {s.genre && (
                      <span className="hidden shrink-0 rounded-full border border-emerald-400/25 px-2.5 py-0.5 text-xs text-emerald-200 sm:inline">
                        {s.genre}
                      </span>
                    )}
                    <span className="w-12 shrink-0 text-right text-xs text-zinc-500">{fmtDuration(s.duration_sec)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};