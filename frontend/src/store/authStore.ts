import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: number
  username: string
  role: string
  email: string
  // Returned by PUT /api/auth/me (the profile response), not by login — so a
  // freshly logged-in user has these undefined until they save Settings.
  open_router_key?: string
  deep_seek_key?: string
  claude_key?: string
  gemini_key?: string
  mistral_key?: string
  local_llm_url?: string
  local_llm_model?: string
}

interface AuthStore {
  token: string | null
  user: User | null
  setAuth: (token: string, user: User) => void
  logout: () => void
  isAuthenticated: () => boolean
  hasRole: (roles: string[]) => boolean
  isAdmin: () => boolean
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        localStorage.setItem('token', token)
        set({ token, user })
      },
      logout: () => {
        localStorage.removeItem('token')
        set({ token: null, user: null })
      },
      isAuthenticated: () => !!get().token,
      hasRole: (roles: string[]) => {
        const user = get().user
        return user ? roles.includes(user.role) : false
      },
      isAdmin: () => {
        return get().user?.role === 'admin'
      }
    }),
    { name: 'auth-store' }
  )
)
