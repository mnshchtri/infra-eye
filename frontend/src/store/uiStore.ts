import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIStore {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  darkMode: boolean
  toggleDarkMode: () => void
  setDarkMode: (v: boolean) => void
  mobileNavOpen: boolean
  toggleMobileNav: () => void
  setMobileNavOpen: (v: boolean) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      darkMode: false,
      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
      setDarkMode: (v) => set({ darkMode: v }),
      mobileNavOpen: false,
      toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
      setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
    }),
    {
      name: 'infraeye-ui-storage',
      // Only persist certain parts of the UI state
      partialize: (state) => ({ 
        sidebarCollapsed: state.sidebarCollapsed, 
        darkMode: state.darkMode 
      }),
    }
  )
)
