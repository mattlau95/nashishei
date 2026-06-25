import { useState } from 'react'

type Props = { onAuthed: () => void }

export default function AuthPage({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const text = await res.text()
        setError(text.trim() || `${mode} failed`)
        return
      }
      localStorage.setItem('authed', '1')
      onAuthed()
    } catch {
      setError('Network error — is the API running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 'var(--space-5)' }}>
      <h1 style={{ marginBottom: 'var(--space-1)' }}>nàshìshéi</h1>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-5)', fontSize: 'var(--text-sm)' }}>
        那是谁 — Who Is That?
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <input
          type="password"
          placeholder={mode === 'register' ? 'Password (8+ chars)' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', margin: 0 }}>{error}</p>
        )}
        <button type="submit" disabled={loading} style={{ padding: '0.6rem', fontWeight: 600 }}>
          {loading ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
        {mode === 'login' ? (
          <>No account? <button onClick={() => { setMode('register'); setError(null) }} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>Register</button></>
        ) : (
          <>Have an account? <button onClick={() => { setMode('login'); setError(null) }} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}>Sign in</button></>
        )}
      </p>
    </main>
  )
}
