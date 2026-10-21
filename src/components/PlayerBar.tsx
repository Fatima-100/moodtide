import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  ListPlus,
  Music,
  Check,
  Plus,
} from 'lucide-react';

export const PlayerBar: React.FC = () => {
  const {
    currentSong,
    currentFeatures,
    isPlaying,
    progressSec,
    volume,
    schema,
    currentUser,
    pauseSong,
    resumeSong,
    seekSong,
    skipSong,
    replaySong,
    setVolume,
    addSongToPlaylist,
    createNewPlaylist,
  } = useApp();

  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);

  if (!currentSong) return null;

  const artist = schema.artists.find((a) => a.artist_id === currentSong.artist_id);
  const userPlaylists = schema.playlists.filter((p) => p.user_id === currentUser.user_id);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleAddTrack = (playlistId: string) => {
    const success = addSongToPlaylist(playlistId, currentSong.song_id);
    if (success) {
      setPlaylistMenuOpen(false);
    }
  };

  const handleCreateAndAdd = () => {
    if (!newPlaylistName.trim()) return;
    const pl = createNewPlaylist(newPlaylistName.trim(), 'Created from player');
    if (pl) {
      addSongToPlaylist(pl.playlist_id, currentSong.song_id);
      setNewPlaylistName('');
      setShowNewInput(false);
      setPlaylistMenuOpen(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 border-t border-zinc-800/80 backdrop-blur-xl shadow-2xl px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Track Info */}
        <div className="flex items-center gap-3 w-full sm:w-1/3 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700/60 flex items-center justify-center text-teal-400 shrink-0 shadow-inner relative overflow-hidden">
            <Music className="w-5 h-5" />
            {isPlaying && (
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-0.5 h-3 px-1 pb-0.5 bg-black/40">
                <span className="w-1 bg-teal-400 animate-pulse h-2 rounded-t" />
                <span className="w-1 bg-teal-300 animate-pulse delay-75 h-3 rounded-t" />
                <span className="w-1 bg-teal-400 animate-pulse delay-150 h-1.5 rounded-t" />
              </div>
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-zinc-100 truncate">{currentSong.title}</h4>
            </div>
            <p className="text-xs text-zinc-400 truncate">{artist?.name || 'Unknown Artist'}</p>
            {currentFeatures && (
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono mt-0.5">
                <span>{currentFeatures.tempo} BPM</span>
                <span>·</span>
                <span>Energy {(currentFeatures.energy * 100).toFixed(0)}%</span>
                <span>·</span>
                <span>Happiness {(currentFeatures.happiness * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Player Controls & Progress Bar */}
        <div className="flex flex-col items-center gap-1.5 w-full sm:w-1/2 max-w-xl">
          <div className="flex items-center gap-4">
            <button
              onClick={replaySong}
              title="Replay Song (Triggers +2 implicit signal in database)"
              className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={isPlaying ? pauseSong : resumeSong}
              className="w-9 h-9 rounded-full bg-white hover:bg-zinc-200 text-zinc-950 flex items-center justify-center transition-all shadow-md active:scale-95"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            <button
              onClick={skipSong}
              title="Skip Song (Triggers -1 implicit signal; 3 skips fires Stressed mood rule!)"
              className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 w-full text-xs font-mono text-zinc-400">
            <span className="w-10 text-right tabular-nums">{formatTime(progressSec)}</span>
            <input
              type="range"
              min={0}
              max={currentSong.duration_sec}
              value={progressSec}
              onChange={(e) => seekSong(Number(e.target.value))}
              className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
            />
            <span className="w-10 tabular-nums">{formatTime(currentSong.duration_sec)}</span>
          </div>
        </div>

        {/* Volume & Playlist Actions */}
        <div className="flex items-center justify-end gap-3 w-full sm:w-1/3">
          {/* Add to Playlist button */}
          <div className="relative">
            <button
              onClick={() => setPlaylistMenuOpen(!playlistMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 transition-colors"
              title="Add to relational playlist"
            >
              <ListPlus className="w-3.5 h-3.5 text-teal-400" />
              <span className="hidden md:inline">Add to Playlist</span>
            </button>

            {playlistMenuOpen && (
              <div className="absolute right-0 bottom-full mb-2 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-bottom-2">
                <div className="px-3 py-1.5 border-b border-zinc-800 text-xs font-semibold text-zinc-300">
                  Select Playlist
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {userPlaylists.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-zinc-500">No playlists created yet.</p>
                  ) : (
                    userPlaylists.map((pl) => {
                      const isAlreadyIn = schema.playlist_songs.some(
                        (ps) => ps.playlist_id === pl.playlist_id && ps.song_id === currentSong.song_id
                      );
                      return (
                        <button
                          key={pl.playlist_id}
                          onClick={() => handleAddTrack(pl.playlist_id)}
                          className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-left text-zinc-300 hover:bg-zinc-800 transition-colors"
                        >
                          <span className="truncate">{pl.name}</span>
                          {isAlreadyIn && (
                            <span className="text-[10px] text-amber-400 font-mono">(In playlist)</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {showNewInput ? (
                  <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="Playlist title..."
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none"
                    />
                    <button
                      onClick={handleCreateAndAdd}
                      className="p-1 rounded bg-teal-500 text-zinc-950 hover:bg-teal-400"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewInput(true)}
                    className="w-full mt-1 pt-1.5 border-t border-zinc-800 flex items-center justify-center gap-1 text-xs text-teal-400 hover:text-teal-300 font-medium py-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Playlist</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 0.65)}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
