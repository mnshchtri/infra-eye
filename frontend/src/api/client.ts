import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080'

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

export const WS_BASE = API_BASE.replace('http', 'ws')

export function buildWsUrl(path: string): string {
  const token = localStorage.getItem('token') ?? ''
  const sep = path.includes('?') ? '&' : '?'
  return `${WS_BASE}${path}${sep}token=${encodeURIComponent(token)}`
}
