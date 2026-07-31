import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Boxes,
  Bot, Bell, Settings, LogOut, ChevronRight,
  ChevronLeft, Menu, Code2, Sun, Moon, ChevronDown, Shield, Database, X,
  ShieldAlert, Lock, Network, KeyRound, GitBranch
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
      { to: '/resources',  icon: Database,        label: 'Resources',   action: 'manage-resources' },
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
    label: 'Audit',
    items: [
      { to: '/audit/kernel',    icon: ShieldAlert, label: 'Kernel Scanner',    action: 'view-audit' },
      { to: '/audit/hardening', icon: Lock,        label: 'Server Hardening', action: 'view-audit' },
      { to: '/audit/cluster',   icon: Network,     label: 'Cluster Security', action: 'view-audit' },
      { to: '/audit/resources', icon: KeyRound,    label: 'Resource Security', action: 'view-audit' },
    ]
  },
  {
    label: 'Engineering',
    items: [
      { to: '/devtools',   icon: Code2,           label: 'Developer Hub', action: 'manage-users' },
      { to: '/iac-sync',   icon: GitBranch,       label: 'IaC Sync',      action: 'manage-gitsync' },
      { to: '/settings',   icon: Settings,        label: 'System Settings' },
    ]
  },
]

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar, darkMode, toggleDarkMode, mobileNavOpen, toggleMobileNav } = useUIStore()
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
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img
            src={logo}
            alt="L"
            style={{ height: 32, width: 'auto', objectFit: 'contain', filter: darkMode ? 'brightness(0) invert(1)' : 'none' }}
          />
          {!sidebarCollapsed && <span className="sidebar-logo-text">InfraEye</span>}
        </div>

        {!sidebarCollapsed && (
          <button className="sidebar-toggle-btn" onClick={toggleSidebar} title="Collapse Sidebar">
            <ChevronLeft size={14} />
          </button>
        )}
        {mobileNavOpen && (
          <button className="sidebar-close-btn" onClick={toggleMobileNav} title="Close menu">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Nav Groups */}
      <nav className="sidebar-nav">
        {sidebarCollapsed && (
          <button
            className="sidebar-toggle-btn sidebar-toggle-btn-collapsed"
            onClick={toggleSidebar}
            title="Expand Sidebar"
          >
            <Menu size={18} />
          </button>
        )}

        {navGroups.map(group => {
          const visibleItems = group.items.filter(item => !item.action || can(item.action))
          if (visibleItems.length === 0) return null

          return (
          <div key={group.label} className="sidebar-nav-group">
            {!sidebarCollapsed && (
              <div className="sidebar-nav-group-label">{group.label}</div>
            )}
            {visibleItems.map(({ to, icon: Icon, label }) => (
              <Fragment key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  title={sidebarCollapsed ? label : undefined}
                >
                  <div className="sidebar-link-icon">
                    <Icon size={16} strokeWidth={2.5} />
                  </div>
                  {!sidebarCollapsed && <span className="sidebar-link-text">{label}</span>}
                 {label === 'Servers' && !sidebarCollapsed && (
                  <div
                    className="sidebar-nested-toggle"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setServersExpanded(!serversExpanded); }}
                  >
                    {serversExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </div>
                 )}
                 {label !== 'Servers' && !sidebarCollapsed && <ChevronRight size={12} className="sidebar-link-arrow" />}
                </NavLink>

                {/* Nested list for Servers (Scrollable) */}
                {label === 'Servers' && !sidebarCollapsed && serversExpanded && servers.length > 0 && (
                  <div className="sidebar-sublist">
                    {servers.map(s => (
                      <NavLink
                        key={s.id}
                        to={`/servers/${s.id}`}
                        className={({ isActive }) => `nav-sublink ${isActive ? 'active' : ''}`}
                      >
                        <span className={`nav-sublink-dot ${s.status === 'online' ? 'online' : ''}`} />
                        <span className="nav-sublink-name">{s.name}</span>
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
      <div className="sidebar-footer">
        <div className="sidebar-theme-row">
          {!sidebarCollapsed && <span className="sidebar-theme-label">System Theme</span>}
          <button
            className="sidebar-toggle-btn"
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? <Sun size={13} color="var(--warning)" /> : <Moon size={13} color="var(--brand-primary)" />}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="sidebar-version">v{__APP_VERSION__}</div>
        )}

        <div className="sidebar-user">
          <div className="sidebar-user-avatar" title={sidebarCollapsed ? user?.username : undefined}>
            {user?.username?.[0]?.toUpperCase() ?? 'A'}
          </div>
          {!sidebarCollapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user?.username ?? 'Admin'}</span>
              <span className="sidebar-user-role">{user?.role ?? 'operator'}</span>
            </div>
          )}
          <button className="sidebar-logout" onClick={handleLogout} title="Sign out">
            <LogOut size={sidebarCollapsed ? 14 : 12} />
          </button>
        </div>
      </div>

    </aside>
  )
}
