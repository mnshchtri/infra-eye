import { useEffect } from 'react'
import { useUIStore } from '../store/uiStore'

// Mirrors the persisted darkMode preference onto <html class="dark">. Must be
// called by every top-level route (authenticated Layout and the standalone
// Login page) — routes outside Layout don't inherit this automatically.
export function useThemeSync() {
  const darkMode = useUIStore(state => state.darkMode)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])
}
