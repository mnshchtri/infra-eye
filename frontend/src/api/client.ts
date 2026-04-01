import axios from 'axios'

// If VITE_API_URL isn't set, default to same-origin relative calls (/api, /ws).
// This is required for "one container" deployments where the backend is reverse-proxied.
const API_BASE = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL : ''

export const api = axios.create({
  baseURL: API_BASE,
})

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401, redirect to login
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export const WS_BASE = API_BASE ? API_BASE.replace('http', 'ws') : ''

export function buildWsUrl(path: string): string {
  const token = localStorage.getItem('token') ?? ''
  const sep = path.includes('?') ? '&' : '?'
  const fallbackBase =
    window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`
  const base = WS_BASE || fallbackBase
  return `${base}${path}${sep}token=${encodeURIComponent(token)}`
}
