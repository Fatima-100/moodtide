/**
 * MoodTide - Mood-Aware Music Player & Adaptive Suggestion Engine
 */

import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { PlayerBar } from './components/PlayerBar';
import { ToastContainer } from './components/Toast';
import { SqlModal } from './components/SqlModal';
import { TourGuide } from './components/TourGuide';
import { AuthModal } from './components/AuthModal';
import { HowItWorks } from './components/HowItWorks';
import { PlayerHome } from './pages/PlayerHome';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { MoodJourneyPage } from './pages/MoodJourneyPage';
import { MoodDiaryPage } from './pages/MoodDiaryPage';
import { IslamicPage } from './pages/IslamicPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { DatabaseExplorer } from './pages/DatabaseExplorer';
import { MOOD_COORDINATES } from './lib/mood';
import { BrowsePage } from './pages/BrowsePage';

const MainLayout: React.FC = () => {
  const { currentMood, currentUser } = useApp();
  const [currentTab, setCurrentTab] = useState<string>('player');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const moodConfig = MOOD_COORDINATES[currentMood] || MOOD_COORDINATES.calm;

  const isAdmin =
    currentUser?.role === 'admin' || currentUser?.role_id === 'rol_1';

  // If the user stops being an admin while on the admin tab, go back home
  useEffect(() => {
    if (currentTab === 'admin' && !isAdmin) {
      setCurrentTab('player');
    }
  }, [currentTab, isAdmin]);

  // Start each page at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentTab]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans relative selection:bg-teal-500/30 selection:text-teal-200">
      {/* Dynamic Background Mood Glow */}
      <div
        className={`pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] rounded-full blur-[140px] opacity-25 bg-gradient-to-b ${moodConfig.bgGlow} transition-all duration-700 z-0`}
      />

      <Header
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      <main className="flex-1 relative z-10 pb-28">
        {currentTab === 'player' && <PlayerHome />}
        {currentTab === 'browse' && <BrowsePage />}
        {currentTab === 'playlists' && <PlaylistsPage />}
        {currentTab === 'journey' && <MoodJourneyPage />}
        {currentTab === 'diary' && <MoodDiaryPage />}
        {currentTab === 'islamic' && <IslamicPage />}
        {currentTab === 'database' && <DatabaseExplorer />}
        {currentTab === 'admin' && isAdmin && <AdminDashboard />}
      </main>

      <Footer />
      <PlayerBar />
      <SqlModal />
      <HowItWorks />
      <TourGuide onNavigateTab={setCurrentTab} />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />

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