import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { useUIStore } from '../../store/uiStore'
import { ToastContainer } from '../Toast'
import { useToastStore } from '../../store/toastStore'
import { buildWsUrl } from '../../api/client'
import { useAuthStore } from '../../store/authStore'

/** Connects to the global alerts WebSocket room and fires toasts when rules trigger */
function useAlertNotifications() {
  const wsRef = useRef<WebSocket | null>(null)
  const toast = useToastStore()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated()) return

    const connect = () => {
      const ws = new WebSocket(buildWsUrl('/ws/alerts'))
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'alert_fired') {
            const p = msg.payload
            const severity = p.severity || 'warning'
            const toastType = severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info'
            toast.add({
              type: toastType,
              title: `🔔 Alert: ${p.rule_name}`,
              message: `${p.server_name} — ${p.trigger_info}`,
              duration: 10000,
            })
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = () => {
        // Reconnect after 5s if still authenticated
        setTimeout(() => {
          if (useAuthStore.getState().isAuthenticated()) connect()
        }, 5000)
      }
    }

    connect()
    return () => wsRef.current?.close()
  }, [])
}

export function Layout() {
  const { sidebarCollapsed, darkMode, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const location = useLocation()
  useAlertNotifications()
  
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  // Close mobile nav when location changes
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location, setMobileNavOpen])

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div 
        className={`sidebar-overlay ${mobileNavOpen ? 'mobile-open' : ''}`} 
        onClick={() => setMobileNavOpen(false)}
      />
      
      <Sidebar />
      <main className="app-main">
        <MobileNav />
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  )
}
