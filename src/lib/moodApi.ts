// Shared helper for the Mood Diary and Mood Journey pages.
//
// IF YOUR APP ALREADY HAS A FETCH HELPER (probably in src/lib/db.ts), replace the body of
// `api()` below with a call to it. The two things to match are the base URL and where the
// login token is stored.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE: string = (import.meta as any).env?.VITE_API_URL ?? '/api';
const TOKEN_KEYS = ['moodtide_token', 'token', 'authToken', 'accessToken', 'jwt'];

function token(): string {
  for (const k of TOKEN_KEYS) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  return '';
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = token();
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new Error(String(msg));
  }
  return data as T;
}

export type Mood = 'happy' | 'calm' | 'sad' | 'energetic' | 'stressed';
export const MOOD_KEYS: Mood[] = ['happy', 'calm', 'sad', 'energetic', 'stressed'];

export interface MoodMeta {
  label: string;
  chip: string; // classes for a small badge
  dot: string;  // classes for a colour dot or bar
  color: string; // hex for SVG
}

export const MOOD_META: Record<Mood, MoodMeta> = {
  happy:     { label: 'Happy',      chip: 'bg-amber-400/15 text-amber-300 border-amber-400/30',   dot: 'bg-amber-400',   color: '#fbbf24' },
  calm:      { label: 'Calm',       chip: 'bg-sky-400/15 text-sky-300 border-sky-400/30',         dot: 'bg-sky-400',     color: '#38bdf8' },
  sad:       { label: 'Sad',        chip: 'bg-indigo-400/15 text-indigo-300 border-indigo-400/30', dot: 'bg-indigo-400',  color: '#818cf8' },
  energetic: { label: 'Energetic',  chip: 'bg-orange-400/15 text-orange-300 border-orange-400/30', dot: 'bg-orange-400',  color: '#fb923c' },
  stressed:  { label: 'Stressed',   chip: 'bg-rose-400/15 text-rose-300 border-rose-400/30',      dot: 'bg-rose-400',    color: '#fb7185' },
};

const UNKNOWN: MoodMeta = {
  label: 'Unknown', chip: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30', dot: 'bg-zinc-400', color: '#a1a1aa',
};

/** Works with 'happy', 'Happy', 'Sad / Melancholic' and so on. */
export function metaOf(label: string | null | undefined): MoodMeta {
  const l = String(label ?? '').toLowerCase();
  const key = MOOD_KEYS.find((k) => l.startsWith(k));
  return key ? MOOD_META[key] : { ...UNKNOWN, label: label || 'Unknown' };
}

export interface MoodScore {
  score_id: string;
  calculated_at: string;
  detected_mood: string;
  mood_score: number;
  skip_count: number | null;
  replay_count: number | null;
  time_of_day: string | null;
  avg_energy: number | null;
  avg_tempo: number | null;
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });