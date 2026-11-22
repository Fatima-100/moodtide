/**
 * View mode for MoodTide.
 *
 *  - "simple"    (default): plain-language labels and messages, no database jargon.
 *  - "technical": the original view with SQL buttons, table names, cohorts, etc.
 *
 * Also remembers whether the "How it works" guide has been shown before.
 * Works anywhere in the app with: const { simple, setMode, openGuide } = useViewMode();
 */
import { useSyncExternalStore } from 'react';

export type ViewMode = 'simple' | 'technical';

interface ViewState {
  mode: ViewMode;
  guideOpen: boolean;
}

const MODE_KEY = 'moodtide_view_mode';
const SEEN_KEY = 'moodtide_guide_seen';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode etc.): the app still works, it just won't remember
  }
}

let state: ViewState = {
  mode: readStorage(MODE_KEY) === 'technical' ? 'technical' : 'simple',
  guideOpen: readStorage(SEEN_KEY) !== '1', // opens by itself the very first time
};

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ViewState {
  return state;
}

export function setMode(mode: ViewMode): void {
  if (state.mode === mode) return;
  writeStorage(MODE_KEY, mode);
  state = { ...state, mode };
  emit();
}

export function openGuide(): void {
  state = { ...state, guideOpen: true };
  emit();
}

export function closeGuide(): void {
  writeStorage(SEEN_KEY, '1');
  state = { ...state, guideOpen: false };
  emit();
}

export function useViewMode() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    mode: s.mode,
    simple: s.mode === 'simple',
    guideOpen: s.guideOpen,
    setMode,
    openGuide,
    closeGuide,
  };
}