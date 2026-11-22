import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { playlistsApi, catalogApi } from '../lib/api';
import { ListMusic, Play, Trash2, X, ChevronDown, ChevronUp, Plus, Search } from 'lucide-react';

export const PlaylistsPage: React.FC = () => {
  const { isAuthenticated, addToast, playSong } = useApp();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [songsById, setSongsById] = useState<Record<string, any[]>>({});
  // "add songs" search inside the open playlist
  const [findQ, setFindQ] = useState('');
  const [found, setFound] = useState<any[]>([]);

  const load = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      setPlaylists((await playlistsApi.list()) || []);
    } catch (e: any) {
      setError(`Could not load playlists: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isAuthenticated]);

  // search the catalog while a playlist is open
  useEffect(() => {
    if (!openId || findQ.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      try { setFound(await catalogApi.songs({ q: findQ.trim(), limit: 8 })); } catch { setFound([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [findQ, openId]);

  const create = async () => {
    const n = name.trim();
    if (!n || creating) return;
    setCreating(true);
    setError('');
    try {
      const { playlist_id } = await playlistsApi.create(n, description.trim() || undefined);
      setName('');
      setDescription('');
      addToast({ type: 'success', title: 'Playlist created', message: n });
      await load();
      setOpenId(playlist_id); // open it right away so songs can be added
      setSongsById((prev) => ({ ...prev, [playlist_id]: [] }));
    } catch (e: any) {
      setError(`Could not create the playlist: ${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  const loadSongs = async (id: string) => {
    try {
      const pl = await playlistsApi.get(id);
      setSongsById((prev) => ({ ...prev, [id]: pl.songs || [] }));
    } catch (e: any) {
      setError(`Could not open the playlist: ${e.message}`);
    }
  };

  const toggle = async (id: string) => {
    setFindQ('');
    setFound([]);
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    await loadSongs(id);
  };

  const addSong = async (playlistId: string, song: any) => {
    setError('');
    try {
      await playlistsApi.addSong(playlistId, song.song_id);
      await Promise.all([loadSongs(playlistId), load()]);
    } catch (e: any) {
      setError(`Could not add "${song.title}": ${e.message}`);
    }
  };

  const removeSong = async (playlistId: string, songId: string) => {
    try {
      await playlistsApi.removeSong(playlistId, songId);
      await Promise.all([loadSongs(playlistId), load()]);
    } catch (e: any) {
      setError(`Could not remove the song: ${e.message}`);
    }
  };

  const removePlaylist = async (id: string) => {
    if (!window.confirm('Delete this playlist?')) return;
    try {
      await playlistsApi.remove(id);
      if (openId === id) setOpenId(null);
      await load();
    } catch (e: any) {
      setError(`Could not delete the playlist: ${e.message}`);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-white">Sign in to see playlists</h2>
      </div>
    );
  }

  const input = 'bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-teal-400';

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6 pb-28">
      <div className="flex items-center gap-2">
        <ListMusic className="w-5 h-5 text-teal-400" />
        <h1 className="text-2xl font-bold text-white">Your Playlists</h1>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Playlist name" maxLength={100} className={`${input} sm:w-64`} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Description (optional)" maxLength={200} className={`${input} flex-1`} />
        <button onClick={create} disabled={creating || !name.trim()} className="px-4 py-2 rounded-lg bg-teal-500 text-zinc-950 text-sm font-semibold hover:bg-teal-400 disabled:opacity-60">
          {creating ? 'Creating…' : 'Create playlist'}
        </button>
      </div>

      {error && <p className="text-sm text-red-300 break-words">{error}</p>}

      {loading && playlists.length === 0 ? (
        <p className="text-zinc-400 text-sm">Loading…</p>
      ) : playlists.length === 0 ? (
        <p className="text-zinc-500 text-sm">No playlists yet. Name one above, then add songs here or from the Browse page.</p>
      ) : (
        <div className="grid gap-3">
          {playlists.map((p) => {
            const open = openId === p.playlist_id;
            const songs = songsById[p.playlist_id] || [];
            const inList = new Set(songs.map((s) => s.song_id));
            return (
              <div key={p.playlist_id} className="rounded-xl border border-zinc-800 bg-zinc-900/40">
                <div className="p-4 flex justify-between items-center gap-3">
                  <button onClick={() => toggle(p.playlist_id)} className="flex-1 text-left min-w-0">
                    <h3 className="font-semibold text-white truncate">{p.name}</h3>
                    <p className="text-xs text-zinc-400 truncate">
                      {p.song_count ?? 0} songs{p.description ? ` · ${p.description}` : ''}
                    </p>
                  </button>
                  <button onClick={() => toggle(p.playlist_id)} aria-label={open ? 'Collapse' : 'Expand'} className="text-zinc-400 hover:text-zinc-100">
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button onClick={() => removePlaylist(p.playlist_id)} aria-label="Delete playlist" className="text-zinc-500 hover:text-red-300">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {open && (
                  <div className="border-t border-zinc-800">
                    {songs.length === 0 ? (
                      <p className="p-4 text-xs text-zinc-500">This playlist is empty. Search below to add songs.</p>
                    ) : (
                      <div className="divide-y divide-zinc-800/70">
                        {songs.map((s) => (
                          <div key={s.song_id} className="px-4 py-2.5 flex items-center gap-3">
                            <button onClick={() => playSong(s, 'playlist', null)} aria-label={`Play ${s.title}`} className="text-teal-400 hover:text-teal-300">
                              <Play className="w-4 h-4" />
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white truncate">{s.title}</p>
                              <p className="text-xs text-zinc-400 truncate">{s.artist}</p>
                            </div>
                            <button onClick={() => removeSong(p.playlist_id, s.song_id)} aria-label="Remove from playlist" className="text-zinc-500 hover:text-red-300">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="p-4 border-t border-zinc-800 space-y-2">
                      <div className="relative">
                        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Search a song or singer to add" className={`${input} w-full pl-9`} />
                      </div>
                      {found.map((s) => (
                        <div key={s.song_id} className="flex items-center gap-3 text-sm">
                          <div className="flex-1 min-w-0">
                            <p className="text-zinc-100 truncate">{s.title}</p>
                            <p className="text-xs text-zinc-500 truncate">{s.artist}</p>
                          </div>
                          {inList.has(s.song_id) ? (
                            <span className="text-xs text-zinc-500">Added</span>
                          ) : (
                            <button onClick={() => addSong(p.playlist_id, s)} aria-label={`Add ${s.title}`} className="p-1 rounded-md bg-teal-500 text-zinc-950 hover:bg-teal-400">
                              <Plus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};