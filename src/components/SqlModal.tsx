import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { X, Copy, Check, Terminal, Database } from 'lucide-react';

export const SqlModal: React.FC = () => {
  const { sqlModal, closeSqlModal } = useApp();
  const [copied, setCopied] = useState(false);

  if (!sqlModal.isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlModal.sqlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-100">{sqlModal.title}</h3>
              <p className="text-xs text-zinc-400">PostgreSQL 16 · Stored Procedures, Triggers & DDL Translation</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy SQL'}</span>
            </button>
            <button
              onClick={closeSqlModal}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* SQL Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-zinc-950 text-zinc-300 font-mono text-xs leading-relaxed">
          <pre className="whitespace-pre-wrap select-all selection:bg-emerald-500/30 selection:text-emerald-200">
            {sqlModal.sqlText}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800/80 bg-zinc-900/40 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-zinc-500" />
            <span>Simulated on 25 typed relational tables in browser localStorage</span>
          </div>
          <button
            onClick={closeSqlModal}
            className="px-3 py-1 rounded-md bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
