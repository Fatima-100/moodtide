import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { playlistsApi } from '../lib/api';
import { ListPlus, Check } from 'lucide-react';

/** "+" button for any song card: pick a playlist, or create a new one and add the song to it. */
export const AddToPlaylistButton: React.FC<{ song: any }> = ({ song }) => {
  const { isAuthenticated, addToast } = useApp();
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const openMenu = async () => {
    if (!isAuthenticated) {
      addToast({ type: 'info', title: 'Sign in first', message: 'You need an account to use playlists.' });
      return;
    }
    setOpen(true);
    setError('');
    try {
      setPlaylists((await playlistsApi.list()) || []);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addTo = async (playlistId: string, playlistName: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await playlistsApi.addSong(playlistId, song.song_id);
      addToast({ type: 'success', title: 'Added', message: `"${song.title}" is now in ${playlistName}` });
      setOpen(false);
    } catch (e: any) {
      setError(e.message); // for example "Song is already in this playlist"
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const n = newName.trim();
    if (!n || busy) return;
    setBusy(true);
    setError('');
    try {
      const { playlist_id } = await playlistsApi.create(n);
      await playlistsApi.addSong(playlist_id, song.song_id);
      addToast({ type: 'success', title: 'Playlist created', message: `"${song.title}" added to ${n}` });
      setNewName('');
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button onClick={openMenu} aria-label="Add to playlist" title="Add to playlist" className="text-zinc-400 hover:text-teal-300">
        <ListPlus className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 z-50 rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl p-2 space-y-1">
            <p className="px-2 py-1 text-[11px] text-zinc-500">Add to playlist</p>
            <div className="max-h-40 overflow-y-auto">
              {playlists.length === 0 && <p className="px-2 py-1.5 text-xs text-zinc-500">No playlists yet</p>}
              {playlists.map((p) => (
                <button
                  key={p.playlist_id}
                  onClick={() => addTo(p.playlist_id, p.name)}
                  disabled={busy}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-zinc-500 shrink-0">{p.song_count ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-1 pt-1 border-t border-zinc-800">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createAndAdd()}
                placeholder="New playlist"
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-100 outline-none focus:border-teal-400"
              />
              <button onClick={createAndAdd} disabled={busy || !newName.trim()} aria-label="Create and add" className="px-2 rounded-lg bg-teal-500 text-zinc-950 disabled:opacity-50">
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
            {error && <p className="px-2 text-[11px] text-red-300 break-words">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
};