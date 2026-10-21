import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Database, RotateCcw, ShieldAlert, Check } from 'lucide-react';

export const Footer: React.FC = () => {
  const { db, schema, addToast } = useApp();
  const [confirmReset, setConfirmReset] = useState(false);

  const totalRows = Object.values(schema).reduce(
    (acc, tableArr) => acc + (Array.isArray(tableArr) ? tableArr.length : 0),
    0
  );

  const handleReset = () => {
    db.resetDatabase();
    setConfirmReset(false);
    addToast({
      type: 'info',
      title: 'Database Reset to Factory Seeds',
      message: 'All 25 PostgreSQL tables re-initialized with 60 songs, 12 demo users, and clean state.',
    });
  };

  return (
    <footer className="w-full border-t border-zinc-800/80 bg-zinc-950/90 py-6 px-6 mt-16 mb-24 text-xs text-zinc-500">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex items-center gap-2 text-zinc-400 font-mono text-[11px]">
            <Database className="w-3.5 h-3.5 text-teal-400" />
            <span>25 Relational Tables · {totalRows} Active Records · {schema.audit_log.length} Audit Entries</span>
          </div>
          <span className="hidden sm:inline text-zinc-700">·</span>
          <p className="text-zinc-400 font-medium">
            Prototype: database simulated in the browser. Final version: PostgreSQL + Next.js.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {confirmReset ? (
            <div className="flex items-center gap-2 bg-red-950/60 border border-red-500/40 px-3 py-1 rounded-lg">
              <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-200 text-xs">Reset all 25 tables?</span>
              <button
                onClick={handleReset}
                className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-medium text-xs flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Yes
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-white text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:text-zinc-300 text-zinc-400 transition-colors"
              title="Re-seed all 25 database tables with initial demo data"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Demo Data</span>
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};
