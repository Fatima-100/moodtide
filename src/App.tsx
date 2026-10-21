/**
 * MoodTide - Mood-Aware Music Player & Adaptive Suggestion Engine
 * Database Course Demonstration Project (PostgreSQL Mock Relational Architecture)
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { PlayerBar } from './components/PlayerBar';
import { ToastContainer } from './components/Toast';
import { SqlModal } from './components/SqlModal';
import { TourGuide } from './components/TourGuide';
import { AuthModal } from './components/AuthModal';

import { PlayerHome } from './pages/PlayerHome';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { MoodJourneyPage } from './pages/MoodJourneyPage';
import { MoodDiaryPage } from './pages/MoodDiaryPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { DatabaseExplorer } from './pages/DatabaseExplorer';
import { MOOD_COORDINATES } from './lib/db';

const MainLayout: React.FC = () => {
  const { currentMood, currentUser } = useApp();
  const [currentTab, setCurrentTab] = useState<string>('player');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const moodConfig = MOOD_COORDINATES[currentMood] || MOOD_COORDINATES.calm;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans relative selection:bg-teal-500/30 selection:text-teal-200">
      {/* Dynamic Background Mood Glow Ambient Aura */}
      <div
        className={`pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] rounded-full blur-[140px] opacity-25 bg-gradient-to-b ${moodConfig.bgGlow} transition-all duration-700 z-0`}
      />

      {/* Top Navigation */}
      <Header
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      {/* Main Content View */}
      <main className="flex-1 relative z-10">
        {currentTab === 'player' && <PlayerHome />}
        {currentTab === 'playlists' && <PlaylistsPage />}
        {currentTab === 'journey' && <MoodJourneyPage />}
        {currentTab === 'diary' && <MoodDiaryPage />}
        {currentTab === 'database' && <DatabaseExplorer />}
        {currentTab === 'admin' && <AdminDashboard />}
      </main>

      {/* Footer */}
      <Footer />

      {/* Fixed Music Player Bar */}
      <PlayerBar />

      {/* SQL Inspection Modal */}
      <SqlModal />

      {/* Interactive Guided Tour */}
      <TourGuide onNavigateTab={setCurrentTab} />

      {/* Authentication & User Switcher Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />

      {/* Database Constraint & Trigger Toasts */}
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
