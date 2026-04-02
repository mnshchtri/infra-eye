import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Boxes,
  Bot, Bell, Settings, LogOut, ChevronRight,
  ChevronLeft, Menu, Code2, Sun, Moon
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useUIStore } from '../../store/uiStore'
import { usePermission, type PermissionAction } from '../../hooks/usePermission'
import logo from '../../assets/logo.png'
import { KubernetesIcon } from '../OSIcons'
import { api } from '../../api/client'
import { useState, useEffect, Fragment } from 'react'

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
      { to: '/kubernetes', icon: KubernetesIcon,  label: 'Kubernetes',  action: 'use-kubectl' },
      { to: '/alerts',     icon: Bell,            label: 'Alert Rules', action: 'view-alerts' },
    ]
  },
  {
    label: 'Operations',
    items: [
      { to: '/ai',         icon: Bot,             label: 'AI Assistant', action: 'use-ai' },
    ]
  },
  {
    label: 'Engineering',
    items: [
      { to: '/devtools',   icon: Code2,           label: 'Developer Hub', action: 'manage-users' },
      { to: '/settings',   icon: Settings,        label: 'System Settings' },
    ]
  },
]

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar, darkMode, toggleDarkMode } = useUIStore()
  const { can } = usePermission()
  const navigate = useNavigate()

  const [servers, setServers] = useState<any[]>([])
  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data)).catch(() => {})
  }, [])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Header / Logo */}
      <div className="sidebar-header" style={{ justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <img src={logo} alt="L" />
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
              <Fragment key={to}>
                <NavLink
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
                
                {/* Nested list for Servers */}
                {label === 'Servers' && !sidebarCollapsed && servers.length > 0 && (
                  <div style={{ paddingLeft: 44, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '1px solid var(--border)', margin: '4px 0 8px 18px' }}>
                    {servers.slice(0, 8).map(s => (
                      <NavLink 
                        key={s.id} 
                        to={`/servers/${s.id}`} 
                        className="nav-sublink" 
                        style={({ isActive }) => ({
                          fontSize: 12, 
                          color: isActive ? 'var(--brand-primary)' : 'var(--text-muted)', 
                          textDecoration: 'none', 
                          padding: '6px 0',
                          fontWeight: isActive ? 700 : 500,
                          transition: 'all 0.2s'
                        })}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 4, height: 4, borderRadius: '50%', background: s.status === 'online' ? 'var(--success)' : 'var(--text-muted)' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        </div>
                      </NavLink>
                    ))}
                    {servers.length > 8 && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 4px 4px 12px', opacity: 0.7, fontWeight: 700 }}>
                        + {servers.length - 8} more
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )
      })}
      </nav>


      {/* Theme Toggle & User Footer */}
      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 4px' }}>
          {!sidebarCollapsed && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Theme</span>}
          <button 
            className="btn-icon" 
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-app)', border: '1px solid var(--border)' }}
          >
            {darkMode ? <Sun size={14} color="#fcd34d" /> : <Moon size={14} color="var(--brand-primary)" />}
          </button>
        </div>

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
