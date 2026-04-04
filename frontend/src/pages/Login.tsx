import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Shield } from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import logo from '../assets/logo.png'

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.post('/api/auth/login', { username, password })
      setAuth(res.data.token, res.data.user)
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card fade-up" style={{ zIndex: 10 }}>
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40, gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <img src={logo} alt="InfraEye" style={{ height: 60, objectFit: 'contain' }} />
            <span style={{
              fontSize: 11,
              fontWeight: 900,
              color: 'var(--brand-primary)',
              background: 'var(--brand-glow)',
              padding: '6px 16px',
              borderRadius: 0,
              border: '1px solid var(--brand-primary)20',
              letterSpacing: '0.15em',
              marginTop: 8,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase'
            }}>
              InfraEye
            </span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '-0.04em', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              Authentication
            </h1>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Secure terminal access
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div className="input-group">
            <label className="input-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.1em' }}>Username</label>
            <input
              id="login-username"
              className="input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="operator"
              required
              autoFocus
              autoComplete="username"
              style={{ borderRadius: 0 }}
            />
          </div>

          <div className="input-group">
            <label className="input-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.1em' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                className="input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{ paddingRight: 30, borderRadius: 0 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                  transition: 'color 0.2s', padding: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              padding: '12px 16px', marginBottom: 24, borderRadius: 0,
              background: 'transparent', border: '1px solid #ef4444',
              color: '#ef4444', fontSize: 11, display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 700
            }}>
              <Shield size={14} /> {error}
            </div>
          )}

          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px', fontSize: 12, marginTop: 12, borderRadius: 0, fontWeight: 900 }}
          >
            {loading ? (
              <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> INITIALIZING...</>
            ) : (
              'ESTABLISH SESSION'
            )}
          </button>
        </form>


      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
