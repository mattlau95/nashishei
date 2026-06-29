import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Viewer from './pages/Viewer'
import AuthPage from './pages/AuthPage'
import { api } from './lib/api'

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
  return <Home onLogout={logout} />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthGate />} />
      <Route path="/s/:token" element={<Viewer />} />
    </Routes>
  )
}
