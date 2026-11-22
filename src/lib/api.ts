const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getToken(): string | null {
  return localStorage.getItem('moodtide_token');
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem('moodtide_token', token);
  else localStorage.removeItem('moodtide_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (username: string, email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),
  me: () => request<any>('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }).finally(() => setToken(null)),
};

export const catalogApi = {
  genres: () => request<any[]>('/genres'),
  artists: () => request<any[]>('/artists'),
  songs: (params?: { q?: string; genre?: string | null; artist?: string | null; sort?: string; limit?: number; offset?: number ;region?: string | null}) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.genre) qs.set('genre', params.genre);
    if (params?.artist) qs.set('artist', params.artist);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.region && params.region !== 'all') qs.set('region', params.region);
    return request<any[]>(`/songs?${qs}`);
  },
};
export const prefsApi = {
  get: () => request<{ region: string }>('/preferences'),
  setRegion: (region: string) => request<{ region: string }>('/preferences', { method: 'PUT', body: JSON.stringify({ region }) }),
};
export const moodApi = {
  current: () => request<any | null>('/mood/current'),
  detect: () => request<any>('/mood/detect', { method: 'POST' }),
  checkins: () => request<any[]>('/mood/checkins'),
  createCheckin: (mood: string, energy: number) =>
    request<any>('/checkins', {
      method: 'POST',
      body: JSON.stringify({ mood, energy }),
    }),
};

export const suggestionsApi = {
  list: () => request<{ batch: any; suggestions: any[] }>('/suggestions'),
  generate: () =>
    request<{ batch_id: string }>('/suggestions/generate', { method: 'POST' }),
};

export const activityApi = {
  recordPlay: (payload: {
    songId: string;
    listenedSec?: number;
    completed?: boolean;
    source?: string;
    suggestionId?: string | null;
  }) =>
    request('/plays', { method: 'POST', body: JSON.stringify(payload) }),
  rate: (songId: string, stars: number, suggestionId?: string | null) =>
    request('/ratings', {
      method: 'POST',
      body: JSON.stringify({ songId, stars, suggestionId }),
    }),
  ratings: () => request<any[]>('/ratings'),
  history: () => request<any[]>('/history'),
};

export const playlistsApi = {
  list: () => request<any[]>('/playlists'),
  get: (id: string) => request<any>(`/playlists/${id}`),
  create: (name: string, description?: string) =>
    request<{ playlist_id: string }>('/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  createJourney: (from: string, to: string) =>
    request<{ playlist_id: string }>('/playlists/journey', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),
  addSong: (playlistId: string, songId: string) =>
    request(`/playlists/${playlistId}/songs`, {
      method: 'POST',
      body: JSON.stringify({ songId }),
    }),
  removeSong: (playlistId: string, songId: string) =>
    request(`/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' }),
  remove: (id: string) => request(`/playlists/${id}`, { method: 'DELETE' }),
};