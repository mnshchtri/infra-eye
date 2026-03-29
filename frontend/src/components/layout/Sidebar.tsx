import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Terminal, Boxes,
  Bot, Bell, Settings, LogOut, ChevronRight,
  ChevronLeft, Menu
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useUIStore } from '../../store/uiStore'
import { usePermission, type PermissionAction } from '../../hooks/usePermission'
import logo from '../../assets/logo.png'

type NavItem = {
  to: string
  icon: any
  label: string
  action?: PermissionAction
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/servers',    icon: Server,          label: 'Servers' },
    ]
  },
  {
    label: 'Infrastructure',
    items: [
      { to: '/kubernetes', icon: Boxes,           label: 'Kubernetes',  action: 'use-kubectl' },
      { to: '/alerts',     icon: Bell,            label: 'Alert Rules', action: 'view-alerts' },
    ]
  },
  {
    label: 'Operations',
    items: [
      { to: '/terminal',   icon: Terminal,        label: 'Terminal',    action: 'use-terminal' },
      { to: '/ai',         icon: Bot,             label: 'AI Assistant', action: 'use-ai' },
    ]
  },
  {
    label: 'System',
    items: [
      { to: '/settings',   icon: Settings,        label: 'Settings' },
      { to: '/devtools',   icon: Terminal,        label: 'Dev Tools',   action: 'manage-users' },
    ]
  },
]

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { can } = usePermission()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Header / Logo */}
      <div className="sidebar-header" style={{ justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon" style={{ width: 24, height: 24 }}>
            <img src={logo} alt="L" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          {!sidebarCollapsed && <span className="sidebar-logo-text">InfraEye</span>}
        </div>
        
        {/* Toggle Button - Now always in header for consistency */}
        {!sidebarCollapsed && (
          <button 
            className="sidebar-toggle-btn" 
            onClick={toggleSidebar}
            title="Collapse Sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Nav Groups */}
      <nav className="sidebar-nav">
        {sidebarCollapsed && (
             <button 
             className="sidebar-toggle-btn" 
             onClick={toggleSidebar}
             title="Expand Sidebar"
             style={{ margin: '0 auto 32px' }}
           >
             <Menu size={18} />
           </button>
        )}

        {navGroups.map(group => {
          const visibleItems = group.items.filter(item => !item.action || can(item.action))
          if (visibleItems.length === 0) return null
          
          return (
          <div key={group.label} className="nav-group-container" style={{ marginBottom: 28 }}>
            {!sidebarCollapsed && (
              <div className="nav-group-label" style={{
                fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.12em',
                padding: '0 12px', marginBottom: 12,
              }}>
                {group.label}
              </div>
            )}
            {group.items.filter(item => !item.action || can(item.action)).map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                title={sidebarCollapsed ? label : undefined}
              >
                <div className="sidebar-link-icon">
                  <Icon size={20} strokeWidth={sidebarCollapsed ? 2 : 1.75} />
                </div>
                {!sidebarCollapsed && <span style={{ flex: 1 }}>{label}</span>}
                {!sidebarCollapsed && <ChevronRight size={13} className="sidebar-link-arrow" />}
              </NavLink>
            ))}
          </div>
        )
      })}
      </nav>


      {/* User Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar" title={sidebarCollapsed ? user?.username : undefined}>
            {user?.username?.[0]?.toUpperCase() ?? 'A'}
          </div>
          {!sidebarCollapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user?.username ?? 'Admin'}</span>
              <span className="sidebar-user-role">{user?.role ?? 'admin'}</span>
            </div>
          )}
          {!sidebarCollapsed && (
            <button className="sidebar-logout" onClick={handleLogout} title="Sign out">
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>

    </aside>
  )
}
