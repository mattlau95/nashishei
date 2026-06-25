import { useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import Viewer from './pages/Viewer'
import AuthPage from './pages/AuthPage'

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => localStorage.getItem('authed') === '1')
  const location = useLocation()

  if (!authed && location.pathname === '/') {
    return <AuthPage onAuthed={() => setAuthed(true)} />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthGate><Home /></AuthGate>} />
      <Route path="/s/:token" element={<Viewer />} />
    </Routes>
  )
}
