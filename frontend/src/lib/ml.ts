import { invoke } from '@tauri-apps/api/core'

let _base: string | null = null

// Returns the ML sidecar base URL.
// In a Tauri build the Rust command provides it; in browser-only dev we fall back
// to the same fixed address the sidecar binds to.
async function getMlBase(): Promise<string> {
  if (_base) return _base
  try {
    _base = await invoke<string>('ml_base_url')
  } catch {
    _base = 'http://127.0.0.1:8001'
  }
  return _base
}

export function mlApi(path: string, init?: RequestInit): Promise<Response> {
  return getMlBase().then((base) => fetch(`${base}${path}`, init))
}
