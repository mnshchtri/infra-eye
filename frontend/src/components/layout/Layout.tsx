import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Box } from '@mui/material'
import { useUIStore } from '../../store/uiStore'
import { ToastContainer } from '../Toast'
import { useToastStore } from '../../store/toastStore'
import { buildWsUrl } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { useThemeSync } from '../../hooks/useThemeSync'

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
  const { setMobileNavOpen } = useUIStore()
  const location = useLocation()
  useAlertNotifications()
  useThemeSync()

  // Close mobile nav when location changes
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location, setMobileNavOpen])

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Sidebar />
      {/* .app-main keeps the legacy flex/overflow contract that .page relies on */}
      <main className="app-main">
        <TopBar />
        <Outlet />
      </main>
      <ToastContainer />
    </Box>
  )
}
