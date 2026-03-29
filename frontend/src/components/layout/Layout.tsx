import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useUIStore } from '../../store/uiStore'

export function Layout() {
  const { sidebarCollapsed } = useUIStore()

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
