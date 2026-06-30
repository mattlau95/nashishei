import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Viewer from './pages/Viewer'
import AuthPage from './pages/AuthPage'
import { api } from './lib/api'

// Lazy: both pull in onnxruntime-web (Home via mlBrowser.ts, ArcFaceSpike via its own
// arcfaceSpike.ts). A static import here would fetch that whole chain on every route,
// including the unauthenticated login screen — see MAT-531.
const Home = lazy(() => import('./pages/Home'))
const ArcFaceSpike = lazy(() => import('./pages/ArcFaceSpike'))

function AuthGate() {
  const [authed, setAuthed] = useState(() => localStorage.getItem('authed') === '1')
  const [checking, setChecking] = useState(() => localStorage.getItem('authed') === '1')

  useEffect(() => {
    if (!checking) return
    api('/api/images', { credentials: 'include' })
      .then((r) => {
        if (r.status === 401) {
          localStorage.removeItem('authed')
          setAuthed(false)
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    function handle() {
      localStorage.removeItem('authed')
      setAuthed(false)
    }
    window.addEventListener('session-expired', handle)
    return () => window.removeEventListener('session-expired', handle)
  }, [])

  function logout() {
    api('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    localStorage.removeItem('authed')
    setAuthed(false)
  }

  if (checking) return null

  if (!authed) return <AuthPage onAuthed={() => setAuthed(true)} />
  return (
    <Suspense fallback={null}>
      <Home onLogout={logout} />
    </Suspense>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthGate />} />
      <Route path="/s/:token" element={<Viewer />} />
      <Route path="/spike" element={<Suspense fallback={null}><ArcFaceSpike /></Suspense>} />
    </Routes>
  )
}
