import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: number
  username: string
  role: string
  email: string
}

interface AuthStore {
  token: string | null
  user: User | null
  setAuth: (token: string, user: User) => void
  logout: () => void
  isAuthenticated: () => boolean
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
    }),
    { name: 'auth-store' }
  )
)
