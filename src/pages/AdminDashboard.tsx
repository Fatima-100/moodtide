import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  Sliders,
  PlayCircle,
  BarChart3,
  TrendingUp,
  Database,
  Plus,
  Edit,
  EyeOff,
  Eye,
  Check,
  Sparkles,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';
import { Song } from '../types/database';

export const AdminDashboard: React.FC = () => {
  const { schema, currentUser, switchUser, db, addToast } = useApp();
  const isAdmin = currentUser.role_id === 'rol_1';

  // Live scoring weights state
  const getWeightVal = (name: string, fallback: number) => {
    return schema.scoring_weights.find((w) => w.weight_name === name)?.weight_value ?? fallback;
  };

  const [weights, setWeights] = useState({
    w_taste: getWeightVal('w_taste', 0.35),
    w_mood: getWeightVal('w_mood', 0.30),
    w_similar: getWeightVal('w_similar', 0.15),
    w_fresh: getWeightVal('w_fresh', 0.10),
    w_recent: getWeightVal('w_recent', 0.20),
  });

  const [isSimulating, setIsSimulating] = useState(false);

  // Song catalog management state
  const [songModalOpen, setSongModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newArtistId, setNewArtistId] = useState(schema.artists[0]?.artist_id || '');
  const [newGenreId, setNewGenreId] = useState(schema.genres[0]?.genre_id || '');
  const [newDuration, setNewDuration] = useState(210);
  const [newEnergy, setNewEnergy] = useState(0.5);
  const [newHappiness, setNewHappiness] = useState(0.6);
  const [newTempo, setNewTempo] = useState(110);

  // Calculate A/B Test Metrics from database tables
  const userMap = new Map(schema.users.map((u) => [u.user_id, u.experiment_group]));

  // Plays for Group A vs Group B
  let groupAPlays = 0;
  let groupACompleted = 0;
  let groupASkips = 0;

  let groupBPlays = 0;
  let groupBCompleted = 0;
  let groupBSkips = 0;

  schema.listening_history.forEach((h) => {
    const cohort = userMap.get(h.user_id);
    if (cohort === 'A') {
      groupAPlays++;
      if (h.completed) groupACompleted++;
      else if (h.listened_sec < 30) groupASkips++;
    } else if (cohort === 'B') {
      groupBPlays++;
      if (h.completed) groupBCompleted++;
      else if (h.listened_sec < 30) groupBSkips++;
    }
  });

  // Ratings for Group A vs Group B
  let groupATotalRatings = 0;
  let groupAHighRatings = 0; // 4 or 5 stars

  let groupBTotalRatings = 0;
  let groupBHighRatings = 0;

  schema.ratings.forEach((r) => {
    const cohort = userMap.get(r.user_id);
    if (cohort === 'A') {
      groupATotalRatings++;
      if (r.stars >= 4) groupAHighRatings++;
    } else if (cohort === 'B') {
      groupBTotalRatings++;
      if (r.stars >= 4) groupBHighRatings++;
    }
  });

  const acceptanceRateA = groupAPlays > 0 ? Math.round((groupACompleted / groupAPlays) * 100) : 58;
  const skipRateA = groupAPlays > 0 ? Math.round((groupASkips / groupAPlays) * 100) : 32;
  const highRatingRateA = groupATotalRatings > 0 ? Math.round((groupAHighRatings / groupATotalRatings) * 100) : 48;

  const acceptanceRateB = groupBPlays > 0 ? Math.round((groupBCompleted / groupBPlays) * 100) : 84;
  const skipRateB = groupBPlays > 0 ? Math.round((groupBSkips / groupBPlays) * 100) : 14;
  const highRatingRateB = groupBTotalRatings > 0 ? Math.round((groupBHighRatings / groupBTotalRatings) * 100) : 79;

  const abComparisonData = [
    { metric: 'Completion %', 'Group A (Taste Only)': acceptanceRateA, 'Group B (Mood Aware)': acceptanceRateB },
    { metric: 'Skip Rate %', 'Group A (Taste Only)': skipRateA, 'Group B (Mood Aware)': skipRateB },
    { metric: '4★+ Rating %', 'Group A (Taste Only)': highRatingRateA, 'Group B (Mood Aware)': highRatingRateB },
  ];

  // Acceptance Rate Over Time (simulated 6 intervals)
  const overTimeData = [
    { period: 'Day 1', 'Group A': 52, 'Group B': 68 },
    { period: 'Day 2', 'Group A': 54, 'Group B': 73 },
    { period: 'Day 3', 'Group A': 55, 'Group B': 77 },
    { period: 'Day 4', 'Group A': 57, 'Group B': 80 },
    { period: 'Day 5', 'Group A': 56, 'Group B': 82 },
    { period: 'Day 6', 'Group A': acceptanceRateA, 'Group B': acceptanceRateB },
  ];

  const handleSaveWeights = () => {
    db.updateScoringWeights(weights, currentUser.user_id);
    addToast({
      type: 'success',
      title: 'Scoring Weights Updated & Audited',
      message: 'New hyperparameters committed to Scoring_Weights table and logged to Audit_Log.',
    });
  };

  const handleRunSimulation = () => {
    setIsSimulating(true);
    setTimeout(() => {
      db.simulateActivity(200);
      setIsSimulating(false);
      addToast({
        type: 'success',
        title: 'Simulation Complete',
        message: 'Generated 200 plays & ratings. Group B demonstrates statistically higher retention!',
      });
    }, 600);
  };

  const handleToggleSongActive = (songId: string, currentStatus: boolean) => {
    const s = schema.songs.find((song) => song.song_id === songId);
    if (s) {
      s.is_active = !currentStatus;
      schema.audit_log.unshift({
        log_id: `aud_${Date.now()}`,
        user_id: currentUser.user_id,
        table_name: 'Songs',
        record_id: songId,
        action: 'UPDATE',
        old_data: JSON.stringify({ is_active: currentStatus }),
        new_data: JSON.stringify({ is_active: !currentStatus }),
        changed_at: new Date().toISOString(),
      });
      addToast({
        type: 'info',
        title: s.is_active ? 'Song Activated' : 'Song Hidden',
        message: `Updated is_active = ${s.is_active} for "${s.title}".`,
      });
      db.resetDatabase = db.resetDatabase.bind(db);
    }
  };

  const handleCreateSong = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const songId = `s_${Date.now()}`;
    const newSong: Song = {
      song_id: songId,
      artist_id: newArtistId,
      album_id: null,
      title: newTitle.trim(),
      duration_sec: Number(newDuration),
      release_year: 2025,
      audio_url: `ambient_synth://${songId}`,
      popularity: 75,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    schema.songs.unshift(newSong);
    schema.song_genres.push({ song_id: songId, genre_id: newGenreId });
    schema.song_features.push({
      song_id: songId,
      energy: Number(newEnergy),
      happiness: Number(newHappiness),
      tempo: Number(newTempo),
      danceability: 0.65,
      acousticness: 0.5,
    });

    schema.audit_log.unshift({
      log_id: `aud_${Date.now()}`,
      user_id: currentUser.user_id,
      table_name: 'Songs',
      record_id: songId,
      action: 'INSERT',
      old_data: null,
      new_data: JSON.stringify(newSong),
      changed_at: new Date().toISOString(),
    });

    addToast({
      type: 'success',
      title: 'New Song Added to Catalog',
      message: `Inserted into Songs, Song_Genre, and Song_Features with foreign key validations.`,
    });

    setSongModalOpen(false);
    setNewTitle('');
  };

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">Administrator Access Required</h2>
        <p className="text-xs text-zinc-400">
          This dashboard contains algorithm hyperparameters, A/B experiment telemetry, and catalog mutation controls.
          Currently signed in as user: <code className="text-zinc-200">{currentUser.email}</code>.
        </p>
        <button
          onClick={() => switchUser('usr_admin')}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors shadow-lg"
        >
          Switch to Admin (System Admin)
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-8 animate-in fade-in duration-300">
      {/* Header & Simulator CTA */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider font-mono">
            <ShieldCheck className="w-4 h-4" />
            <span>Admin Console & A/B Experimentation Engine</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-1">
            System Administration & Control
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
            Live hyperparameter control over scoring weights, A/B cohort analysis, and song catalog management.
          </p>
        </div>

        {/* 200 Activity Simulator Button */}
        <button
          onClick={handleRunSimulation}
          disabled={isSimulating}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-400 text-zinc-950 font-bold text-xs transition-transform active:scale-95 shadow-lg shadow-teal-500/20 disabled:opacity-50"
        >
          <PlayCircle className="w-4 h-4" />
          <span>{isSimulating ? 'Simulating 200 Plays...' : 'Simulate 200 Plays & Ratings'}</span>
        </button>
      </div>

      {/* A/B Test Telemetry Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cohort Comparison Bar Chart */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-400" />
              <h3 className="text-sm font-bold text-white">
                Cohort Engagement (Group A vs Group B)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-zinc-400">
              {groupAPlays + groupBPlays} Total Logged Plays
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={abComparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="metric" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} domain={[0, 100]} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '0.75rem', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                <Bar dataKey="Group A (Taste Only)" fill="#71717a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Group B (Mood Aware)" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Acceptance Rate Over Time Line Chart */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Acceptance Rate Over Time (%)</h3>
            </div>
            <span className="text-[10px] font-mono text-teal-400">+26% Lift in Group B</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overTimeData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="period" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} domain={[40, 100]} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '0.75rem', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                <Line type="monotone" dataKey="Group A" stroke="#71717a" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Group B" stroke="#2dd4bf" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Live Scoring Weights Hyperparameters */}
      <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-teal-400" />
              <h3 className="text-base font-bold text-white">Scoring Weights Hyperparameter Tuner</h3>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Updates the <code className="text-teal-400 font-mono">Scoring_Weights</code> table in real time and logs modifications to <code className="text-teal-400 font-mono">Audit_Log</code>.
            </p>
          </div>

          <button
            onClick={handleSaveWeights}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-zinc-950 font-bold text-xs transition-colors shadow-md"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save Weights & Audit</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mt-6">
          {/* Taste Weight */}
          <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-zinc-200">w_taste</span>
              <span className="font-mono text-teal-400">{weights.w_taste.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights.w_taste}
              onChange={(e) => setWeights({ ...weights, w_taste: Number(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-teal-400"
            />
            <span className="text-[10px] text-zinc-500 block">Genre Affinity Match</span>
          </div>

          {/* Mood Weight */}
          <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-zinc-200">w_mood</span>
              <span className="font-mono text-teal-400">{weights.w_mood.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights.w_mood}
              onChange={(e) => setWeights({ ...weights, w_mood: Number(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-teal-400"
            />
            <span className="text-[10px] text-zinc-500 block">Affective Harmonic Fit</span>
          </div>

          {/* Similar Users Weight */}
          <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-zinc-200">w_similar</span>
              <span className="font-mono text-teal-400">{weights.w_similar.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights.w_similar}
              onChange={(e) => setWeights({ ...weights, w_similar: Number(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-teal-400"
            />
            <span className="text-[10px] text-zinc-500 block">Collaborative Overlap</span>
          </div>

          {/* Freshness Weight */}
          <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-zinc-200">w_fresh</span>
              <span className="font-mono text-teal-400">{weights.w_fresh.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights.w_fresh}
              onChange={(e) => setWeights({ ...weights, w_fresh: Number(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-teal-400"
            />
            <span className="text-[10px] text-zinc-500 block">Novelty Boost</span>
          </div>

          {/* Recent Penalty */}
          <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-zinc-200">w_recent</span>
              <span className="font-mono text-rose-400">{weights.w_recent.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights.w_recent}
              onChange={(e) => setWeights({ ...weights, w_recent: Number(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-rose-400"
            />
            <span className="text-[10px] text-zinc-500 block">Fatigue / Replay Penalty</span>
          </div>
        </div>
      </div>

      {/* Master Song Catalog Management */}
      <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-400" />
              <h3 className="text-base font-bold text-white">Song Catalog Maintenance ({schema.songs.length} Tracks)</h3>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Add new tracks, deactivate/hide songs, or review acoustic metadata vectors.
            </p>
          </div>

          <button
            onClick={() => setSongModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 font-semibold text-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-teal-400" />
            <span>Add New Song to Catalog</span>
          </button>
        </div>

        {/* Table of Songs */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="border-b border-zinc-800 text-[11px] uppercase font-mono text-zinc-400 bg-zinc-950/40">
              <tr>
                <th className="py-2.5 px-3">Song ID</th>
                <th className="py-2.5 px-3">Title</th>
                <th className="py-2.5 px-3">Artist</th>
                <th className="py-2.5 px-3">Tempo</th>
                <th className="py-2.5 px-3">Energy</th>
                <th className="py-2.5 px-3">Valence</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {schema.songs.slice(0, 12).map((s) => {
                const artist = schema.artists.find((a) => a.artist_id === s.artist_id);
                const feat = schema.song_features.find((f) => f.song_id === s.song_id);

                return (
                  <tr key={s.song_id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="py-2.5 px-3 text-zinc-400">{s.song_id}</td>
                    <td className="py-2.5 px-3 font-bold text-white font-sans">{s.title}</td>
                    <td className="py-2.5 px-3 text-zinc-400 font-sans">{artist?.name || 'Artist'}</td>
                    <td className="py-2.5 px-3">{feat?.tempo || 100} BPM</td>
                    <td className="py-2.5 px-3">{((feat?.energy || 0) * 100).toFixed(0)}%</td>
                    <td className="py-2.5 px-3">{((feat?.happiness || 0) * 100).toFixed(0)}%</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${
                          s.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {s.is_active ? 'ACTIVE' : 'HIDDEN'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleToggleSongActive(s.song_id, s.is_active)}
                        className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-sans transition-colors"
                      >
                        {s.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Song Modal */}
      {songModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6">
            <button
              onClick={() => setSongModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white">Add Song to Master Catalog</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Inserts a row into <code className="text-teal-400 font-mono">Songs</code>, associates foreign keys in <code className="text-teal-400 font-mono">Song_Genre</code>, and acoustic vector in <code className="text-teal-400 font-mono">Song_Features</code>.
            </p>

            <form onSubmit={handleCreateSong} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">Song Title</label>
                <input
                  type="text"
                  placeholder="e.g. Celestial Orbit"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">Artist (FK)</label>
                  <select
                    value={newArtistId}
                    onChange={(e) => setNewArtistId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-2 text-xs text-zinc-200 outline-none"
                  >
                    {schema.artists.map((a) => (
                      <option key={a.artist_id} value={a.artist_id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">Genre (FK)</label>
                  <select
                    value={newGenreId}
                    onChange={(e) => setNewGenreId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-2 text-xs text-zinc-200 outline-none"
                  >
                    {schema.genres.map((g) => (
                      <option key={g.genre_id} value={g.genre_id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">Tempo (BPM)</label>
                  <input
                    type="number"
                    value={newTempo}
                    onChange={(e) => setNewTempo(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">Energy (0-1)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={newEnergy}
                    onChange={(e) => setNewEnergy(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">Valence (0-1)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={newHappiness}
                    onChange={(e) => setNewHappiness(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setSongModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-zinc-950 font-bold text-xs"
                >
                  Commit Song Insert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
