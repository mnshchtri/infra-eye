import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Boxes,
  Bot, Bell, Settings, LogOut, ChevronRight,
  ChevronLeft, Menu, Code2, Sun, Moon, ChevronDown, Shield
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
      { to: '/vpn',        icon: Shield,          label: 'VPN Tunnel' },
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
  const { sidebarCollapsed, toggleSidebar, darkMode, toggleDarkMode, mobileNavOpen } = useUIStore()
  const { can } = usePermission()
  const navigate = useNavigate()

  const [servers, setServers] = useState<any[]>([])
  const [serversExpanded, setServersExpanded] = useState(true)
  useEffect(() => {
    api.get('/api/servers')
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.data && Array.isArray(res.data.data) ? res.data.data : []);
        setServers(list);
      })
      .catch(() => setServers([]))
  }, [])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileNavOpen ? 'mobile-open' : ''}`}>
      {/* Header / Logo */}
      <div className="sidebar-header" style={{ 
        height: 60, 
        padding: sidebarCollapsed ? '0 12px' : '0 16px', 
        display: 'flex', 
        alignItems: 'center', 
        borderBottom: '1px solid var(--border)', 
        background: 'var(--bg-sidebar)',
        flexShrink: 0
      }}>
        <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={logo} alt="L" style={{ height: 32, width: 'auto', objectFit: 'contain', filter: darkMode ? 'brightness(0) invert(1)' : 'none' }} />
          {!sidebarCollapsed && (
            <span className="sidebar-logo-text" style={{ 
              fontSize: 15, fontWeight: 900, color: 'var(--text-primary)', 
              letterSpacing: '-0.02em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' 
            }}>
              InfraEye
            </span>
          )}
        </div>
        
        {!sidebarCollapsed && (
          <button 
            className="sidebar-toggle-btn" 
            onClick={toggleSidebar}
            title="Collapse Sidebar"
            style={{ opacity: 0.5 }}
          >
            <ChevronLeft size={14} />
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
                fontSize: 10, fontWeight: 900, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.15em',
                padding: '0 14px', marginBottom: 12,
                fontFamily: 'var(--font-mono)'
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
                  style={{ borderRadius: 0, padding: '10px 14px', margin: '0 8px' }}
                >
                  <div className="sidebar-link-icon">
                    <Icon size={16} strokeWidth={2.5} />
                  </div>
                  {!sidebarCollapsed && <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>}
                 {label === 'Servers' && !sidebarCollapsed && (
                  <div 
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setServersExpanded(!serversExpanded); }} 
                    style={{ padding: '4px', cursor: 'pointer', display: 'flex', color: 'var(--text-muted)' }}
                  >
                    {serversExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </div>
                 )}
                 {label !== 'Servers' && !sidebarCollapsed && <ChevronRight size={10} className="sidebar-link-arrow" style={{ opacity: 0.3 }} />}
                </NavLink>
                
                {/* Nested list for Servers (Scrollable) */}
                {label === 'Servers' && !sidebarCollapsed && serversExpanded && servers.length > 0 && (
                  <div style={{ 
                    paddingLeft: 44, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2, 
                    borderLeft: '1px solid var(--border)', margin: '4px 0 8px 18px',
                    maxHeight: '320px', overflowY: 'auto'
                  }}>
                    {servers.map(s => (
                      <NavLink 
                        key={s.id} 
                        to={`/servers/${s.id}`} 
                        className="nav-sublink" 
                        style={({ isActive }) => ({
                          fontSize: 11, 
                          fontFamily: 'var(--font-mono)',
                          color: isActive ? 'var(--brand-primary)' : 'var(--text-secondary)', 
                          textDecoration: 'none', 
                          padding: '8px 0',
                          fontWeight: isActive ? 800 : 500,
                          textTransform: 'uppercase',
                          transition: 'all 0.2s',
                          flexShrink: 0
                        })}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 3, height: 3, background: s.status === 'online' ? '#22c55e' : '#52525b' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        </div>
                      </NavLink>
                    ))}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )
      })}
      </nav>


      {/* Theme Toggle & User Footer */}
      <div className="sidebar-footer" style={{ padding: '20px 16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 8px' }}>
          {!sidebarCollapsed && <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>System Theme</span>}
          <button 
            className="btn-icon" 
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{ width: 28, height: 28, borderRadius: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            {darkMode ? <Sun size={12} color="var(--warning)" /> : <Moon size={12} color="var(--brand-primary)" />}
          </button>
        </div>

        <div className="sidebar-user" style={{ background: 'var(--bg-elevated)40', padding: '12px', border: '1px solid var(--border)40', gap: 10 }}>
          <div className="sidebar-user-avatar" title={sidebarCollapsed ? user?.username : undefined} style={{ width: 28, height: 28, fontSize: 11, borderRadius: 0, background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
            {user?.username?.[0]?.toUpperCase() ?? 'A'}
          </div>
          {!sidebarCollapsed && (
            <div className="sidebar-user-info" style={{ gap: 1 }}>
              <span className="sidebar-user-name" style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-primary)' }}>{user?.username ?? 'Admin'}</span>
              <span className="sidebar-user-role" style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800 }}>{user?.role ?? 'operator'}</span>
            </div>
          )}
          {!sidebarCollapsed && (
            <button className="sidebar-logout" onClick={handleLogout} title="Sign out" style={{ marginLeft: 'auto', opacity: 0.5 }}>
              <LogOut size={12} />
            </button>
          )}
        </div>
      </div>

    </aside>
  )
}
