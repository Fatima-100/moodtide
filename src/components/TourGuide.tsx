import React from 'react';
import { useApp } from '../context/AppContext';
import { Sparkles, ArrowRight, X, Database, HeartHandshake, Play, SkipForward, Star, Table } from 'lucide-react';

interface TourGuideProps {
  onNavigateTab: (tab: string) => void;
}

export const TourGuide: React.FC<TourGuideProps> = ({ onNavigateTab }) => {
  const { tourStep, nextTourStep, exitTour, openSqlModal } = useApp();

  if (!tourStep) return null;

  const steps = [
    {
      step: 1,
      title: 'Step 1: Mood Check-in',
      icon: HeartHandshake,
      description:
        'Tap one of the 5 mood buttons (e.g. Calm, Energetic, Stressed). This inserts a row into the Mood_Checkins table and executes the detectMood() PostgreSQL rule procedure.',
      actionText: 'Tap a mood above or Next',
    },
    {
      step: 2,
      title: 'Step 2: Start Audio Playback',
      icon: Play,
      description:
        'Click the Play button on any recommended song. The ambient Web Audio synthesizer generates harmonic chords keyed to the song’s valence and tempo.',
      actionText: 'Click Play or Next',
    },
    {
      step: 3,
      title: 'Step 3: Trigger the Skip Rule',
      icon: SkipForward,
      description:
        'Click the Skip button in the bottom player bar. The database trigger logs a -1 implicit signal into Implicit_Signals. (Tip: 3 skips in a row automatically flags a Stressed state!)',
      actionText: 'Click Skip or Next',
    },
    {
      step: 4,
      title: 'Step 4: Rate a Song (Trigger Stored Procedure)',
      icon: Star,
      description:
        'Click 5 stars on any recommendation. The onSongRate trigger validates the CHECK constraint (stars 1-5), records the rating, and immediately updates User_Taste_Profile affinity.',
      actionText: 'Rate a song or Next',
    },
    {
      step: 5,
      title: 'Step 5: Inspect Explainable AI & Show SQL',
      icon: Database,
      description:
        'Notice the "Why this song?" explanation tags on each track and click "Show SQL" to view the exact PostgreSQL transaction and ranking queries that generated this batch.',
      actionText: 'Next: Explore Tables',
    },
    {
      step: 6,
      title: 'Step 6: Relational Database Explorer',
      icon: Table,
      description:
        'Navigate to the Database Explorer tab to inspect all 25 PostgreSQL tables, primary/foreign key relationships, and watch the live Audit_Log update in real time!',
      actionText: 'Open Database Explorer',
    },
  ];

  const current = steps[tourStep - 1] || steps[0];
  const Icon = current.icon;

  const handleNext = () => {
    if (tourStep === 6) {
      onNavigateTab('database');
      exitTour();
    } else {
      nextTourStep();
    }
  };

  return (
    <div className="fixed top-20 right-6 z-50 max-w-sm w-full bg-zinc-900 border-2 border-teal-500/80 rounded-2xl shadow-2xl p-5 text-zinc-100 backdrop-blur-md animate-in fade-in slide-in-from-right-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-teal-400 font-semibold text-xs tracking-wider uppercase font-mono">
          <Sparkles className="w-4 h-4" />
          <span>Demo Tour · Step {tourStep} of 6</span>
        </div>
        <button
          onClick={exitTour}
          className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-3 mt-3">
        <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0 border border-teal-500/30">
          <Icon className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-bold text-white">{current.title}</h4>
      </div>

      <p className="text-xs text-zinc-300 mt-2.5 leading-relaxed">
        {current.description}
      </p>

      {/* Progress indicators */}
      <div className="flex items-center gap-1.5 mt-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full flex-1 transition-all ${
              i === tourStep ? 'bg-teal-400' : i < tourStep ? 'bg-teal-700' : 'bg-zinc-800'
            }`}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-zinc-800">
        <button
          onClick={exitTour}
          className="text-xs text-zinc-400 hover:text-zinc-200 font-medium"
        >
          End Tour
        </button>

        <button
          onClick={handleNext}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-zinc-950 font-semibold text-xs transition-colors shadow-sm"
        >
          <span>{current.actionText}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
