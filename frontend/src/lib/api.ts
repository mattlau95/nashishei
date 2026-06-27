const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

// In dev (BASE empty) the path is fetched as-is and Vite proxy handles it.
// In prod (BASE set) the /api prefix is a dev-proxy artifact and is stripped so
// the request goes directly to the cloud backend.
export function api(path: string, init?: RequestInit): Promise<Response> {
  const url = BASE ? `${BASE}${path.replace(/^\/api/, '')}` : path
  return fetch(url, init)
}
