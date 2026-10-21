import React from 'react';
import { useApp } from '../context/AppContext';
import { CheckCircle2, AlertTriangle, Database, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isTrigger = toast.type === 'trigger';
        const isSuccess = toast.type === 'success';

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
              <h4 className="text-sm font-semibold tracking-tight">{toast.title}</h4>
              <p className="text-xs opacity-90 mt-0.5 leading-relaxed">{toast.message}</p>
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
