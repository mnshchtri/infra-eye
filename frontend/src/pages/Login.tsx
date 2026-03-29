import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Eye, EyeOff, Loader2 } from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'

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
      setError(err.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card fade-in">
        <div className="login-logo">
          <div className="login-logo-icon"><Zap size={22} /></div>
          <span>InfraEye</span>
        </div>
        <p className="login-subtitle">Unified DevOps Observability Platform</p>

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className="input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="input-icon-wrap">
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button type="button" className="input-icon-btn" onClick={() => setShowPw(!showPw)}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button className="btn btn-primary login-btn" type="submit" disabled={loading}>
            {loading ? <><Loader2 size={15} className="spin-icon" /> Signing in...</> : 'Sign In'}
          </button>
        </form>

        <p className="login-hint">Default: <code>admin</code> / <code>infra123</code></p>
      </div>
    </div>
  )
}
