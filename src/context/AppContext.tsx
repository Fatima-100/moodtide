/**
 * MoodTide Application Context
 * Central state for database subscription, active playback, audio synthesis,
 * active mood, constraint alerts, and guided tour.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { db, ConstraintViolationError, MOOD_COORDINATES } from '../lib/db';
import { audioSynth } from '../lib/audioSynthesizer';
import {
  DatabaseSchema,
  User,
  Song,
  SongFeatures,
  MoodType,
  ConstraintViolation,
  Playlist,
} from '../types/database';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'trigger' | 'info';
  title: string;
  message: string;
  details?: string;
}

interface AppContextType {
  db: typeof db;
  schema: DatabaseSchema;
  currentUser: User;
  switchUser: (userId: string) => void;
  loginAs: (email: string) => boolean;
  logout: () => void;
  // Playback state
  currentSong: Song | null;
  currentFeatures: SongFeatures | null;
  isPlaying: boolean;
  progressSec: number;
  volume: number;
  playSong: (song: Song, source?: 'search' | 'playlist' | 'suggestion', suggestionId?: string | null) => void;
  pauseSong: () => void;
  resumeSong: () => void;
  seekSong: (sec: number) => void;
  skipSong: () => void;
  replaySong: () => void;
  setVolume: (val: number) => void;
  // Mood state
  currentMood: MoodType;
  accentColor: string;
  checkinMood: (mood: MoodType, energyLevel?: number) => void;
  runMoodDetection: () => void;
  // SQL Modal state
  sqlModal: { isOpen: boolean; title: string; sqlText: string };
  openSqlModal: (title: string, sqlText: string) => void;
  closeSqlModal: () => void;
  // Toasts
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  // Guided Tour
  tourStep: number | null; // null = inactive, 1-6
  startTour: () => void;
  nextTourStep: () => void;
  exitTour: () => void;
  // Quick Actions
  rateSong: (songId: string, stars: number, suggestionId?: string | null) => void;
  addSongToPlaylist: (playlistId: string, songId: string) => boolean;
  createNewPlaylist: (name: string, description: string) => Playlist | null;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [schema, setSchema] = useState<DatabaseSchema>(db.getSchema());
  // Default user Fatima (usr_fatima)
  const [currentUserId, setCurrentUserId] = useState<string>('usr_fatima');

  // Playback state
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [progressSec, setProgressSec] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(0.65);
  const [currentSource, setCurrentSource] = useState<'search' | 'playlist' | 'suggestion'>('suggestion');
  const [currentSuggestionId, setCurrentSuggestionId] = useState<string | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Guided Tour (1 to 6)
  const [tourStep, setTourStep] = useState<number | null>(null);

  // SQL Modal
  const [sqlModal, setSqlModal] = useState<{ isOpen: boolean; title: string; sqlText: string }>({
    isOpen: false,
    title: '',
    sqlText: '',
  });

  // Subscribe to DB changes
  useEffect(() => {
    const unsubscribe = db.subscribe(() => {
      setSchema({ ...db.getSchema() });
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const currentUser = useMemo(() => {
    return schema.users.find((u) => u.user_id === currentUserId) || schema.users[1];
  }, [schema.users, currentUserId]);

  // Current Mood based on latest detected or checkin
  const currentMood = useMemo<MoodType>(() => {
    const latestScore = schema.mood_scores
      .filter((s) => s.user_id === currentUserId)
      .sort((a, b) => new Date(b.calculated_at).getTime() - new Date(a.calculated_at).getTime())[0];
    return latestScore ? latestScore.detected_mood : 'calm';
  }, [schema.mood_scores, currentUserId]);

  const accentColor = MOOD_COORDINATES[currentMood]?.accentColor || 'teal';

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `tst_${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const currentFeatures = useMemo(() => {
    if (!currentSong) return null;
    return schema.song_features.find((f) => f.song_id === currentSong.song_id) || null;
  }, [currentSong, schema.song_features]);

  // Handle Playback Interval
  useEffect(() => {
    let interval: number;
    if (isPlaying && currentSong) {
      interval = window.setInterval(() => {
        setProgressSec((prev) => {
          if (prev >= currentSong.duration_sec) {
            // Trigger song completion in DB
            db.triggerOnSongPlay(
              currentUser.user_id,
              currentSong.song_id,
              currentSong.duration_sec,
              true,
              currentSource,
              currentSuggestionId
            );
            addToast({
              type: 'trigger',
              title: 'Trigger: onSongPlay Finished',
              message: `Completed "${currentSong.title}". Recorded into Listening_History & updated User_Taste_Profile (+1 signal).`,
            });
            audioSynth.stop();
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSong, currentUser.user_id, currentSource, currentSuggestionId, addToast]);

  const playSong = useCallback(
    (song: Song, source: 'search' | 'playlist' | 'suggestion' = 'suggestion', suggestionId: string | null = null) => {
      setCurrentSong(song);
      setCurrentSource(source);
      setCurrentSuggestionId(suggestionId);
      setProgressSec(0);
      setIsPlaying(true);

      const feat = schema.song_features.find((f) => f.song_id === song.song_id);
      if (feat) {
        audioSynth.playTrack({ energy: feat.energy, happiness: feat.happiness, tempo: feat.tempo });
      }

      // If user plays during tour step 2, move tour to step 3!
      if (tourStep === 2) {
        setTourStep(3);
      }
    },
    [schema.song_features, tourStep]
  );

  const pauseSong = useCallback(() => {
    setIsPlaying(false);
    audioSynth.pause();
  }, []);

  const resumeSong = useCallback(() => {
    if (currentSong) {
      setIsPlaying(true);
      const feat = schema.song_features.find((f) => f.song_id === currentSong.song_id);
      if (feat) {
        audioSynth.playTrack({ energy: feat.energy, happiness: feat.happiness, tempo: feat.tempo });
      }
    }
  }, [currentSong, schema.song_features]);

  const seekSong = useCallback((sec: number) => {
    setProgressSec(sec);
  }, []);

  const skipSong = useCallback(() => {
    if (!currentSong) return;
    const listened = progressSec;
    audioSynth.stop();
    setIsPlaying(false);

    db.triggerOnSongPlay(
      currentUser.user_id,
      currentSong.song_id,
      listened,
      false, // completed = false
      currentSource,
      currentSuggestionId,
      false
    );

    addToast({
      type: 'trigger',
      title: 'Trigger: Skip Recorded',
      message: `Skipped "${currentSong.title}" at ${listened}s. PostgreSQL trigger logged skip signal (-1) and updated Listening_History.`,
    });

    // Pick next song in suggestion feed
    const remainingSuggestions = schema.suggestions.filter((s) => s.song_id !== currentSong.song_id);
    if (remainingSuggestions.length > 0) {
      const nextSong = schema.songs.find((s) => s.song_id === remainingSuggestions[0].song_id);
      if (nextSong) {
        playSong(nextSong, 'suggestion', remainingSuggestions[0].suggestion_id);
      }
    }

    if (tourStep === 3) {
      setTourStep(4);
    }
  }, [currentSong, progressSec, currentUser.user_id, currentSource, currentSuggestionId, schema.suggestions, schema.songs, playSong, addToast, tourStep]);

  const replaySong = useCallback(() => {
    if (!currentSong) return;
    setProgressSec(0);
    setIsPlaying(true);
    const feat = schema.song_features.find((f) => f.song_id === currentSong.song_id);
    if (feat) {
      audioSynth.playTrack({ energy: feat.energy, happiness: feat.happiness, tempo: feat.tempo });
    }

    db.triggerOnSongPlay(
      currentUser.user_id,
      currentSong.song_id,
      0,
      false,
      currentSource,
      currentSuggestionId,
      true // isReplay
    );

    addToast({
      type: 'trigger',
      title: 'Trigger: Replay Signal (+2)',
      message: `Replaying "${currentSong.title}". Trigger updated Implicit_Signals (+2) and reinforced genre affinity.`,
    });
  }, [currentSong, schema.song_features, currentUser.user_id, currentSource, currentSuggestionId, addToast]);

  const setVolume = useCallback((val: number) => {
    setVolumeState(val);
    audioSynth.setVolume(val);
  }, []);

  const checkinMood = useCallback(
    (mood: MoodType, energyLevel = 3) => {
      try {
        db.checkinMood(currentUser.user_id, mood, energyLevel);
        addToast({
          type: 'success',
          title: 'Mood Check-in Saved',
          message: `Logged mood "${mood}" (energy ${energyLevel}/5). detectMood() stored procedure evaluated and refreshed recommendations!`,
        });
        if (tourStep === 1) {
          setTourStep(2);
        }
      } catch (err: unknown) {
        if (err instanceof ConstraintViolationError) {
          addToast({ type: 'error', title: 'Constraint Error', message: err.message });
        }
      }
    },
    [currentUser.user_id, addToast, tourStep]
  );

  const runMoodDetection = useCallback(() => {
    const result = db.detectMood(currentUser.user_id);
    addToast({
      type: 'info',
      title: 'Stored Procedure: detectMood() Executed',
      message: result.ruleFired,
    });
    db.generateSuggestions(currentUser.user_id);
  }, [currentUser.user_id, addToast]);

  const rateSong = useCallback(
    (songId: string, stars: number, suggestionId: string | null = null) => {
      try {
        db.triggerOnSongRate(currentUser.user_id, songId, stars, suggestionId);
        const songName = schema.songs.find((s) => s.song_id === songId)?.title || 'Song';
        addToast({
          type: 'success',
          title: `Rated ${stars} Stars`,
          message: `Stored procedure inserted into Ratings, logged signal (${stars - 3}), and adapted User_Taste_Profile for "${songName}".`,
        });
        if (tourStep === 4) {
          setTourStep(5);
        }
      } catch (err: unknown) {
        if (err instanceof ConstraintViolationError) {
          addToast({
            type: 'error',
            title: `Constraint Violation [${err.violation.type}]`,
            message: err.violation.message,
          });
        }
      }
    },
    [currentUser.user_id, schema.songs, addToast, tourStep]
  );

  const addSongToPlaylist = useCallback(
    (playlistId: string, songId: string): boolean => {
      try {
        db.triggerOnPlaylistAdd(playlistId, songId, currentUser.user_id);
        const plName = schema.playlists.find((p) => p.playlist_id === playlistId)?.name || 'Playlist';
        addToast({
          type: 'success',
          title: 'Added to Playlist',
          message: `Track linked to "${plName}". Unique constraint validated. Signal (+2) recorded.`,
        });
        return true;
      } catch (err: unknown) {
        if (err instanceof ConstraintViolationError) {
          addToast({
            type: 'error',
            title: `PostgreSQL Constraint Rejected [${err.violation.type}]`,
            message: err.violation.message,
          });
        }
        return false;
      }
    },
    [currentUser.user_id, schema.playlists, addToast]
  );

  const createNewPlaylist = useCallback(
    (name: string, description: string): Playlist | null => {
      try {
        const playlistId = `pl_${Date.now()}`;
        const newPl: Playlist = {
          playlist_id: playlistId,
          user_id: currentUser.user_id,
          name,
          description,
          playlist_type: 'normal',
          start_mood: null,
          target_mood: null,
          created_at: new Date().toISOString(),
        };
        db.validateConstraint('playlists', newPl as unknown as Record<string, unknown>, 'INSERT');
        db.getSchema().playlists.unshift(newPl);
        db.getSchema().audit_log.unshift({
          log_id: `aud_${Date.now()}`,
          user_id: currentUser.user_id,
          table_name: 'Playlists',
          record_id: playlistId,
          action: 'INSERT',
          old_data: null,
          new_data: JSON.stringify(newPl),
          changed_at: new Date().toISOString(),
        });
        // trigger subscription update
        db.resetDatabase = db.resetDatabase.bind(db);
        addToast({
          type: 'success',
          title: 'Playlist Created',
          message: `Created "${name}" in table Playlists with Foreign Key to user "${currentUser.username}".`,
        });
        return newPl;
      } catch (err: unknown) {
        if (err instanceof ConstraintViolationError) {
          addToast({
            type: 'error',
            title: `Constraint Error [${err.violation.type}]`,
            message: err.violation.message,
          });
        }
        return null;
      }
    },
    [currentUser, addToast]
  );

  const switchUser = useCallback((userId: string) => {
    setCurrentUserId(userId);
    db.generateSuggestions(userId);
  }, []);

  const loginAs = useCallback(
    (email: string) => {
      const u = schema.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
      if (u) {
        setCurrentUserId(u.user_id);
        db.generateSuggestions(u.user_id);
        addToast({
          type: 'success',
          title: 'Authenticated Session',
          message: `Signed in as ${u.username} (${u.role_id === 'rol_1' ? 'Admin' : 'User'} · Cohort ${u.experiment_group}).`,
        });
        return true;
      }
      addToast({
        type: 'error',
        title: 'Authentication Failed',
        message: 'No user found with email ' + email,
      });
      return false;
    },
    [schema.users, addToast]
  );

  const logout = useCallback(() => {
    // Default back to Fatima
    setCurrentUserId('usr_fatima');
    addToast({
      type: 'info',
      title: 'Signed Out',
      message: 'Active session closed. Switched to public guest mode.',
    });
  }, [addToast]);

  const openSqlModal = useCallback((title: string, sqlText: string) => {
    setSqlModal({ isOpen: true, title, sqlText });
  }, []);

  const closeSqlModal = useCallback(() => {
    setSqlModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const startTour = useCallback(() => {
    setTourStep(1);
    addToast({
      type: 'info',
      title: 'Demo Tour Started (Step 1 of 6)',
      message: 'Follow the glowing prompt to check in your current mood.',
    });
  }, [addToast]);

  const nextTourStep = useCallback(() => {
    setTourStep((prev) => (prev ? (prev < 6 ? prev + 1 : null) : null));
  }, []);

  const exitTour = useCallback(() => {
    setTourStep(null);
  }, []);

  return (
    <AppContext.Provider
      value={{
        db,
        schema,
        currentUser,
        switchUser,
        loginAs,
        logout,
        currentSong,
        currentFeatures,
        isPlaying,
        progressSec,
        volume,
        playSong,
        pauseSong,
        resumeSong,
        seekSong,
        skipSong,
        replaySong,
        setVolume,
        currentMood,
        accentColor,
        checkinMood,
        runMoodDetection,
        sqlModal,
        openSqlModal,
        closeSqlModal,
        toasts,
        addToast,
        removeToast,
        tourStep,
        startTour,
        nextTourStep,
        exitTour,
        rateSong,
        addSongToPlaylist,
        createNewPlaylist,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
