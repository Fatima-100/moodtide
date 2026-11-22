import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Waves, Sparkles, User as UserIcon, Shield, ChevronDown, HelpCircle, LogOut, LogIn } from 'lucide-react';
import { useViewMode } from '../lib/viewMode';

interface HeaderProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  onOpenAuth: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentTab, onTabChange, onOpenAuth }) => {
  const { currentUser, isAuthenticated, currentMood, startTour, logout } = useApp();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const { simple, setMode, openGuide } = useViewMode();

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role_id === 'rol_1';

  const moodBadgeColors: Record<string, string> = {
    happy: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    calm: 'text-teal-400 border-teal-500/30 bg-teal-500/10',
    sad: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
    energetic: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    stressed: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
  };

  const navLinks = [
    { id: 'player', label: simple ? 'Home' : 'Player Home' },
    { id: 'browse', label: 'Browse' },
    { id: 'playlists', label: 'Playlists' },
    { id: 'journey', label: 'Mood Journey' },
    { id: 'diary', label: 'Mood Diary' },
    { id: 'islamic', label: 'Islamic Library' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin Dashboard' }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-3.5">
        {/* Brand */}
        <button onClick={() => onTabChange('player')} className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center">
            <Waves className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-white">MoodTide</span>
            <span className="text-[10px] uppercase text-zinc-500 -mt-1 font-mono">
              {simple ? 'Music that matches your mood' : 'Mood-Aware Engine'}
            </span>
          </div>
        </button>

        {/* Nav */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-zinc-400">
          {navLinks.map((link) => (
            <button
              key={link.id}
              onClick={() => onTabChange(link.id)}
              className={`py-1 relative ${currentTab === link.id ? 'text-white font-semibold' : 'hover:text-zinc-200'}`}
            >
              {link.label}
              {currentTab === link.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal-400 to-amber-400 rounded-full" />
              )}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {isAuthenticated && (
            <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium capitalize font-mono ${moodBadgeColors[currentMood] || 'text-zinc-300 border-zinc-800'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
              {currentMood}
            </div>
          )}

          <div className="hidden sm:flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[11px] font-semibold">
            <button onClick={() => setMode('simple')} className={`px-2.5 py-1 rounded-md ${simple ? 'bg-teal-400 text-zinc-950' : 'text-zinc-400'}`}>Simple</button>
            <button onClick={() => setMode('technical')} className={`px-2.5 py-1 rounded-md ${!simple ? 'bg-teal-400 text-zinc-950' : 'text-zinc-400'}`}>Technical</button>
          </div>

          <button onClick={openGuide} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800/90 border border-zinc-700">
            <HelpCircle className="w-3.5 h-3.5 text-teal-400" />
            <span className="hidden sm:inline">How it works</span>
          </button>

          {/* User menu */}
          {isAuthenticated && currentUser ? (
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-200"
              >
                {isAdmin ? <Shield className="w-3.5 h-3.5 text-amber-400" /> : <UserIcon className="w-3.5 h-3.5 text-teal-400" />}
                <span className="max-w-[100px] truncate">{currentUser.username}</span>
                <ChevronDown className="w-3 h-3 text-zinc-500" />
              </button>

              {userDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserDropdownOpen(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-2 z-50">
                    <div className="px-3 py-2 border-b border-zinc-800 text-xs">
                      <p className="font-semibold text-zinc-100">{currentUser.username}</p>
                      <p className="text-zinc-400 text-[11px] truncate">{currentUser.email}</p>
                    </div>
                    <button
                      onClick={async () => {
                        setUserDropdownOpen(false);
                        await logout();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-300 hover:bg-zinc-800 rounded-lg mt-1"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-500 text-zinc-950 hover:bg-teal-400"
            >
              <LogIn className="w-3.5 h-3.5" /> Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
};