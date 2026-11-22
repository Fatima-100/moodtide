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