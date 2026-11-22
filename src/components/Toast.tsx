import React from 'react';
import { useApp } from '../context/AppContext';
import { useViewMode } from '../lib/viewMode';
import { CheckCircle2, AlertTriangle, Database, Info, X } from 'lucide-react';

interface ToastLike {
  type: string;
  title: string;
  message: string;
}

// First text found between double quotes, e.g. the song name in: Skipped "Song Name" at 12s.
const quoted = (s: string): string | undefined => s.match(/"([^"]+)"/)?.[1];

/**
 * In Simple view, turn the technical notifications (triggers, stored procedures,
 * constraints) into plain sentences that say what the app just did and why.
 * Anything we don't recognise is shown unchanged.
 */
function friendly(t: ToastLike): { title: string; message: string } {
  const { title, message } = t;
  const name = quoted(message);

  if (title === 'Mood Check-in Saved') {
    return {
      title: `Got it, you’re feeling ${name ?? 'different'}`,
      message: 'We saved your mood and refreshed your song list to match it.',
    };
  }
  if (title.startsWith('Trigger: onSongPlay Finished')) {
    return {
      title: 'You listened to the whole song',
      message: `“${name ?? 'The song'}” played to the end. We take that as a thumbs-up and will suggest more songs like it.`,
    };
  }
  if (title.startsWith('Trigger: Skip Recorded')) {
    return {
      title: 'Skipped',
      message: `You skipped “${name ?? 'the song'}”, so we’ll suggest fewer songs like it. (Skip 3 in a row and we’ll guess you’re stressed and play calmer music.)`,
    };
  }
  if (title.startsWith('Trigger: Replay Signal')) {
    return {
      title: 'You replayed a song',
      message: `You replayed “${name ?? 'the song'}”, so we’ll recommend more songs like it.`,
    };
  }
  if (title.startsWith('Stored Procedure: detectMood()')) {
    return { title: 'We re-checked your mood', message };
  }
  if (title.startsWith('Rated ')) {
    const stars = Number(title.match(/Rated (\d)/)?.[1] ?? 0);
    return {
      title: 'Thanks for rating!',
      message: `You gave “${name ?? 'the song'}” ${stars} star${stars === 1 ? '' : 's'}. We’ll use this to improve your suggestions.`,
    };
  }
  if (title === 'Added to Playlist') {
    return { title: 'Added to playlist', message: `The song was added to “${name ?? 'your playlist'}”.` };
  }
  if (title.includes('Constraint')) {
    if (message.includes('already in this playlist')) {
      return {
        title: 'Already in this playlist',
        message: 'That song is already in this playlist, so we didn’t add it twice.',
      };
    }
    return { title: 'That didn’t work', message };
  }
  if (title === 'Account Created & Stored') {
    return { title: 'Account created', message: 'You’re all set. Welcome to MoodTide!' };
  }
  if (title.startsWith('Database Reset')) {
    return { title: 'Demo data reset', message: 'Songs, users and history are back to the starting state.' };
  }
  return { title, message };
}

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();
  const { simple } = useViewMode();

  if (toasts.length === 0) return null;

  return (
     <div
      role="status"
      aria-live="polite"
      className="fixed bottom-28 sm:bottom-24 left-4 right-4 sm:left-auto sm:right-6 z-50 flex flex-col gap-2 sm:max-w-md sm:w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        // In Simple view, "trigger" notifications are shown as normal friendly confirmations
        const isTrigger = toast.type === 'trigger' && !simple;
        const isSuccess = toast.type === 'success' || (toast.type === 'trigger' && simple);
        const shown = simple ? friendly(toast) : { title: toast.title, message: toast.message };

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 ${
              isError
                ? 'bg-red-950/90 border-red-500/40 text-red-100'
                : isTrigger
                ? 'bg-amber-950/90 border-amber-500/40 text-amber-100'
                : isSuccess
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100'
                : 'bg-zinc-900/90 border-zinc-700/60 text-zinc-100'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isError && <AlertTriangle className="w-5 h-5 text-red-400" />}
              {isTrigger && <Database className="w-5 h-5 text-amber-400" />}
              {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400" />}
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold tracking-tight">{shown.title}</h4>
              <p className="text-xs opacity-90 mt-0.5 leading-relaxed">{shown.message}</p>
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-white/10 transition-colors"
              aria-label="Dismiss alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};