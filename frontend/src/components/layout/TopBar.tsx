import { useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar, Avatar, Box, Breadcrumbs, Divider, IconButton, Link, ListItemIcon,
  Menu, MenuItem, Toolbar, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { LogOut, Menu as MenuIcon, Moon, Sun } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useUIStore } from '../../store/uiStore'
import { APPBAR_HEIGHT } from '../../theme/theme'
import { navGroups } from './navConfig'

// Static route labels come from the nav table so breadcrumbs and the sidebar
// can't drift apart. Dynamic segments (numeric ids) fall back to "#<id>".
const labelByPath = new Map<string, string>(
  navGroups.flatMap(g => g.items.map(i => [i.to, i.label] as [string, string])),
)
const extraLabels: Record<string, string> = {
  '/audit': 'Audit',
  '/networking': 'Networking',
}

function crumbsFor(pathname: string): { to: string; label: string }[] {
  const parts = pathname.split('/').filter(Boolean)
  const crumbs: { to: string; label: string }[] = []
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    const label =
      labelByPath.get(acc) ??
      extraLabels[acc] ??
      (/^\d+$/.test(part) ? `#${part}` : part.charAt(0).toUpperCase() + part.slice(1))
    crumbs.push({ to: acc, label })
  }
  return crumbs
}

export function TopBar() {
  const theme = useTheme()
  const isDesktopWidth = useMediaQuery(theme.breakpoints.up('md'))
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { darkMode, toggleDarkMode, toggleMobileNav } = useUIStore()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const crumbs = crumbsFor(pathname)

  function handleLogout() {
    setAnchor(null)
    logout()
    navigate('/login')
  }

  return (
    <AppBar
      position="static"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}
    >
      <Toolbar variant="dense" disableGutters sx={{ minHeight: APPBAR_HEIGHT, px: 2, gap: 1 }}>
        {!isDesktopWidth && (
          <IconButton edge="start" onClick={toggleMobileNav} aria-label="Open menu"><MenuIcon size={18} /></IconButton>
        )}

        <Breadcrumbs aria-label="Breadcrumb" sx={{ flex: 1, minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}>
          <Link component={RouterLink} to="/" underline="hover" color="text.secondary" variant="body1">Home</Link>
          {crumbs.map((c, i) =>
            i === crumbs.length - 1 ? (
              <Typography key={c.to} variant="body1" color="text.primary" sx={{ fontWeight: 600 }} noWrap>{c.label}</Typography>
            ) : (
              <Link key={c.to} component={RouterLink} to={c.to} underline="hover" color="text.secondary" variant="body1">
                {c.label}
              </Link>
            ),
          )}
        </Breadcrumbs>

        <Tooltip title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
          <IconButton onClick={toggleDarkMode} aria-label="Toggle colour theme">
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
        </Tooltip>

        <Tooltip title={user?.username ?? 'Account'}>
          <IconButton onClick={e => setAnchor(e.currentTarget)} aria-label="Account menu" sx={{ p: 0.5 }}>
            <Avatar sx={{ width: 26, height: 26, fontSize: 13, bgcolor: 'primary.main' }}>
              {user?.username?.[0]?.toUpperCase() ?? 'A'}
            </Avatar>
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle2">{user?.username ?? 'Admin'}</Typography>
            <Typography variant="caption" color="text.secondary">{user?.role ?? 'operator'}</Typography>
          </Box>
          <Divider />
          <MenuItem onClick={handleLogout}>
            <ListItemIcon><LogOut size={14} /></ListItemIcon>
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  )
}
