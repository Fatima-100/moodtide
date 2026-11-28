import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fmtDay, fmtTime, metaOf, MOOD_KEYS, MOOD_META, type Mood, type MoodScore } from '../lib/mood';
interface Checkin {
  checkin_id: string;
  mood_label: string;
  energy_level: number;
  checked_at: string;
}

const ENERGY_WORDS = ['Very low', 'Low', 'Medium', 'High', 'Very high'];

function EnergyDots({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`Energy ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-1.5 w-3 rounded-full ${i <= level ? 'bg-zinc-200' : 'bg-zinc-700'}`} />
      ))}
    </span>
  );
}

export const MoodDiaryPage = () => {
  const [checkins, setCheckins] = useState<Checkin[] | null>(null);
  const [current, setCurrent] = useState<MoodScore | null>(null);
  const [mood, setMood] = useState<Mood>('calm');
  const [energy, setEnergy] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, cur] = await Promise.all([
        api<Checkin[]>('/mood/checkins'),
        api<MoodScore | null>('/mood/current'),
      ]);
      setCheckins(c);
      setCurrent(cur);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your diary.');
      setCheckins([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved('');
    try {
      await api('/checkins', { method: 'POST', body: { mood, energy } });
      setSaved(`Saved: ${MOOD_META[mood].label}, energy ${ENERGY_WORDS[energy - 1].toLowerCase()}. Your suggestions were refreshed.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your check-in.');
    } finally {
      setSaving(false);
    }
  };

  const days = useMemo(() => {
    const out: { day: string; items: Checkin[] }[] = [];
    for (const c of checkins ?? []) {
      const day = fmtDay(c.checked_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(c);
      else out.push({ day, items: [c] });
    }
    return out;
  }, [checkins]);

  const mix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of checkins ?? []) {
      const label = metaOf(c.mood_label).label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const total = checkins?.length ?? 0;
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => ({ label, n, pct: total ? Math.round((n / total) * 100) : 0, meta: metaOf(label) }));
  }, [checkins]);

  const cur = current ? metaOf(current.detected_mood) : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight">Mood diary</h1>
      <p className="mt-2 max-w-xl text-zinc-400">
        Log how you feel and MoodTide uses it to pick your next songs. Each check-in also refreshes your suggestions.
      </p>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        {/* check-in form */}
        <section className="lg:col-span-3 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">How are you feeling right now?</h2>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Mood">
            {MOOD_KEYS.map((k) => {
              const m = MOOD_META[k];
              const on = mood === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMood(k)}
                  className={`rounded-xl border px-3 py-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                    on ? `${m.chip} font-medium` : 'border-white/10 text-zinc-300 hover:border-white/30'
                  }`}
                >
                  <span className={`mr-2 inline-block h-2 w-2 rounded-full ${m.dot}`} />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            <div className="flex items-baseline justify-between text-sm">
              <label htmlFor="energy" className="text-zinc-300">Energy level</label>
              <span className="text-zinc-400">{ENERGY_WORDS[energy - 1]}</span>
            </div>
            <input
              id="energy"
              type="range"
              min={1}
              max={5}
              step={1}
              value={energy}
              onChange={(e) => setEnergy(Number(e.target.value))}
              className="mt-2 w-full accent-white"
            />
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {saving ? 'Saving…' : 'Save check-in'}
          </button>
          {saved && <p className="mt-3 text-sm text-emerald-300" role="status">{saved}</p>}
        </section>

        {/* what MoodTide detects */}
        <section className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">What MoodTide detects</h2>
          {current && cur ? (
            <div className="mt-4">
              <span className={`inline-block rounded-full border px-3 py-1 text-sm ${cur.chip}`}>{cur.label}</span>
              <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
                <dt className="text-zinc-400">Mood score</dt>
                <dd className="text-right">{Math.round(current.mood_score)} / 100</dd>
                <dt className="text-zinc-400">Time of day</dt>
                <dd className="text-right capitalize">{current.time_of_day ?? '—'}</dd>
                <dt className="text-zinc-400">Average energy</dt>
                <dd className="text-right">{current.avg_energy != null ? Number(current.avg_energy).toFixed(2) : '—'}</dd>
                <dt className="text-zinc-400">Skips in a row</dt>
                <dd className="text-right">{current.skip_count ?? 0}</dd>
              </dl>
              <p className="mt-4 text-xs text-zinc-500">Updated {fmtDay(current.calculated_at)}, {fmtTime(current.calculated_at)}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-400">Nothing detected yet. Save a check-in and your first reading appears here.</p>
          )}
        </section>
      </div>

      {/* mood mix */}
      {mix.length > 0 && (
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-medium">Your mix across {checkins?.length} check-ins</h2>
          <ul className="mt-4 space-y-3">
            {mix.map((m) => (
              <li key={m.label} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-zinc-300">{m.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <span className={`block h-full rounded-full ${m.meta.dot}`} style={{ width: `${m.pct}%` }} />
                </span>
                <span className="w-12 text-right text-zinc-400">{m.pct}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* history */}
      <section className="mt-6">
        <h2 className="text-lg font-medium">Past check-ins</h2>
        {checkins === null ? (
          <p className="mt-4 text-sm text-zinc-400">Loading…</p>
        ) : days.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center text-zinc-400">
            No check-ins yet. Pick a mood above and save your first one.
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {days.map((d) => (
              <div key={d.day}>
                <h3 className="text-sm text-zinc-400">{d.day}</h3>
                <ul className="mt-2 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
                  {d.items.map((c) => {
                    const m = metaOf(c.mood_label);
                    return (
                      <li key={c.checkin_id} className="flex items-center gap-4 px-5 py-3">
                        <span className="w-20 shrink-0 text-sm text-zinc-400">{fmtTime(c.checked_at)}</span>
                        <span className={`rounded-full border px-3 py-0.5 text-sm ${m.chip}`}>{m.label}</span>
                        <span className="ml-auto flex items-center gap-3 text-sm text-zinc-400">
                          {ENERGY_WORDS[c.energy_level - 1] ?? ''}
                          <EnergyDots level={c.energy_level} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};