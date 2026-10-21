import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Waves, Sparkles, User as UserIcon, Shield, ChevronDown, Check } from 'lucide-react';

interface HeaderProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  onOpenAuth: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentTab, onTabChange, onOpenAuth }) => {
  const { currentUser, schema, switchUser, currentMood, startTour } = useApp();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const isAdmin = currentUser.role_id === 'rol_1';

  // Mood accent styles
  const moodBadgeColors: Record<string, string> = {
    happy: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    calm: 'text-teal-400 border-teal-500/30 bg-teal-500/10',
    sad: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
    energetic: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    stressed: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
  };

  const navLinks = [
    { id: 'player', label: 'Player Home' },
    { id: 'playlists', label: 'Playlists' },
    { id: 'journey', label: 'Mood Journey' },
    { id: 'diary', label: 'Mood Diary' },
    { id: 'database', label: 'Database Explorer' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin Dashboard' }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-3.5">
        {/* Zone 1: Brand title wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onTabChange('player')}
            className="flex items-center gap-2.5 text-left group transition-transform active:scale-95"
          >
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-zinc-100 group-hover:border-zinc-500 transition-colors shadow-sm">
              <Waves className="w-4 h-4 text-teal-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
                MoodTide
              </span>
              <span className="text-[10px] tracking-wider uppercase text-zinc-500 -mt-1 font-mono">
                PostgreSQL · Relational
              </span>
            </div>
          </button>
        </div>

        {/* Zone 2: Single-line clean navigation links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-zinc-400">
          {navLinks.map((link) => {
            const isActive = currentTab === link.id;
            return (
              <button
                key={link.id}
                onClick={() => onTabChange(link.id)}
                className={`transition-colors whitespace-nowrap py-1 relative ${
                  isActive
                    ? 'text-white font-semibold'
                    : 'hover:text-zinc-200'
                }`}
              >
                {link.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal-400 to-amber-400 rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary Actions, Mood Badge & User Switcher */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Current Mood Status */}
          <div
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium capitalize font-mono ${
              moodBadgeColors[currentMood] || 'text-zinc-300 border-zinc-800 bg-zinc-900'
            }`}
            title="Active detected mood guiding the recommendation engine"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            <span>{currentMood}</span>
          </div>

          {/* Guided Tour CTA */}
          <button
            onClick={startTour}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition-colors shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="whitespace-nowrap">Demo Tour</span>
          </button>

          {/* User Profile & Cohort Switcher */}
          <div className="relative">
            <button
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
            >
              {isAdmin ? (
                <Shield className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <UserIcon className="w-3.5 h-3.5 text-teal-400" />
              )}
              <span className="max-w-[100px] truncate">{currentUser.username}</span>
              <span className="text-[10px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">
                {currentUser.experiment_group}
              </span>
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            </button>

            {userDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="px-3 py-2 border-b border-zinc-800 text-xs">
                  <p className="font-semibold text-zinc-100">{currentUser.username}</p>
                  <p className="text-zinc-400 text-[11px] truncate">{currentUser.email}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-zinc-400">
                    <span>Role: <strong className="text-zinc-200 uppercase">{isAdmin ? 'Admin' : 'User'}</strong></span>
                    <span>·</span>
                    <span>A/B Group: <strong className="text-zinc-200">{currentUser.experiment_group === 'A' ? 'A (Taste Only)' : 'B (Mood Aware)'}</strong></span>
                  </div>
                </div>

                <div className="py-1 text-xs">
                  <div className="px-3 py-1 text-[10px] uppercase font-mono tracking-wider text-zinc-500">
                    Switch Active Demo User (12 in DB)
                  </div>
                  {schema.users.slice(0, 6).map((u) => {
                    const isSelected = u.user_id === currentUser.user_id;
                    return (
                      <button
                        key={u.user_id}
                        onClick={() => {
                          switchUser(u.user_id);
                          setUserDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-colors ${
                          isSelected ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
                        }`}
                      >
                        <div className="flex flex-col truncate">
                          <span className="text-xs truncate font-medium">{u.username}</span>
                          <span className="text-[10px] text-zinc-500">{u.email}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-400">
                            Grp {u.experiment_group}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-teal-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between px-2">
                  <button
                    onClick={() => {
                      setUserDropdownOpen(false);
                      onOpenAuth();
                    }}
                    className="text-xs text-teal-400 hover:text-teal-300 font-medium py-1 px-2 rounded hover:bg-teal-500/10 transition-colors"
                  >
                    Custom Login / Signup
                  </button>
                  <button
                    onClick={() => {
                      // quick switch to admin
                      switchUser('usr_admin');
                      setUserDropdownOpen(false);
                    }}
                    className="text-xs text-amber-400 hover:text-amber-300 font-medium py-1 px-2 rounded hover:bg-amber-500/10 transition-colors"
                  >
                    Login as Admin
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile nav scrollbar */}
      <div className="lg:hidden flex items-center gap-4 px-6 py-2 overflow-x-auto border-t border-zinc-800/50 text-xs font-medium text-zinc-400">
        {navLinks.map((link) => {
          const isActive = currentTab === link.id;
          return (
            <button
              key={link.id}
              onClick={() => onTabChange(link.id)}
              className={`whitespace-nowrap py-1 ${
                isActive ? 'text-white font-semibold' : 'hover:text-zinc-200'
              }`}
            >
              {link.label}
            </button>
          );
        })}
      </div>
    </header>
  );
};
