import { invoke } from '@tauri-apps/api/core'

const VITE_ML_BASE = (import.meta.env.VITE_ML_BASE ?? '').replace(/\/$/, '')

let _base: string | null = null

async function getMlBase(): Promise<string> {
  if (_base !== null) return _base
  if (VITE_ML_BASE) {
    _base = VITE_ML_BASE
    return _base
  }
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
