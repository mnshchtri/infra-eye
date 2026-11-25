import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, User, Lock, CheckCircle2, ShieldCheck } from 'lucide-react'
import {
  Alert, Box, Card, IconButton, InputAdornment, Link, TextField, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Button } from '../components/ui'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useThemeSync } from '../hooks/useThemeSync'
import { useUIStore } from '../store/uiStore'
import logo from '../assets/logo.png'
import { apiError } from '../utils/errors'

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
  const theme = useTheme()
  const showBrand = useMediaQuery(theme.breakpoints.up('md'))
  const { darkMode } = useUIStore()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.post('/api/auth/login', { username, password })
      setAuth(res.data.token, res.data.user)
      setSignedIn(true)
      setTimeout(() => navigate('/'), 700)
    } catch (err: unknown) {
      setError(apiError(err) || 'Invalid credentials. Please try again.')
      setLoading(false)
    }
  }

  const onBrand = 'rgba(255,255,255,0.85)'
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
      {/* Brand panel */}
      {showBrand && (
        <Box sx={{
          flex: '1 1 55%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between', p: 8, color: '#fff',
          background: 'linear-gradient(135deg, #004080 0%, #0066cc 100%)',
          '&::before': {
            content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.16) 1px, transparent 0)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(ellipse 90% 70% at 30% 30%, #000 0%, transparent 75%)',
          },
        }}>
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <img src={logo} alt="" style={{ height: 38, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 800, color: '#fff' }}>InfraEye</Typography>
          </Box>

          <Box sx={{ position: 'relative' }}>
            <Box component="span" sx={{
              display: 'inline-block', px: 1.5, py: 0.5, mb: 2.5, borderRadius: 1, fontSize: 12, fontWeight: 700,
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.12em', color: onBrand,
              bgcolor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)',
            }}>
              Agentless Infrastructure Platform
            </Box>
            <Typography variant="h1" sx={{ fontSize: 32, fontWeight: 800, lineHeight: 1.25, mb: 1.75, color: '#fff' }}>
              One login for every server and cluster you manage.
            </Typography>
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, mb: 4.5, maxWidth: 440 }}>
              Point it at an SSH key or a kubeconfig and it's connected — metrics, logs, and terminals show up without installing anything on the other end.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {FEATURES.map(label => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.75 }}>
                  <Box sx={{ width: 28, height: 28, borderRadius: 1, display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: 'rgba(255,255,255,0.12)' }}>
                    <CheckCircle2 size={15} />
                  </Box>
                  <Typography sx={{ fontSize: 13, color: onBrand, lineHeight: 1.5, pt: 0.75 }}>{label}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1, color: 'rgba(255,255,255,0.55)' }}>
            <ShieldCheck size={14} />
            <Typography sx={{ fontSize: 13, color: 'inherit' }}>JWT sessions, OIDC/SSO, and role-based access control</Typography>
          </Box>
        </Box>
      )}

      {/* Form panel */}
      <Box sx={{ flex: '1 1 45%', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3, py: 5 }}>
        <Box sx={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Card sx={{ width: '100%', p: { xs: 3, sm: 5 }, boxShadow: 3 }}>
            {signedIn ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', py: 3 }} role="status">
                <Box sx={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'success.main', color: '#fff' }}>
                  <CheckCircle2 size={26} />
                </Box>
                <Typography variant="h5" component="h1" sx={{ mt: 2.5, mb: 0.5 }}>Signed in</Typography>
                <Typography variant="body1" color="text.secondary">Taking you to the console…</Typography>
              </Box>
            ) : (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 3.5 }}>
                  <img src={logo} alt="" style={{ height: 32, objectFit: 'contain', filter: darkMode ? 'brightness(0) invert(1)' : 'none' }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>InfraEye</Typography>
                </Box>

                <Box sx={{ mb: 3.5 }}>
                  <Typography variant="h3" component="h1" sx={{ fontSize: 22, mb: 0.75 }}>Sign in</Typography>
                  <Typography variant="body1" color="text.secondary">Enter your credentials to access the console</Typography>
                </Box>

                <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label="Username" fullWidth required autoFocus autoComplete="username"
                    value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your username"
                    slotProps={{
                      input: { startAdornment: <InputAdornment position="start"><User size={15} /></InputAdornment> },
                    }}
                    id="login-username"
                  />
                  <TextField
                    label="Password" fullWidth required autoComplete="current-password"
                    type={showPw ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password"
                    slotProps={{
                      input: {
                        startAdornment: <InputAdornment position="start"><Lock size={15} /></InputAdornment>,
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} edge="end">
                              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                    id="login-password"
                  />

                  {error && (
                    <Alert severity="error" icon={<AlertCircle size={16} />} role="alert">{error}</Alert>
                  )}

                  <Button type="submit" size="lg" loading={loading} id="login-submit" style={{ width: '100%', marginTop: 4 }}>
                    {loading ? 'Signing in…' : 'Sign in'}
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3, pt: 2.5, borderTop: 1, borderColor: 'divider', color: 'text.secondary' }}>
                  <ShieldCheck size={14} style={{ flexShrink: 0 }} />
                  <Typography variant="body2">JWT-based sessions that expire after 24 hours</Typography>
                </Box>
              </>
            )}
          </Card>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
            <span>© {new Date().getFullYear()} InfraEye. All rights reserved.</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <Link href="https://infraeye.manishkarki7.com.np" target="_blank" rel="noopener noreferrer" color="inherit" underline="always">
              Documentation
            </Link>
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
