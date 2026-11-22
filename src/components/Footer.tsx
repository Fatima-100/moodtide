import React from 'react';
import { useViewMode } from '../lib/viewMode';

export const Footer: React.FC = () => {
  const { simple } = useViewMode();

  return (
    <footer className="w-full border-t border-zinc-800/80 bg-zinc-950/90 py-6 px-6 mt-16 mb-40 sm:mb-24 text-xs text-zinc-500">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-zinc-400 font-medium">
          {simple
            ? 'MoodTide — music recommendations powered by your mood.'
            : 'MoodTide · Real API + SQL Server · Mood-aware suggestion engine'}
        </p>
        <p className="text-zinc-600">© {new Date().getFullYear()} MoodTide</p>
      </div>
    </footer>
  );
};