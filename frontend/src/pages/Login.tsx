import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, AlertCircle, User, Lock, CheckCircle2, ShieldCheck } from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import logo from '../assets/logo.png'

const FEATURES = [
  'SSH-based server monitoring — no agents to deploy or maintain',
  'Native Kubernetes cluster management via kubeconfig',
  'Automated self-healing with full audit history',
]

export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showWelcome, setShowWelcome] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.post('/api/auth/login', { username, password })
      setAuth(res.data.token, res.data.user)
      setShowWelcome(true)
      setTimeout(() => navigate('/'), 6500)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid credentials. Please try again.')
      setLoading(false)
    }
  }

  if (showWelcome) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <img
          src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExYXhzNjlsbzNodHRrcDdqdXFkd3JxYXRwamkyZTEwajhzb2F1a3k1aCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/jTMxfXzAohYnkiTZlg/giphy.gif"
          alt="Welcome"
          style={{ width: '100vw', height: '100vh', objectFit: 'cover' }}
        />
      </div>
    )
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
            padding: '5px 12px', marginBottom: 20
          }}>
            Enterprise Observability Platform
          </span>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 14px', lineHeight: 1.25 }}>
            Infrastructure observability, without the agents.
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, margin: '0 0 36px', maxWidth: 440, fontWeight: 400 }}>
            Monitor Linux servers and Kubernetes clusters, stream logs, and automate remediation from a single console.
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
            JWT-secured sessions, OIDC/SSO, and role-based access control
          </span>
        </div>
      </div>

      {/* Form panel */}
      <div className="login-panel-form">
        <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="login-card fade-up">
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
                  padding: '12px 14px', marginBottom: 22, borderRadius: 0,
                  background: 'var(--danger-glow)', border: '1px solid var(--danger)',
                  color: 'var(--danger)', fontSize: 13.5, display: 'flex', alignItems: 'flex-start', gap: 9,
                  fontWeight: 500
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                </div>
              )}

              <button
                id="login-submit"
                type="submit"
                disabled={loading}
                className="btn btn-primary"
                style={{ width: '100%', padding: '13px', fontSize: 14, marginTop: 8, borderRadius: 0, fontWeight: 700 }}
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
              <span style={{ fontSize: 12.5 }}>Protected by JWT authentication and role-based access control</span>
            </div>
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
