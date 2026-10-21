import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ListMusic,
  Plus,
  Trash2,
  Edit2,
  Play,
  Pause,
  AlertTriangle,
  Music,
  Check,
  X,
  Compass,
} from 'lucide-react';
import { Song } from '../types/database';

export const PlaylistsPage: React.FC = () => {
  const {
    schema,
    currentUser,
    createNewPlaylist,
    addSongToPlaylist,
    playSong,
    currentSong,
    isPlaying,
    pauseSong,
    resumeSong,
    addToast,
    db,
  } = useApp();

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Editing title
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Song picker modal to test adding songs and duplicate constraint
  const [showAddSongModal, setShowAddSongModal] = useState(false);
  const [searchSong, setSearchSong] = useState('');

  const userPlaylists = schema.playlists.filter((p) => p.user_id === currentUser.user_id);
  const activePlaylist = userPlaylists.find((p) => p.playlist_id === selectedPlaylistId) || userPlaylists[0];

  const playlistSongs = activePlaylist
    ? schema.playlist_songs
        .filter((ps) => ps.playlist_id === activePlaylist.playlist_id)
        .sort((a, b) => a.position - b.position)
        .map((ps) => {
          const s = schema.songs.find((song) => song.song_id === ps.song_id);
          const artist = s ? schema.artists.find((a) => a.artist_id === s.artist_id) : null;
          const feat = s ? schema.song_features.find((f) => f.song_id === s.song_id) : null;
          return {
            ...ps,
            song: s,
            artist,
            feat,
          };
        })
    : [];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const pl = createNewPlaylist(newTitle.trim(), newDesc.trim() || 'Custom user playlist');
    if (pl) {
      setSelectedPlaylistId(pl.playlist_id);
      setNewTitle('');
      setNewDesc('');
      setShowCreateModal(false);
    }
  };

  const handleDeletePlaylist = (playlistId: string) => {
    const pl = schema.playlists.find((p) => p.playlist_id === playlistId);
    if (!pl) return;
    // Cascade delete playlist_songs
    schema.playlist_songs = schema.playlist_songs.filter((ps) => ps.playlist_id !== playlistId);
    schema.playlists = schema.playlists.filter((p) => p.playlist_id !== playlistId);
    schema.audit_log.unshift({
      log_id: `aud_${Date.now()}`,
      user_id: currentUser.user_id,
      table_name: 'Playlists',
      record_id: playlistId,
      action: 'DELETE',
      old_data: JSON.stringify(pl),
      new_data: null,
      changed_at: new Date().toISOString(),
    });
    addToast({
      type: 'info',
      title: 'Playlist Deleted',
      message: `CASCADE DELETED "${pl.name}" and associated rows from Playlist_Songs.`,
    });
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
    }
    db.resetDatabase = db.resetDatabase.bind(db);
  };

  const handleSaveRename = (playlistId: string) => {
    if (!editTitle.trim()) return;
    const pl = schema.playlists.find((p) => p.playlist_id === playlistId);
    if (pl) {
      const oldName = pl.name;
      pl.name = editTitle.trim();
      schema.audit_log.unshift({
        log_id: `aud_${Date.now()}`,
        user_id: currentUser.user_id,
        table_name: 'Playlists',
        record_id: playlistId,
        action: 'UPDATE',
        old_data: JSON.stringify({ name: oldName }),
        new_data: JSON.stringify({ name: pl.name }),
        changed_at: new Date().toISOString(),
      });
      addToast({
        type: 'success',
        title: 'Playlist Renamed',
        message: `Updated name to "${pl.name}". Audit log updated.`,
      });
    }
    setEditingPlaylistId(null);
  };

  const handleRemoveTrack = (playlistId: string, songId: string) => {
    schema.playlist_songs = schema.playlist_songs.filter(
      (ps) => !(ps.playlist_id === playlistId && ps.song_id === songId)
    );
    schema.audit_log.unshift({
      log_id: `aud_${Date.now()}`,
      user_id: currentUser.user_id,
      table_name: 'Playlist_Songs',
      record_id: `${playlistId}_${songId}`,
      action: 'DELETE',
      old_data: JSON.stringify({ playlistId, songId }),
      new_data: null,
      changed_at: new Date().toISOString(),
    });
    addToast({
      type: 'info',
      title: 'Track Removed',
      message: 'Removed from Playlist_Songs table.',
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Playlists & Collections</h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Enforces composite unique keys <code className="font-mono text-teal-400">(playlist_id, song_id)</code> to prevent duplicate entries.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-zinc-950 font-semibold text-xs transition-colors shadow-md"
        >
          <Plus className="w-4 h-4" />
          <span>Create Playlist</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Playlists List */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
            Your Playlists ({userPlaylists.length})
          </h3>

          <div className="space-y-2">
            {userPlaylists.length === 0 ? (
              <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center text-zinc-500 text-xs">
                No playlists found for current user. Click "Create Playlist" above!
              </div>
            ) : (
              userPlaylists.map((pl) => {
                const count = schema.playlist_songs.filter((ps) => ps.playlist_id === pl.playlist_id).length;
                const isSelected = activePlaylist?.playlist_id === pl.playlist_id;
                const isMoodJourney = pl.playlist_type === 'mood_journey';

                return (
                  <div
                    key={pl.playlist_id}
                    onClick={() => setSelectedPlaylistId(pl.playlist_id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-800/90 border-teal-500/60 shadow-lg shadow-teal-500/5'
                        : 'bg-zinc-900/40 border-zinc-800/70 hover:bg-zinc-900/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {editingPlaylistId === pl.playlist_id ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-xs text-white"
                            />
                            <button
                              onClick={() => handleSaveRename(pl.playlist_id)}
                              className="p-1 rounded bg-teal-500 text-zinc-950"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingPlaylistId(null)}
                              className="p-1 rounded bg-zinc-800 text-zinc-400"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <h4 className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                            {isMoodJourney && <Compass className="w-3.5 h-3.5 text-teal-400 shrink-0" />}
                            <span>{pl.name}</span>
                          </h4>
                        )}
                        <p className="text-xs text-zinc-400 truncate mt-0.5">{pl.description}</p>
                        <span className="text-[11px] text-zinc-500 font-mono mt-1 block">
                          {count} tracks · {isMoodJourney ? 'Generated Journey' : 'User Playlist'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setEditingPlaylistId(pl.playlist_id);
                            setEditTitle(pl.name);
                          }}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                          title="Rename playlist"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeletePlaylist(pl.playlist_id)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                          title="Delete playlist"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Selected Playlist Detail & Tracks */}
        <div className="lg:col-span-2 space-y-4">
          {activePlaylist ? (
            <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 p-6 backdrop-blur-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <ListMusic className="w-5 h-5 text-teal-400" />
                    <h2 className="text-xl font-bold text-white tracking-tight">{activePlaylist.name}</h2>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{activePlaylist.description}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAddSongModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Song to Playlist</span>
                  </button>
                </div>
              </div>

              {/* Tracks List */}
              <div className="divide-y divide-zinc-800/60 mt-2">
                {playlistSongs.length === 0 ? (
                  <div className="py-12 text-center text-zinc-500 text-xs">
                    No songs in this playlist yet. Click "Add Song to Playlist" to select tracks from the master catalog!
                  </div>
                ) : (
                  playlistSongs.map((ps) => {
                    const song = ps.song;
                    if (!song) return null;
                    const isCurrent = currentSong?.song_id === song.song_id;
                    const isPlayingCurrent = isCurrent && isPlaying;

                    return (
                      <div
                        key={ps.song_id}
                        className="py-3 flex items-center justify-between gap-3 group hover:bg-zinc-800/30 px-2 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            onClick={() => {
                              if (isPlayingCurrent) pauseSong();
                              else if (isCurrent) resumeSong();
                              else playSong(song, 'playlist');
                            }}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                              isPlayingCurrent
                                ? 'bg-teal-400 text-zinc-950'
                                : 'bg-zinc-800 text-zinc-300 group-hover:bg-teal-500 group-hover:text-zinc-950'
                            }`}
                          >
                            {isPlayingCurrent ? (
                              <Pause className="w-3.5 h-3.5 fill-current" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-white truncate">{song.title}</h4>
                            <p className="text-[11px] text-zinc-400 truncate">
                              {ps.artist?.name || 'Artist'} · Pos #{ps.position}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                          {ps.feat && (
                            <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline">
                              {ps.feat.tempo} BPM · Energy {((ps.feat.energy || 0) * 100).toFixed(0)}%
                            </span>
                          )}
                          <span className="text-xs font-mono text-zinc-400">
                            {formatDuration(song.duration_sec)}
                          </span>
                          <button
                            onClick={() => handleRemoveTrack(activePlaylist.playlist_id, song.song_id)}
                            className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors"
                            title="Remove from playlist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center text-zinc-500 text-xs">
              Select or create a playlist on the left.
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create Playlist */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-white">Create New Playlist</h3>
            <p className="text-xs text-zinc-400 mt-1">
              Creates a row in the <code className="text-teal-400 font-mono">Playlists</code> table with foreign key to user <code className="text-teal-400 font-mono">{currentUser.user_id}</code>.
            </p>

            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">Playlist Name</label>
                <input
                  type="text"
                  placeholder="e.g. Late Night Synapses"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-400"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">Description</label>
                <textarea
                  placeholder="Brief context on this collection..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-400"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-zinc-950 font-semibold text-xs transition-colors shadow-sm"
                >
                  Insert Playlist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Song to Playlist (to test duplicate constraint) */}
      {showAddSongModal && activePlaylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-xl max-h-[80vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6">
            <button
              onClick={() => setShowAddSongModal(false)}
              className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-teal-400" />
              <h3 className="text-lg font-bold text-white">Add Song to "{activePlaylist.name}"</h3>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Select any song from the master catalog of 60 songs. Adding an existing song will test the duplicate constraint!
            </p>

            <div className="mt-3 mb-2">
              <input
                type="text"
                placeholder="Search song title or artist..."
                value={searchSong}
                onChange={(e) => setSearchSong(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-400"
              />
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60 my-2 pr-1">
              {schema.songs
                .filter((s) => s.title.toLowerCase().includes(searchSong.toLowerCase()))
                .map((s) => {
                  const artist = schema.artists.find((a) => a.artist_id === s.artist_id);
                  const isAlreadyIn = schema.playlist_songs.some(
                    (ps) => ps.playlist_id === activePlaylist.playlist_id && ps.song_id === s.song_id
                  );

                  return (
                    <div
                      key={s.song_id}
                      className="py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-white">{s.title}</p>
                        <p className="text-[11px] text-zinc-400">{artist?.name || 'Artist'}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        {isAlreadyIn && (
                          <span className="text-[10px] text-amber-400 font-mono">
                            Already in Playlist
                          </span>
                        )}
                        <button
                          onClick={() => {
                            addSongToPlaylist(activePlaylist.playlist_id, s.song_id);
                          }}
                          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                            isAlreadyIn
                              ? 'bg-amber-950/80 border border-amber-500/40 text-amber-300 hover:bg-amber-900'
                              : 'bg-teal-500 hover:bg-teal-400 text-zinc-950'
                          }`}
                        >
                          {isAlreadyIn ? 'Test Duplicate Constraint' : 'Add Track'}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setShowAddSongModal(false)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
