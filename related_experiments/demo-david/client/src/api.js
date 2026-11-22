const BASE = '/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status });
  }
  return res.json();
}

export const api = {
  get:    (path)       => apiFetch(path),
  post:   (path, body) => apiFetch(path, { method: 'POST',   body }),
  put:    (path, body) => apiFetch(path, { method: 'PUT',    body }),
  delete: (path)       => apiFetch(path, { method: 'DELETE' }),
  upload: (path, form) => fetch(`${BASE}${path}`, { credentials: 'include', method: 'POST', body: form })
    .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
};
