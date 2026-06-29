const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export function api(path: string, init?: RequestInit): Promise<Response> {
  const url = BASE ? `${BASE}${path.replace(/^\/api/, '')}` : path
  return fetch(url, init).then((res) => {
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('session-expired'))
    }
    return res
  })
}
