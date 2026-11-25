import { NavLink } from 'react-router-dom'
import { ChevronRight, ChevronLeft, Menu, ChevronDown, Download } from 'lucide-react'
import {
  Box, Button, Collapse, Divider, Drawer, IconButton, List, ListItemButton,
  ListItemIcon, ListItemText, ListSubheader, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { navGroups } from './navConfig'
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from '../../theme/theme'
import { useUIStore } from '../../store/uiStore'
import { useToastStore } from '../../store/toastStore'
import { usePermission } from '../../hooks/usePermission'
import logo from '../../assets/logo.png'
import { api } from '../../api/client'
import { Modal, ModalBody, ModalFooter, Button as LegacyButton } from '../ui'
import { useState, useEffect, Fragment } from 'react'
import { errMessage } from '../../utils/errors'

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, darkMode, mobileNavOpen, setMobileNavOpen } = useUIStore()
  const { can } = usePermission()
  const toast = useToastStore()

  const [servers, setServers] = useState<{ id: number; name: string; is_k8s?: boolean; status?: string }[]>([])
  const [serversExpanded, setServersExpanded] = useState(true)
  useEffect(() => {
    api.get('/api/servers')
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.data && Array.isArray(res.data.data) ? res.data.data : []);
        setServers(list);
      })
      .catch(() => setServers([]))
  }, [])

  // Desktop-only: the server/Docker deployment has no concept of
  // self-updating its own running binary — that's what redeploys are for.
  // The button stays visible even when already on the latest version (no
  // update available yet doesn't mean never — a click always re-checks
  // GitHub for whatever the current latest release is, rather than relying
  // on a version fetched once at page load).
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloadUrl: string } | null>(null)
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'updating'>('idle')
  const [confirmUpdateOpen, setConfirmUpdateOpen] = useState(false)

  useEffect(() => {
    if (!__IS_DESKTOP__) return
    checkForUpdate(false)
  }, [])

  async function checkForUpdate(manual: boolean) {
    setUpdateState('checking')
    try {
      const res = await api.get('/api/desktop/update/check')
      if (res.data?.available && res.data.download_url) {
        setUpdateInfo({ version: res.data.latest_version, downloadUrl: res.data.download_url })
      } else {
        setUpdateInfo(null)
        if (manual) toast.success('Up to date', `You're already on the latest version (v${__APP_VERSION__}).`)
      }
    } catch (e: unknown) {
      if (manual) toast.error('Update check failed', errMessage(e))
    } finally {
      setUpdateState('idle')
    }
  }

  function handleUpdateClick() {
    if (updateState !== 'idle') return
    if (!updateInfo) {
      checkForUpdate(true)
      return
    }
    // Wails' embedded webview doesn't reliably surface window.confirm() as a
    // visible dialog (it can silently resolve without ever rendering), which
    // made this button look like it did nothing when clicked. Use the app's
    // own Modal instead so confirmation always works, in the desktop app and
    // in a regular browser alike.
    setConfirmUpdateOpen(true)
  }

  async function runUpdate() {
    if (!updateInfo) return
    setConfirmUpdateOpen(false)
    setUpdateState('updating')
    try {
      const res = await api.post('/api/desktop/update/apply', { download_url: updateInfo.downloadUrl })
      if (res.data?.success) {
        toast.info('Updating…', 'InfraEye will restart shortly.')
      } else {
        toast.error('Update failed', res.data?.error || 'Unknown error')
        setUpdateState('idle')
      }
    } catch (e: unknown) {
      toast.error('Update failed', errMessage(e))
      setUpdateState('idle')
    }
  }

  const theme = useTheme()
  const isDesktopWidth = useMediaQuery(theme.breakpoints.up('md'))
  // On narrow screens the drawer is always full-width labelled; "collapsed"
  // (icon rail) only applies to the permanent desktop drawer.
  const collapsed = isDesktopWidth && sidebarCollapsed
  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH

  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: collapsed ? 1.5 : 2, height: 48, flexShrink: 0 }}>
        <img
          src={logo}
          alt="InfraEye"
          style={{ height: 28, width: 'auto', objectFit: 'contain', filter: darkMode ? 'brightness(0) invert(1)' : 'none' }}
        />
        {!collapsed && (
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 700, letterSpacing: '-0.01em' }}>InfraEye</Typography>
        )}
        {isDesktopWidth && !collapsed && (
          <Tooltip title="Collapse sidebar">
            <IconButton onClick={toggleSidebar} aria-label="Collapse sidebar"><ChevronLeft size={16} /></IconButton>
          </Tooltip>
        )}
      </Box>
      <Divider />

      <Box component="nav" aria-label="Primary" sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 0.5 }}>
        {collapsed && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.5 }}>
            <Tooltip title="Expand sidebar" placement="right">
              <IconButton onClick={toggleSidebar} aria-label="Expand sidebar"><Menu size={18} /></IconButton>
            </Tooltip>
          </Box>
        )}

        {navGroups.map(group => {
          const visibleItems = group.items.filter(item => !item.action || can(item.action))
          if (visibleItems.length === 0) return null
          return (
            <List
              key={group.label}
              dense
              disablePadding
              subheader={
                collapsed ? <Divider sx={{ my: 0.5 }} /> : (
                  <ListSubheader disableSticky sx={{
                    bgcolor: 'transparent', lineHeight: '28px', mt: 0.5, fontSize: '0.6875rem',
                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {group.label}
                  </ListSubheader>
                )
              }
            >
              {visibleItems.map(({ to, icon: Icon, label }) => {
                const isServers = label === 'Servers'
                const showSub = isServers && !collapsed && servers.length > 0
                return (
                  <Fragment key={to}>
                    <Tooltip title={collapsed ? label : ''} placement="right">
                      <ListItemButton
                        component={NavLink}
                        to={to}
                        end={to === '/'}
                        sx={{
                          mx: 1, my: 0.25, borderRadius: 1, minHeight: 34, px: 1.25,
                          justifyContent: collapsed ? 'center' : 'flex-start',
                          '&.active': {
                            bgcolor: 'action.selected', color: 'primary.main',
                            '& .MuiListItemIcon-root': { color: 'primary.main' },
                          },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: collapsed ? 0 : 30, color: 'text.secondary' }}>
                          <Icon size={16} />
                        </ListItemIcon>
                        {!collapsed && (
                          <ListItemText primary={label} slotProps={{ primary: { variant: 'body1', sx: { fontWeight: 500 } } }} />
                        )}
                        {showSub && (
                          <IconButton
                            aria-label={serversExpanded ? 'Collapse servers' : 'Expand servers'}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setServersExpanded(!serversExpanded) }}
                          >
                            {serversExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </IconButton>
                        )}
                      </ListItemButton>
                    </Tooltip>
                    {showSub && (
                      <Collapse in={serversExpanded} unmountOnExit>
                        <List dense disablePadding sx={{ maxHeight: 240, overflowY: 'auto' }}>
                          {servers.map(s => (
                            <ListItemButton
                              key={s.id}
                              component={NavLink}
                              to={`/servers/${s.id}`}
                              sx={{
                                mx: 1, ml: 4.5, borderRadius: 1, minHeight: 28, py: 0,
                                '&.active': { bgcolor: 'action.selected', color: 'primary.main' },
                              }}
                            >
                              <Box
                                aria-label={s.status === 'online' ? 'online' : 'offline'}
                                sx={{
                                  width: 7, height: 7, borderRadius: '50%', mr: 1, flexShrink: 0,
                                  bgcolor: s.status === 'online' ? 'success.main' : 'text.disabled',
                                }}
                              />
                              <ListItemText primary={s.name} slotProps={{ primary: { variant: 'body2', noWrap: true } }} />
                            </ListItemButton>
                          ))}
                        </List>
                      </Collapse>
                    )}
                  </Fragment>
                )
              })}
            </List>
          )
        })}
      </Box>

      <Divider />
      <Box sx={{ p: 1, flexShrink: 0 }}>
        {!collapsed && (
          __IS_DESKTOP__ ? (
            <Button
              fullWidth
              size="small"
              variant={updateInfo ? 'contained' : 'outlined'}
              color={updateInfo ? 'success' : 'inherit'}
              startIcon={<Download size={13} />}
              onClick={handleUpdateClick}
              disabled={updateState !== 'idle'}
              title={updateInfo ? `Update available: v${updateInfo.version}` : `Running v${__APP_VERSION__} — click to check for updates`}
            >
              {updateState === 'checking' ? 'Checking…'
                : updateState === 'updating' ? 'Updating…'
                : updateInfo ? `Update to v${updateInfo.version}`
                : 'Check for Updates'}
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
              v{__APP_VERSION__}
            </Typography>
          )
        )}
      </Box>

      {updateInfo && (
        <Modal
          isOpen={confirmUpdateOpen}
          onClose={() => setConfirmUpdateOpen(false)}
          title="Update InfraEye"
          size="sm"
          footer={
            <ModalFooter>
              <LegacyButton variant="ghost" onClick={() => setConfirmUpdateOpen(false)}>Cancel</LegacyButton>
              <LegacyButton variant="primary" onClick={runUpdate}>Update & Restart</LegacyButton>
            </ModalFooter>
          }
        >
          <ModalBody>
            Update InfraEye to v{updateInfo.version}? The app will close and reopen automatically.
          </ModalBody>
        </Modal>
      )}
    </Box>
  )

  return isDesktopWidth ? (
    <Drawer
      variant="permanent"
      sx={{
        width, flexShrink: 0, transition: theme.transitions.create('width', { duration: 150 }),
        '& .MuiDrawer-paper': {
          width, boxSizing: 'border-box', overflowX: 'hidden',
          transition: theme.transitions.create('width', { duration: 150 }),
        },
      }}
    >
      {content}
    </Drawer>
  ) : (
    <Drawer
      variant="temporary"
      open={mobileNavOpen}
      onClose={() => setMobileNavOpen(false)}
      ModalProps={{ keepMounted: true }}
      sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' } }}
    >
      {content}
    </Drawer>
  )
}
