import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi, setToken, moodApi, suggestionsApi, activityApi, prefsApi } from '../lib/api';
import { MOOD_COORDINATES, MoodType } from '../lib/mood';
import { audioSynth } from '../lib/audioSynthesizer';
import { ytPlayer } from '../lib/youtubePlayer';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'trigger' | 'info';
  title: string;
  message: string;
  details?: string;
}

interface AppContextType {
  currentUser: any | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (username: string, email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  // Playback
  currentSong: any | null;
  isPlaying: boolean;
  progressSec: number;
  volume: number;
  playSong: (song: any, source?: string, suggestionId?: string | null) => void;
  pauseSong: () => void;
  resumeSong: () => void;
  seekSong: (sec: number) => void;
  skipSong: () => void;
  stopSong: () => void;
  setVolume: (v: number) => void;
  // Mood & Suggestions
  currentMood: MoodType;
  accentColor: string;
  latestMoodScore: any | null;
  suggestions: any[];
  batch: any | null;
  checkinMood: (mood: MoodType, energy?: number) => Promise<void>;
  refreshSuggestions: () => Promise<void>;
  regionPref: string;
  setRegionPref: (region: string) => Promise<void>;
  runMoodDetection: () => Promise<void>;
  rateSong: (songId: string, stars: number, suggestionId?: string | null) => Promise<void>;
  // UI
  toasts: ToastMessage[];
  addToast: (t: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  sqlModal: { isOpen: boolean; title: string; sqlText: string };
  openSqlModal: (title: string, sqlText: string) => void;
  closeSqlModal: () => void;
  tourStep: number | null;
  startTour: () => void;
  nextTourStep: () => void;
  exitTour: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

// Stop every sound source, so two songs can never play at once
const stopAllAudio = () => {
  audioSynth.stop();
  ytPlayer.stop();
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentMood, setCurrentMood] = useState<MoodType>('calm');
  const [latestMoodScore, setLatestMoodScore] = useState<any | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [batch, setBatch] = useState<any | null>(null);
  const [regionPref, setRegionPrefState] = useState('all');

  // Playback
  const [currentSong, setCurrentSong] = useState<any | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressSec, setProgressSec] = useState(0);
  const [volume, setVolumeState] = useState(0.65);
  const [currentSource, setCurrentSource] = useState('suggestion');
  const [currentSuggestionId, setCurrentSuggestionId] = useState<string | null>(null);
  // which engine is playing the current song: real YouTube video, or the generated-tone fallback
  const engineRef = useRef<'youtube' | 'synth' | null>(null);

  // UI
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [sqlModal, setSqlModal] = useState({ isOpen: false, title: '', sqlText: '' });
  const [tourStep, setTourStep] = useState<number | null>(null);

  const accentColor = MOOD_COORDINATES[currentMood]?.accentColor || 'teal';

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `tst_${Date.now()}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load user + data on mount
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('moodtide_token');
        if (token) {
          const user = await authApi.me();
          setCurrentUser(user);
          await loadUserData();
        }
      } catch {
        setToken(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function loadUserData() {
    try {
      const [mood, sug, prefs] = await Promise.all([
        moodApi.current().catch(() => null),
        suggestionsApi.list().catch(() => ({ batch: null, suggestions: [] })),
        prefsApi.get().catch(() => ({ region: 'all' })),
      ]);
      if (mood?.detected_mood) {
        setCurrentMood(mood.detected_mood);
        setLatestMoodScore(mood);
      }
      setBatch(sug.batch);
      setSuggestions(sug.suggestions || []);
      setRegionPrefState(prefs?.region ?? 'all');
    } catch (e) {
      console.error('Failed to load user data', e);
    }
  }

  const login = async (email: string, password: string) => {
    try {
      const { token, user } = await authApi.login(email, password);
      setToken(token);
      setCurrentUser(user);
      await loadUserData();
      addToast({ type: 'success', title: 'Signed in', message: `Welcome back, ${user.username}` });
      return true;
    } catch (e: any) {
      addToast({ type: 'error', title: 'Login failed', message: e.message });
      return false;
    }
  };

  const register = async (username: string, email: string, password: string) => {
    try {
      const { token, user } = await authApi.register(username, email, password);
      setToken(token);
      setCurrentUser(user);
      await loadUserData();
      addToast({ type: 'success', title: 'Account created', message: `Welcome, ${user.username}` });
      return true;
    } catch (e: any) {
      addToast({ type: 'error', title: 'Registration failed', message: e.message });
      return false;
    }
  };

  const logout = async () => {
    try { await authApi.logout(); } catch {}
    stopAllAudio();
    engineRef.current = null;
    setCurrentSong(null);
    setIsPlaying(false);
    setProgressSec(0);
    setCurrentUser(null);
    setSuggestions([]);
    setBatch(null);
    setLatestMoodScore(null);
    setCurrentMood('calm');
    setRegionPrefState('all');
    addToast({ type: 'info', title: 'Signed out', message: 'Session closed' });
  };

  useEffect(() => {
    const onUnauthorized = () => { logout(); };
    window.addEventListener('moodtide:unauthorized', onUnauthorized);
    return () => window.removeEventListener('moodtide:unauthorized', onUnauthorized);
  }, []);

  const checkinMood = async (mood: MoodType, energy = 3) => {
    try {
      const out = await moodApi.createCheckin(mood, energy);
      setCurrentMood(mood);
      if (out.detected) {
        setLatestMoodScore(out.detected);
        if (out.detected.detected_mood) setCurrentMood(out.detected.detected_mood);
      }
      // Refresh suggestions after check-in
      const sug = await suggestionsApi.list();
      setBatch(sug.batch);
      setSuggestions(sug.suggestions || []);
      addToast({
        type: 'success',
        title: 'Mood checked in',
        message: `Logged "${mood}" (energy ${energy}/5). Suggestions refreshed.`,
      });
      if (tourStep === 1) setTourStep(2);
    } catch (e: any) {
      addToast({ type: 'error', title: 'Check-in failed', message: e.message });
    }
  };

  const refreshSuggestions = async () => {
    try {
      await suggestionsApi.generate();
      const sug = await suggestionsApi.list();
      setBatch(sug.batch);
      setSuggestions(sug.suggestions || []);
      addToast({ type: 'info', title: 'Suggestions refreshed', message: 'New recommendation batch ready' });
    } catch (e: any) {
      addToast({ type: 'error', title: 'Refresh failed', message: e.message });
    }
  };

  const runMoodDetection = async () => {
    try {
      const result = await moodApi.detect();
      if (result?.detected_mood) {
        setCurrentMood(result.detected_mood);
        setLatestMoodScore(result);
      }
      await refreshSuggestions();
    } catch (e: any) {
      addToast({ type: 'error', title: 'Mood detection failed', message: e.message });
    }
  };

  // which kind of music the user wants: all / pakistani / punjabi / asian / international
  const setRegionPref = async (region: string) => {
    try {
      await prefsApi.setRegion(region);
      setRegionPrefState(region);
      await suggestionsApi.generate();
      const sug = await suggestionsApi.list();
      setBatch(sug.batch);
      setSuggestions(sug.suggestions || []);
    } catch (e: any) {
      addToast({ type: 'error', title: 'Could not save your choice', message: e.message });
    }
  };

  const rateSong = async (songId: string, stars: number, suggestionId: string | null = null) => {
    try {
      await activityApi.rate(songId, stars, suggestionId);
      addToast({ type: 'success', title: `Rated ${stars}★`, message: 'Rating saved' });
      if (tourStep === 4) setTourStep(5);
    } catch (e: any) {
      addToast({ type: 'error', title: 'Rating failed', message: e.message });
    }
  };

  // ---------- Playback ----------
  const playSong = useCallback((song: any, source = 'suggestion', suggestionId: string | null = null) => {
    stopAllAudio(); // stop whatever was playing before
    setCurrentSong(song);
    setCurrentSource(source);
    setCurrentSuggestionId(suggestionId);
    setProgressSec(0);
    setIsPlaying(true);

    if (song.external_id) {
      // real song: play the YouTube video
      engineRef.current = 'youtube';
      ytPlayer.play(String(song.external_id)).catch((e: any) => {
        setIsPlaying(false);
        addToast({ type: 'error', title: 'Player failed', message: e?.message || 'Could not start the YouTube player' });
      });
    } else {
      // no video id: fall back to the generated tone
      engineRef.current = 'synth';
      if (song.energy != null) {
        audioSynth.playTrack({ energy: song.energy, happiness: song.happiness, tempo: song.tempo });
      }
    }
    if (tourStep === 2) setTourStep(3);
  }, [tourStep, addToast]);

  const pauseSong = () => {
    setIsPlaying(false);
    audioSynth.pause();
    ytPlayer.pause();
  };

  const resumeSong = () => {
    if (!currentSong) return;
    setIsPlaying(true);
    if (engineRef.current === 'youtube') {
      ytPlayer.resume();
    } else {
      audioSynth.playTrack({ energy: currentSong.energy, happiness: currentSong.happiness, tempo: currentSong.tempo });
    }
  };

  // Cross button: stop everything and close the player. Not recorded as a skip,
  // so it does not affect mood detection.
  const stopSong = () => {
    stopAllAudio();
    engineRef.current = null;
    setIsPlaying(false);
    setProgressSec(0);
    setCurrentSong(null);
    setCurrentSuggestionId(null);
  };

  const seekSong = (sec: number) => {
    setProgressSec(sec);
    if (engineRef.current === 'youtube') ytPlayer.seek(sec);
  };

  const setVolume = (v: number) => {
    setVolumeState(v);
    audioSynth.setVolume(v);
    ytPlayer.setVolume(v);
  };

  const skipSong = async () => {
    if (!currentSong) return;
    stopAllAudio();
    setIsPlaying(false);
    try {
      await activityApi.recordPlay({
        songId: currentSong.song_id,
        listenedSec: progressSec,
        completed: false,
        source: currentSource,
        suggestionId: currentSuggestionId,
      });
    } catch {}
    // play next suggestion if available
    const idx = suggestions.findIndex((s) => s.song_id === currentSong.song_id);
    if (idx >= 0 && idx < suggestions.length - 1) {
      playSong(suggestions[idx + 1], 'suggestion', suggestions[idx + 1].suggestion_id);
    }
    if (tourStep === 3) setTourStep(4);
  };

  // Listen to the YouTube player: keep play/pause in sync, save finished songs, skip blocked videos
  useEffect(() => {
    ytPlayer.setHandlers({
      onState: (s) => {
        if (engineRef.current !== 'youtube') return;
        if (s === 1) setIsPlaying(true);
        else if (s === 2) setIsPlaying(false);
      },
      onEnded: () => {
        if (engineRef.current !== 'youtube' || !currentSong) return;
        activityApi.recordPlay({
          songId: currentSong.song_id,
          listenedSec: currentSong.duration_sec,
          completed: true,
          source: currentSource,
          suggestionId: currentSuggestionId,
        }).catch(() => {});
        setIsPlaying(false);
        setProgressSec(0);
      },
      onError: (code) => {
        if (engineRef.current !== 'youtube') return;
        addToast({
          type: 'error',
          title: "Can't play this video",
          message: code === 101 || code === 150
            ? 'The owner does not allow it outside YouTube. Trying the next song.'
            : 'YouTube could not play it. Trying the next song.',
        });
        const idx = suggestions.findIndex((s) => s.song_id === currentSong?.song_id);
        if (idx >= 0 && idx < suggestions.length - 1) {
          playSong(suggestions[idx + 1], 'suggestion', suggestions[idx + 1].suggestion_id);
        } else {
          setIsPlaying(false);
        }
      },
    });
  }, [currentSong, currentSource, currentSuggestionId, suggestions, playSong, addToast]);

  // Progress ticker
  useEffect(() => {
    if (!isPlaying || !currentSong) return;
    const id = window.setInterval(() => {
      if (engineRef.current === 'youtube') {
        // real position comes from the YouTube player
        setProgressSec(Math.floor(ytPlayer.getTime()));
        return;
      }
      setProgressSec((prev) => {
        if (prev >= (currentSong.duration_sec || 180)) {
          activityApi.recordPlay({
            songId: currentSong.song_id,
            listenedSec: currentSong.duration_sec,
            completed: true,
            source: currentSource,
            suggestionId: currentSuggestionId,
          }).catch(() => {});
          audioSynth.stop();
          setIsPlaying(false);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, currentSong, currentSource, currentSuggestionId]);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        isLoading,
        login,
        register,
        logout,
        currentSong,
        isPlaying,
        progressSec,
        volume,
        playSong,
        pauseSong,
        resumeSong,
        seekSong,
        skipSong,
        stopSong,
        setVolume,
        currentMood,
        accentColor,
        latestMoodScore,
        suggestions,
        batch,
        checkinMood,
        refreshSuggestions,
        regionPref,
        setRegionPref,
        runMoodDetection,
        rateSong,
        toasts,
        addToast,
        removeToast,
        sqlModal,
        openSqlModal: (title, sqlText) => setSqlModal({ isOpen: true, title, sqlText }),
        closeSqlModal: () => setSqlModal((p) => ({ ...p, isOpen: false })),
        tourStep,
        startTour: () => setTourStep(1),
        nextTourStep: () => setTourStep((p) => (p && p < 6 ? p + 1 : null)),
        exitTour: () => setTourStep(null),
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};