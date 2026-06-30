import { useState } from 'react'
import { api } from '../lib/api'

type Props = { onAuthed: () => void }

const srOnly: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

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
      const res = await api(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const text = await res.text()
        console.error(`${mode} failed:`, text)
        setError(
          mode === 'login'
            ? 'Could not sign in — check your email and password.'
            : 'Could not create account — try again.',
        )
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
    <main
      style={{
        minHeight: '100svh',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-5)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-lg)',
          padding: '36px 32px',
          boxShadow: '0 2px 20px rgba(0,0,0,0.08)',
        }}
      >
        <h1 style={{ fontSize: 'var(--text-title)', marginBottom: 4 }}>nàshìshéi</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 28 }}>
          那是谁 — Who Is That?
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label htmlFor="email" style={srOnly}>Email</label>
          <input
            id="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <label htmlFor="password" style={srOnly}>Password</label>
          <input
            id="password"
            type="password"
            placeholder={mode === 'register' ? 'Password (8+ chars)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', margin: 0 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '14px',
              width: '100%',
              background: loading ? 'rgba(0,122,255,0.5)' : 'var(--color-blue)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              fontWeight: 600,
              fontSize: 'var(--text-base)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
          {mode === 'login' ? (
            <>No account?{' '}
              <button
                onClick={() => { setMode('register'); setError(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--color-blue)', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontWeight: 600 }}
              >
                Register
              </button>
            </>
          ) : (
            <>Have an account?{' '}
              <button
                onClick={() => { setMode('login'); setError(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--color-blue)', cursor: 'pointer', padding: 0, fontSize: 'inherit', fontWeight: 600 }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  )
}
