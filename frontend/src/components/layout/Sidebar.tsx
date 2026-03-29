import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, ScrollText, Terminal, Boxes,
  Bot, Bell, Settings, LogOut, Zap, ChevronRight,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const navItems = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/servers',    icon: Server,          label: 'Servers' },
  { to: '/logs',       icon: ScrollText,      label: 'Logs' },
  { to: '/terminal',   icon: Terminal,        label: 'Terminal' },
  { to: '/kubectl',    icon: Boxes,           label: 'Kubectl' },
  { to: '/ai',         icon: Bot,             label: 'AI Assistant' },
  { to: '/alerts',     icon: Bell,            label: 'Alert Rules' },
  { to: '/settings',   icon: Settings,        label: 'Settings' },
]

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Zap size={18} />
        </div>
        <span className="sidebar-logo-text">InfraEye</span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <Icon size={16} />
            <span>{label}</span>
            <ChevronRight size={13} className="sidebar-link-arrow" />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.username?.[0]?.toUpperCase() ?? 'A'}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user?.username}</span>
            <span className="sidebar-user-role">{user?.role}</span>
          </div>
        </div>
        <button className="sidebar-logout" onClick={handleLogout} title="Logout">
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  )
}
