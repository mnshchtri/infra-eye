import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, AlertCircle, User, Lock, CheckCircle2, ShieldCheck } from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useThemeSync } from '../hooks/useThemeSync'
import logo from '../assets/logo.png'

const FEATURES = [
  'No agents — SSH and kubeconfig are all it takes',
  'Live terminals, log streaming, and per-node metrics',
  'Self-healing rules that act before you open a ticket',
]

export function Login() {
  useThemeSync()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.post('/api/auth/login', { username, password })
      setAuth(res.data.token, res.data.user)
      setSignedIn(true)
      setTimeout(() => navigate('/'), 700)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid credentials. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      {/* Brand panel */}
      <div className="login-panel-brand">
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={logo} alt="InfraEye" style={{ height: 38, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>InfraEye</span>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <span style={{
            display: 'inline-block', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.85)',
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)',
            padding: '5px 12px', marginBottom: 20, borderRadius: 'var(--radius-sm)',
          }}>
            Agentless Infrastructure Platform
          </span>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 14px', lineHeight: 1.25 }}>
            See everything running. Install nothing new.
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, margin: '0 0 36px', maxWidth: 440, fontWeight: 400 }}>
            SSH into Linux servers, kubeconfig into Kubernetes clusters — live metrics, log streaming, and remote terminals from a single console.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {FEATURES.map(label => (
              <div className="login-feature" key={label}>
                <div className="login-feature-icon">
                  <CheckCircle2 size={15} />
                </div>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 400, lineHeight: 1.5, paddingTop: 6 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.55)' }}>
          <ShieldCheck size={14} />
          <span style={{ fontSize: 13, fontWeight: 400 }}>
            JWT sessions, OIDC/SSO, and role-based access — built in from day one
          </span>
        </div>
      </div>

      {/* Form panel */}
      <div className="login-panel-form">
        <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="login-card fade-up">
            {signedIn ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '24px 0' }}>
                <div className="login-success-icon">
                  <CheckCircle2 size={26} />
                </div>
                <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '20px 0 4px' }}>
                  Signed in
                </h1>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                  Taking you to the console…
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
                  <img src={logo} alt="InfraEye" style={{ height: 32, objectFit: 'contain' }} />
                  <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>InfraEye</span>
                </div>

                <div style={{ marginBottom: 28 }}>
                  <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
                    Sign in
                  </h1>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                    Enter your credentials to access the console
                  </p>
                </div>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div className="input-group">
                    <label className="input-label" htmlFor="login-username">Username</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <User size={15} style={{ position: 'absolute', left: 12, color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input
                        id="login-username"
                        className="input"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="Enter your username"
                        required
                        autoFocus
                        autoComplete="username"
                        style={{ paddingLeft: 38 }}
                      />
                    </div>
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="login-password">Password</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <Lock size={15} style={{ position: 'absolute', left: 12, color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input
                        id="login-password"
                        className="input"
                        type={showPw ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                        autoComplete="current-password"
                        style={{ paddingLeft: 38, paddingRight: 40 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        aria-label={showPw ? 'Hide password' : 'Show password'}
                        className="login-pw-toggle"
                      >
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="login-error">
                      <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                    </div>
                  )}

                  <button
                    id="login-submit"
                    type="submit"
                    disabled={loading}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '13px', fontSize: 14, marginTop: 8, fontWeight: 700 }}
                  >
                    {loading ? (
                      <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Signing in…</>
                    ) : (
                      'Sign in'
                    )}
                  </button>
                </form>

                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <ShieldCheck size={14} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5 }}>Encrypted sessions with full audit logging</span>
                </div>
              </>
            )}
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>© {new Date().getFullYear()} InfraEye. All rights reserved.</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <a
              href="https://infraeye.manishkarki7.com.np"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              Documentation
            </a>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
