import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { TABLES_METADATA } from '../lib/db';
import { TableKey, TableMeta } from '../types/database';
import {
  Database,
  Table as TableIcon,
  Key,
  Link,
  History,
  FileCode,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';

export const DatabaseExplorer: React.FC = () => {
  const { schema, openSqlModal, addToast } = useApp();
  const [selectedTableKey, setSelectedTableKey] = useState<TableKey>('songs');
  const [activeTab, setActiveTab] = useState<'tables' | 'audit' | 'schema'>('tables');
  const [searchTerm, setSearchTerm] = useState('');
  const [auditFilter, setAuditFilter] = useState<string>('ALL');

  const selectedMeta = TABLES_METADATA.find((m) => m.key === selectedTableKey) || TABLES_METADATA[0];
  const tableData = (schema[selectedTableKey] as unknown as Record<string, unknown>[]) || [];

  // Filtered rows
  const filteredRows = tableData.filter((row) => {
    if (!searchTerm.trim()) return true;
    return Object.values(row).some((val) =>
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Table columns
  const columns = tableData.length > 0 ? Object.keys(tableData[0]) : [];

  // Group metadata by category
  const categories: Record<string, TableMeta[]> = {};
  TABLES_METADATA.forEach((m) => {
    if (!categories[m.category]) categories[m.category] = [];
    categories[m.category].push(m);
  });

  // Filtered Audit Log
  const filteredAudit = schema.audit_log.filter((log) => {
    if (auditFilter === 'ALL') return true;
    return log.action === auditFilter;
  });

  const handleShowFullDDL = () => {
    const ddl = `-- =======================================================================
-- MoodTide Relational PostgreSQL 16 Complete Database Schema DDL
-- 25 Interconnected Tables, Primary Keys, Foreign Keys, CHECK & UNIQUE Constraints
-- =======================================================================

-- 1. Music Catalog
CREATE TABLE Artists (
    artist_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Albums (
    album_id VARCHAR(64) PRIMARY KEY,
    artist_id VARCHAR(64) NOT NULL REFERENCES Artists(artist_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    release_year INT NOT NULL,
    cover_url TEXT
);

CREATE TABLE Genres (
    genre_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE Songs (
    song_id VARCHAR(64) PRIMARY KEY,
    artist_id VARCHAR(64) NOT NULL REFERENCES Artists(artist_id) ON DELETE RESTRICT,
    album_id VARCHAR(64) REFERENCES Albums(album_id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    duration_sec INT NOT NULL CHECK (duration_sec > 0),
    release_year INT NOT NULL,
    audio_url TEXT NOT NULL,
    popularity INT DEFAULT 50 CHECK (popularity BETWEEN 0 AND 100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Song_Genre (
    song_id VARCHAR(64) REFERENCES Songs(song_id) ON DELETE CASCADE,
    genre_id VARCHAR(64) REFERENCES Genres(genre_id) ON DELETE CASCADE,
    PRIMARY KEY (song_id, genre_id)
);

CREATE TABLE Song_Features (
    song_id VARCHAR(64) PRIMARY KEY REFERENCES Songs(song_id) ON DELETE CASCADE,
    energy NUMERIC(3,2) NOT NULL CHECK (energy >= 0.0 AND energy <= 1.0),
    happiness NUMERIC(3,2) NOT NULL CHECK (happiness >= 0.0 AND happiness <= 1.0),
    tempo INT NOT NULL CHECK (tempo > 0),
    danceability NUMERIC(3,2) NOT NULL CHECK (danceability >= 0.0 AND danceability <= 1.0),
    acousticness NUMERIC(3,2) NOT NULL CHECK (acousticness >= 0.0 AND acousticness <= 1.0)
);

-- 2. Users & Authentication
CREATE TYPE user_role_type AS ENUM ('user', 'admin');

CREATE TABLE Roles (
    role_id VARCHAR(64) PRIMARY KEY,
    role_name user_role_type NOT NULL UNIQUE
);

CREATE TABLE Users (
    user_id VARCHAR(64) PRIMARY KEY,
    role_id VARCHAR(64) NOT NULL REFERENCES Roles(role_id),
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    experiment_group CHAR(1) DEFAULT 'B' CHECK (experiment_group IN ('A', 'B')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

CREATE TABLE Auth_Sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE
);

CREATE TYPE playlist_kind AS ENUM ('normal', 'mood_journey');

CREATE TABLE Playlists (
    playlist_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    playlist_type playlist_kind DEFAULT 'normal',
    start_mood VARCHAR(32),
    target_mood VARCHAR(32),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Playlist_Songs (
    playlist_id VARCHAR(64) REFERENCES Playlists(playlist_id) ON DELETE CASCADE,
    song_id VARCHAR(64) REFERENCES Songs(song_id) ON DELETE CASCADE,
    position INT NOT NULL,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, song_id) -- Unique constraint: no duplicate song in one playlist
);

-- 3. Activity and Mood
CREATE TABLE Listening_History (
    history_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    song_id VARCHAR(64) NOT NULL REFERENCES Songs(song_id) ON DELETE RESTRICT,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    listened_sec INT NOT NULL,
    completed BOOLEAN NOT NULL,
    source VARCHAR(32) NOT NULL,
    suggestion_id VARCHAR(64)
);

CREATE TABLE Mood_Checkins (
    checkin_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    mood_label VARCHAR(32) NOT NULL,
    energy_level INT NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Mood_Scores (
    score_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    detected_mood VARCHAR(32) NOT NULL,
    mood_score INT NOT NULL CHECK (mood_score BETWEEN 0 AND 100),
    skip_count INT DEFAULT 0,
    replay_count INT DEFAULT 0,
    time_of_day VARCHAR(32),
    avg_energy NUMERIC(3,2),
    avg_tempo INT,
    checkin_id VARCHAR(64) REFERENCES Mood_Checkins(checkin_id) ON DELETE SET NULL
);

-- 4. Suggestions Engine
CREATE TABLE Suggestion_Batches (
    batch_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    experiment_id VARCHAR(64),
    variant CHAR(1) NOT NULL CHECK (variant IN ('A', 'B')),
    score_id VARCHAR(64) REFERENCES Mood_Scores(score_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Suggestions (
    suggestion_id VARCHAR(64) PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL REFERENCES Suggestion_Batches(batch_id) ON DELETE CASCADE,
    song_id VARCHAR(64) NOT NULL REFERENCES Songs(song_id) ON DELETE CASCADE,
    rank_position INT NOT NULL,
    total_score NUMERIC(5,3) NOT NULL,
    taste_score NUMERIC(4,2),
    mood_match_score NUMERIC(4,2),
    similar_users_score NUMERIC(4,2),
    freshness_score NUMERIC(4,2),
    recent_penalty NUMERIC(4,2),
    is_exploration BOOLEAN DEFAULT FALSE,
    outcome VARCHAR(32) DEFAULT 'pending'
);

CREATE TABLE Suggestion_Reasons (
    reason_id VARCHAR(64) PRIMARY KEY,
    suggestion_id VARCHAR(64) NOT NULL REFERENCES Suggestions(suggestion_id) ON DELETE CASCADE,
    reason_type VARCHAR(64) NOT NULL,
    reason_text TEXT NOT NULL,
    contribution NUMERIC(4,2) NOT NULL
);

-- 5. Feedback and Learning
CREATE TABLE Ratings (
    rating_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    song_id VARCHAR(64) NOT NULL REFERENCES Songs(song_id) ON DELETE CASCADE,
    suggestion_id VARCHAR(64) REFERENCES Suggestions(suggestion_id) ON DELETE SET NULL,
    stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    rated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Implicit_Signals (
    signal_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    song_id VARCHAR(64) NOT NULL REFERENCES Songs(song_id) ON DELETE CASCADE,
    suggestion_id VARCHAR(64) REFERENCES Suggestions(suggestion_id) ON DELETE SET NULL,
    signal_type VARCHAR(32) NOT NULL,
    signal_value NUMERIC(3,1) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE User_Taste_Profile (
    user_id VARCHAR(64) REFERENCES Users(user_id) ON DELETE CASCADE,
    genre_id VARCHAR(64) REFERENCES Genres(genre_id) ON DELETE CASCADE,
    affinity_score NUMERIC(4,2) DEFAULT 3.0,
    play_count INT DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, genre_id)
);

CREATE TABLE User_Similarity (
    user_id_a VARCHAR(64) REFERENCES Users(user_id) ON DELETE CASCADE,
    user_id_b VARCHAR(64) REFERENCES Users(user_id) ON DELETE CASCADE,
    similarity_score NUMERIC(4,3) NOT NULL,
    common_songs INT DEFAULT 0,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id_a, user_id_b)
);

-- 6. Control and Testing
CREATE TABLE Scoring_Weights (
    weight_id VARCHAR(64) PRIMARY KEY,
    weight_name VARCHAR(64) NOT NULL UNIQUE,
    weight_value NUMERIC(4,2) NOT NULL,
    updated_by VARCHAR(64) REFERENCES Users(user_id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Experiments (
    experiment_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(32) DEFAULT 'active'
);

-- 7. Impact and Safety
CREATE TABLE Song_Impact (
    impact_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    song_id VARCHAR(64) NOT NULL REFERENCES Songs(song_id) ON DELETE CASCADE,
    history_id VARCHAR(64) NOT NULL REFERENCES Listening_History(history_id) ON DELETE CASCADE,
    mood_before VARCHAR(32) NOT NULL,
    mood_after VARCHAR(32) NOT NULL,
    measured_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Audit_Log (
    log_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES Users(user_id) ON DELETE SET NULL,
    table_name VARCHAR(64) NOT NULL,
    record_id VARCHAR(64) NOT NULL,
    action VARCHAR(16) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data JSONB,
    new_data JSONB,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);`;

    openSqlModal('Complete PostgreSQL 16 DDL: 25 Relational Tables', ddl);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-teal-400 text-xs font-semibold uppercase tracking-wider font-mono">
            <Database className="w-4 h-4" />
            <span>PostgreSQL Relational Storage & Schema Catalog</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-1">
            Database Explorer
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
            Live inspection of all 25 relational tables with row counts, primary key (PK) & foreign key (FK) indicators, and real-time audit log.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShowFullDDL}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 font-semibold text-xs transition-colors"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Export 25-Table DDL Script</span>
          </button>
        </div>
      </div>

      {/* Tabs: Table Browser vs Live Audit Log */}
      <div className="flex items-center gap-2 border-b border-zinc-800">
        <button
          onClick={() => setActiveTab('tables')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'tables'
              ? 'border-teal-400 text-teal-400'
              : 'border-transparent text-zinc-400 hover:text-white'
          }`}
        >
          <TableIcon className="w-4 h-4" />
          <span>25 Relational Tables</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'audit'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-zinc-400 hover:text-white'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Live Audit Log ({schema.audit_log.length} records)</span>
        </button>
      </div>

      {activeTab === 'tables' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Table List categorized */}
          <div className="lg:col-span-1 space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {Object.entries(categories).map(([catName, tableMetas]) => (
              <div key={catName} className="space-y-1.5">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 font-bold block px-2">
                  {catName}
                </span>
                {tableMetas.map((meta) => {
                  const isSelected = selectedTableKey === meta.key;
                  const rowCount = (schema[meta.key] as unknown[]).length;
                  return (
                    <button
                      key={meta.key}
                      onClick={() => {
                        setSelectedTableKey(meta.key);
                        setSearchTerm('');
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-zinc-800 text-white font-bold border border-teal-500/50 shadow-sm'
                          : 'text-zinc-300 hover:bg-zinc-900 border border-transparent'
                      }`}
                    >
                      <span className="truncate">{meta.tableName}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-950 text-zinc-400 shrink-0">
                        {rowCount} rows
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Table Content & Row Inspection */}
          <div className="lg:col-span-3 space-y-4">
            <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-5 backdrop-blur-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <TableIcon className="w-4 h-4 text-teal-400" />
                    <h3 className="text-base font-bold text-white font-mono">{selectedMeta.tableName}</h3>
                    <span className="text-xs text-zinc-400">({tableData.length} total rows)</span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">{selectedMeta.description}</p>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder={`Search ${selectedMeta.tableName}...`}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-400 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Schema Keys Legend */}
              <div className="flex items-center gap-4 text-xs font-mono py-2 text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold">
                    PK
                  </span>
                  <span>Primary Key: [{selectedMeta.primaryKey.join(', ')}]</span>
                </div>
                {selectedMeta.foreignKeys.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/30 font-bold">
                      FK
                    </span>
                    <span>
                      Foreign Keys: {selectedMeta.foreignKeys.map((f) => `${f.column} → ${f.references}`).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Table Data View */}
              <div className="overflow-x-auto max-h-[55vh] overflow-y-auto mt-2 border border-zinc-800/80 rounded-xl">
                <table className="w-full text-left text-xs text-zinc-300 font-mono">
                  <thead className="bg-zinc-950 sticky top-0 z-10 border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      {columns.map((col) => {
                        const isPK = selectedMeta.primaryKey.includes(col);
                        const isFK = selectedMeta.foreignKeys.some((f) => f.column === col);

                        return (
                          <th key={col} className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{col}</span>
                              {isPK && (
                                <span className="px-1 rounded text-[9px] bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                                  PK
                                </span>
                              )}
                              {isFK && (
                                <span className="px-1 rounded text-[9px] bg-teal-500/20 text-teal-300 font-bold border border-teal-500/40">
                                  FK
                                </span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/40">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length || 1} className="py-8 text-center text-zinc-500">
                          No matching records found in table.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.slice(0, 50).map((row, idx) => (
                        <tr key={idx} className="hover:bg-zinc-900/60 transition-colors">
                          {columns.map((col) => {
                            const val = row[col];
                            const isPK = selectedMeta.primaryKey.includes(col);

                            return (
                              <td
                                key={col}
                                className={`py-2 px-3 whitespace-nowrap max-w-xs truncate ${
                                  isPK ? 'text-amber-300 font-semibold' : ''
                                }`}
                              >
                                {val === null ? (
                                  <span className="text-zinc-600 italic">null</span>
                                ) : typeof val === 'boolean' ? (
                                  <span className={val ? 'text-emerald-400' : 'text-zinc-500'}>
                                    {String(val)}
                                  </span>
                                ) : (
                                  String(val)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="text-[11px] text-zinc-500 font-mono mt-3 text-right">
                Showing {Math.min(filteredRows.length, 50)} of {filteredRows.length} rows
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" />
                <h3 className="text-base font-bold text-white">Live Append-Only Audit Trail (Audit_Log Table)</h3>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Every rating, play, check-in, scoring weight change, and playlist insert logs a row into <code className="text-teal-400 font-mono">Audit_Log</code>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {['ALL', 'INSERT', 'UPDATE', 'DELETE'].map((action) => (
                <button
                  key={action}
                  onClick={() => setAuditFilter(action)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-medium border transition-colors ${
                    auditFilter === action
                      ? 'bg-zinc-800 border-amber-400 text-amber-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="w-full text-left text-xs text-zinc-300 font-mono">
              <thead className="bg-zinc-950 sticky top-0 z-10 border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="py-2.5 px-3">Log ID</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Table Name</th>
                  <th className="py-2.5 px-3">Record ID</th>
                  <th className="py-2.5 px-3">User ID</th>
                  <th className="py-2.5 px-3">Payload Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/40">
                {filteredAudit.map((log) => (
                  <tr key={log.log_id} className="hover:bg-zinc-900/60 transition-colors">
                    <td className="py-2 px-3 text-zinc-500">{log.log_id.slice(-8)}</td>
                    <td className="py-2 px-3 text-zinc-400">
                      {new Date(log.changed_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.action === 'INSERT'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : log.action === 'UPDATE'
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-bold text-white">{log.table_name}</td>
                    <td className="py-2 px-3 text-zinc-400">{log.record_id}</td>
                    <td className="py-2 px-3 text-zinc-500">{log.user_id || 'SYSTEM'}</td>
                    <td className="py-2 px-3 text-zinc-400 max-w-sm truncate text-[11px]">
                      {log.new_data || log.old_data || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
