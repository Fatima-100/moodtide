export type MoodType = 'happy' | 'calm' | 'sad' | 'energetic' | 'stressed';

export const MOOD_COORDINATES: Record<
  MoodType,
  { energy: number; happiness: number; tempo: number; label: string; accentColor: string; bgGlow: string }
> = {
  happy:     { energy: 0.75, happiness: 0.85, tempo: 124, label: 'Happy', accentColor: 'amber', bgGlow: 'from-amber-500/20 via-orange-500/10 to-transparent' },
  calm:      { energy: 0.32, happiness: 0.65, tempo: 78,  label: 'Calm', accentColor: 'teal',  bgGlow: 'from-teal-500/20 via-emerald-500/10 to-transparent' },
  sad:       { energy: 0.28, happiness: 0.22, tempo: 68,  label: 'Sad / Melancholic', accentColor: 'indigo', bgGlow: 'from-indigo-600/20 via-blue-900/10 to-transparent' },
  energetic: { energy: 0.88, happiness: 0.72, tempo: 138, label: 'Energetic', accentColor: 'rose', bgGlow: 'from-rose-500/20 via-pink-600/10 to-transparent' },
  stressed:  { energy: 0.65, happiness: 0.28, tempo: 110, label: 'Stressed / Frustrated', accentColor: 'violet', bgGlow: 'from-violet-600/20 via-purple-900/10 to-transparent' },
};

export type Mood = MoodType;
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