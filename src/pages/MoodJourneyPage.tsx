import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fmtDay, fmtTime, metaOf, MOOD_KEYS, MOOD_META, type Mood, type MoodScore } from '../lib/mood';
interface JourneySong {
  position: number;
  song_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  energy: number | null;
  happiness: number | null;
  tempo: number | null;
}
interface Playlist {
  playlist_id: string;
  name: string;
  start_mood: string | null;
  target_mood: string | null;
  created_at: string;
  song_count?: number;
  songs?: JourneySong[];
}

const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Any region' },
  { value: 'pakistani', label: 'Pakistani only' },
  { value: 'not_pakistani', label: 'Not Pakistani' },
  { value: 'punjabi', label: 'Punjabi only' },
  { value: 'indian', label: 'Indian only' },
  { value: 'korean', label: 'Korean only' },
  { value: 'japanese', label: 'Japanese only' },
  { value: 'international', label: 'International only' },
];

/* ---------- timeline of detected mood ---------- */
function Timeline({ scores }: { scores: MoodScore[] }) {
  const W = 720, H = 220, PX = 36, PY = 20;
  const pts = scores.map((s, i) => ({
    x: scores.length === 1 ? W / 2 : PX + (i * (W - PX * 2)) / (scores.length - 1),
    y: PY + (1 - Math.min(100, Math.max(0, s.mood_score)) / 100) * (H - PY * 2),
    s,
  }));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="Mood score over time">
        {[0, 50, 100].map((v) => {
          const y = PY + (1 - v / 100) * (H - PY * 2);
          return (
            <g key={v}>
              <line x1={PX} x2={W - PX} y1={y} y2={y} stroke="#3f3f46" strokeDasharray="3 4" />
              <text x={4} y={y + 4} fontSize="11" fill="#a1a1aa">{v}</text>
            </g>
          );
        })}
        <polyline fill="none" stroke="#71717a" strokeWidth="1.5" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
        {pts.map((p) => (
          <circle key={p.s.score_id} cx={p.x} cy={p.y} r="5" fill={metaOf(p.s.detected_mood).color}>
            <title>{`${metaOf(p.s.detected_mood).label}, score ${Math.round(p.s.mood_score)} · ${fmtDay(p.s.calculated_at)} ${fmtTime(p.s.calculated_at)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

/* ---------- one song in a journey ---------- */
function SongRow({ s, n, last }: { s: JourneySong; n: number; last: boolean }) {
  const energy = Math.round((s.energy ?? 0) * 100);
  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <span className="w-6 shrink-0 text-right text-sm text-zinc-500">{n}</span>
      {s.cover_url ? (
        <img src={s.cover_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" loading="lazy" />
      ) : (
        <span className="h-11 w-11 shrink-0 rounded-lg bg-zinc-800" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{s.title}</p>
        <p className="truncate text-xs text-zinc-400">{s.artist}{last ? ' · where you land' : ''}</p>
      </div>
      <div className="hidden w-40 shrink-0 sm:block" title={`Energy ${energy}%`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-zinc-200" style={{ width: `${energy}%` }} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">Energy {energy}%{s.tempo ? ` · ${s.tempo} BPM` : ''}</p>
      </div>
    </li>
  );
}

export const MoodJourneyPage = () => {
  const [scores, setScores] = useState<MoodScore[] | null>(null);
  const [journeys, setJourneys] = useState<Playlist[]>([]);
  const [from, setFrom] = useState<Mood>('stressed');
  const [to, setTo] = useState<Mood>('calm');
  const [open, setOpen] = useState<Playlist | null>(null);
  const [region, setRegion] = useState('all');
  const [building, setBuilding] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savingCopy, setSavingCopy] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [h, pls] = await Promise.all([
        api<MoodScore[]>('/mood/history'),
        api<Playlist[]>('/playlists'),
      ]);
      setScores([...h].reverse()); // oldest first for the chart
      setJourneys(pls.filter((p) => p.start_mood && p.target_mood));
      const latest = h[0] ? metaOf(h[0].detected_mood).label.toLowerCase() : '';
      const m = MOOD_KEYS.find((k) => latest.startsWith(k));
      if (m) setFrom(m);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your mood data.');
      setScores([]);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openPlaylist = async (id: string) => {
    try {
      const pl = await api<Playlist>(`/playlists/${id}`);
      setOpen(pl);
      setSaveName(pl.name);
      setSavedMsg('');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that journey.');
    }
  };

  const build = async () => {
    setBuilding(true);
    setError('');
    try {
      const { playlist_id } = await api<{ playlist_id: string }>('/playlists/journey', { method: 'POST', body: { from, to, region } });
      await openPlaylist(playlist_id);
      const pls = await api<Playlist[]>('/playlists');
      setJourneys(pls.filter((p) => p.start_mood && p.target_mood));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the journey.');
    } finally {
      setBuilding(false);
    }
  };

  const saveCopy = async () => {
    if (!open?.songs?.length) return;
    const name = saveName.trim();
    if (!name) { setError('Give your playlist a name.'); return; }
    setSavingCopy(true);
    setError('');
    setSavedMsg('');
    try {
      const { playlist_id } = await api<{ playlist_id: string }>('/playlists', {
        method: 'POST',
        body: { name, description: `Saved from a mood journey: ${open.name}` },
      });
      for (const s of open.songs) {
        await api(`/playlists/${playlist_id}/songs`, { method: 'POST', body: { songId: s.song_id } });
      }
      setSavedMsg(`Saved “${name}” with ${open.songs.length} songs. You can find it in Playlists.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the playlist.');
    } finally {
      setSavingCopy(false);
    }
  };

  const summary = useMemo(() => {
    if (!scores || scores.length === 0) return null;
    const avg = scores.reduce((a, s) => a + s.mood_score, 0) / scores.length;
    const counts = new Map<string, number>();
    for (const s of scores) counts.set(metaOf(s.detected_mood).label, (counts.get(metaOf(s.detected_mood).label) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { avg: Math.round(avg), top: top[0], n: scores.length };
  }, [scores]);

  const sel = 'rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight">Mood journey</h1>
      <p className="mt-2 max-w-xl text-zinc-400">
        See how your mood moved over time, then build a playlist that walks you from one mood to another.
      </p>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* timeline */}
      <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">Your mood over time</h2>
          {summary && (
            <p className="text-sm text-zinc-400">
              {summary.n} readings · average score {summary.avg} · most often {summary.top}
            </p>
          )}
        </div>
        {scores === null ? (
          <p className="mt-4 text-sm text-zinc-400">Loading…</p>
        ) : scores.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-white/15 px-6 py-8 text-center text-sm text-zinc-400">
            No readings yet. Save a check-in in the Mood diary and your first point appears here.
          </p>
        ) : (
          <>
            <div className="mt-4"><Timeline scores={scores} /></div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
              {MOOD_KEYS.map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${MOOD_META[k].dot}`} />{MOOD_META[k].label}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* journey builder */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-medium">Build a journey</h2>
        <p className="mt-1 text-sm text-zinc-400">Pick where you are and where you want to end up.</p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="from" className="block text-xs text-zinc-400">Start at</label>
            <select id="from" className={`mt-1 ${sel}`} value={from} onChange={(e) => setFrom(e.target.value as Mood)}>
              {MOOD_KEYS.map((k) => <option key={k} value={k}>{MOOD_META[k].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="to" className="block text-xs text-zinc-400">End at</label>
            <select id="to" className={`mt-1 ${sel}`} value={to} onChange={(e) => setTo(e.target.value as Mood)}>
              {MOOD_KEYS.map((k) => <option key={k} value={k}>{MOOD_META[k].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="region" className="block text-xs text-zinc-400">Songs from</label>
            <select id="region" className={`mt-1 ${sel}`} value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGION_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={build}
            disabled={building || from === to}
            className="rounded-xl bg-white px-5 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {building ? 'Building…' : 'Build journey playlist'}
          </button>
        </div>
        {from === to && <p className="mt-3 text-sm text-zinc-500">Choose two different moods to build a journey.</p>}

        {open && (
          <div className="mt-6">
            <h3 className="font-medium">{open.name}</h3>
            {open.songs && open.songs.length > 0 ? (
              <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/20">
                {open.songs.map((s, i) => (
                  <SongRow key={s.song_id} s={s} n={i + 1} last={i === open.songs!.length - 1} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-400">This journey has no songs. Import more songs, then build it again.</p>
            )}

            {open.songs && open.songs.length > 0 && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <label htmlFor="saveName" className="block text-xs text-zinc-400">Playlist name</label>
                  <input
                    id="saveName"
                    type="text"
                    maxLength={100}
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    className={`mt-1 w-full ${sel}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={saveCopy}
                  disabled={savingCopy}
                  className="rounded-xl border border-white/20 px-5 py-2 text-sm font-medium transition hover:bg-white/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  {savingCopy ? 'Saving…' : 'Save as my playlist'}
                </button>
              </div>
            )}
            {savedMsg && <p className="mt-3 text-sm text-emerald-300" role="status">{savedMsg}</p>}
          </div>
        )}
      </section>

      {/* earlier journeys */}
      {journeys.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-medium">Your earlier journeys</h2>
          <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
            {journeys.map((p) => (
              <li key={p.playlist_id}>
                <button
                  type="button"
                  onClick={() => openPlaylist(p.playlist_id)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <span className={`rounded-full border px-2.5 py-0.5 ${metaOf(p.start_mood).chip}`}>{metaOf(p.start_mood).label}</span>
                  <span className="text-zinc-500">to</span>
                  <span className={`rounded-full border px-2.5 py-0.5 ${metaOf(p.target_mood).chip}`}>{metaOf(p.target_mood).label}</span>
                  <span className="ml-auto text-zinc-400">{p.song_count ?? 0} songs · {fmtDay(p.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};