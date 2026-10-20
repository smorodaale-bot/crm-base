import { trackRequest } from './loadingBridge.js';

const memory = { token: null };

export function getToken() {
  return memory.token;
}

export function setToken(token) {
  memory.token = token;
}

export function clearToken() {
  memory.token = null;
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;

  if (!isForm && !headers['Content-Type'] && options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const { overlay, progress, ...fetchOpts } = options;
  const method = String(options.method || 'GET').toUpperCase();
  const mutating = method !== 'GET' && method !== 'HEAD';
  const silent = path.startsWith('/auth/refresh') || path.startsWith('/notifications');
  const showOverlay = overlay === true;
  const showBar = showOverlay || progress === true || (progress !== false && mutating && !silent);
  const endTrack = showBar ? trackRequest({ overlay: showOverlay }) : null;

  try {
    let res = await fetch(`/api${path}`, {
      ...fetchOpts,
      headers,
      credentials: 'include',
    });

    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
      const refreshed = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (refreshed.ok) {
        const data = await refreshed.json();
        setToken(data.accessToken || data.token);
        headers.Authorization = `Bearer ${getToken()}`;
        res = await fetch(`/api${path}`, {
          ...fetchOpts,
          headers,
          credentials: 'include',
        });
      }
    }

    if (options.raw) return res;

    const data = await parseResponse(res);
    if (!res.ok) {
      const error = new Error(data?.error || `Request failed (${res.status})`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  } finally {
    endTrack?.();
  }
}

export async function downloadCsv(path, filename = 'export.csv') {
  const res = await api(path, { raw: true });
  if (!res.ok) {
    const data = await parseResponse(res);
    throw new Error(data?.error || 'Export failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
