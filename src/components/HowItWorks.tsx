import React, { useEffect } from 'react';
import { Waves, HeartHandshake, Sparkles, Play, Activity, X } from 'lucide-react';
import { useViewMode } from '../lib/viewMode';

/**
 * Plain-language "How it works" guide.
 * Opens automatically on the first visit and any time the user clicks "How it works" in the header.
 */
export const HowItWorks: React.FC = () => {
  const { guideOpen, closeGuide, setMode, simple } = useViewMode();

  // Close with the Escape key
  useEffect(() => {
    if (!guideOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeGuide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guideOpen, closeGuide]);

  if (!guideOpen) return null;

  const steps = [
    {
      icon: HeartHandshake,
      title: '1. Tell us your mood',
      text: 'On the Home page, tap Happy, Calm, Sad, Energetic or Stressed. You can also say how much energy you have.',
    },
    {
      icon: Sparkles,
      title: '2. Get songs picked for you',
      text: 'We rank songs by how well they fit your mood and your taste. Tap “Why this song?” on any song to see the reasons.',
    },
    {
      icon: Play,
      title: '3. Play, skip or rate',
      text: 'Every action is a hint. Finishing or replaying a song means “more like this”. Skipping means “fewer like this”. Star ratings tell us even more.',
    },
    {
      icon: Activity,
      title: '4. Watch it learn',
      text: 'Your list updates as you go. Skip three songs in a row and we’ll guess you’re stressed and switch to calmer music.',
    },
  ];

  const pages = [
    ['Home', 'Pick your mood and get your songs.'],
    ['Playlists', 'Your saved collections of songs.'],
    ['Mood Journey', 'Builds an 8-song playlist that moves you from one mood to another, for example from stressed to calm.'],
    ['Mood Diary', 'A history of how you’ve been feeling, and which songs lifted your mood.'],
    ['Behind the Scenes', 'For the curious: the database where everything is stored.'],
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-it-works-title"
      onClick={closeGuide}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-zinc-900 border border-zinc-800 shadow-2xl p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeGuide}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close guide"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-950 border border-zinc-700/80 flex items-center justify-center">
            <Waves className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h2 id="how-it-works-title" className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Welcome to MoodTide
            </h2>
            <p className="text-sm text-zinc-400">Music that matches how you feel, and learns what you like.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800/70">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Icon className="w-4 h-4 text-teal-400 shrink-0" />
                  <span>{s.title}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{s.text}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">What’s on each page</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
            {pages.map(([name, desc]) => (
              <li key={name}>
                <strong className="text-white">{name}</strong>
                <span className="text-zinc-400"> · {desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs leading-relaxed text-zinc-300">
          <strong className="text-amber-300">About this demo: </strong>
          the songs are made-up examples, and the sound you hear is a generated ambient tone that matches each song’s
          mood, not a real recording. Everything you do is saved in your browser only.
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          {simple ? (
            <button
              onClick={() => {
                setMode('technical');
                closeGuide();
              }}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2 text-left"
            >
              Showing this to a database teacher? Switch to Technical view
            </button>
          ) : (
            <span className="text-xs text-zinc-500">You’re in Technical view (SQL, tables and triggers are visible).</span>
          )}
          <button
            onClick={closeGuide}
            className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-zinc-950 text-sm font-bold transition-colors"
          >
            Got it, let’s start
          </button>
        </div>
      </div>
    </div>
  );
};