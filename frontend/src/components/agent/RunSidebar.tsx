import { memo, useState, useEffect, useCallback } from 'react'
import { Box, ButtonBase, IconButton, Button as MuiButton, Tooltip, Typography } from '@mui/material'
import { Modal, Button } from '../ui'
import { X, ChevronLeft, ChevronRight, Plus, Workflow, Trash2 } from 'lucide-react'

export interface AgentRunSummary {
  id: number
  goal: string
  status: 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
  created_at: string
}

interface RunSidebarProps {
  runs: AgentRunSummary[]
  activeRunId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => void
  isCollapsed: boolean
  onToggle: (v: boolean) => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (isNaN(diff) || diff < 0) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

const STATUS_COLOR: Record<AgentRunSummary['status'], string> = {
  running: 'primary.main',
  awaiting_approval: 'warning.main',
  completed: 'success.main',
  failed: 'error.main',
  cancelled: 'text.disabled',
}

const STATUS_LABEL: Record<AgentRunSummary['status'], string> = {
  running: 'Running',
  awaiting_approval: 'Needs approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export const RunSidebar = memo(({
  runs, activeRunId, onSelect, onNew, onDelete, isCollapsed, onToggle,
}: RunSidebarProps) => {
  const [width, setWidth] = useState(280)
  const [isResizing, setIsResizing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => setIsResizing(false), [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX
      if (newWidth > 180 && newWidth < 600) setWidth(newWidth)
    }
  }, [isResizing])

  useEffect(() => {
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  const sidebarWidth = isCollapsed ? 64 : width

  return (
    <Box
      component="aside"
      aria-label="Agent runs"
      sx={(t) => ({
        width: sidebarWidth,
        borderRight: 1, borderColor: 'divider',
        bgcolor: 'background.paper', display: 'flex', flexDirection: 'column',
        flexShrink: 0, transition: isResizing ? 'none' : 'width 0.2s ease',
        overflow: 'hidden', position: 'relative', zIndex: 2,
        [t.breakpoints.down('md')]: {
          position: 'fixed', top: 0, bottom: 0, left: isCollapsed ? '-100%' : 0,
          width: 280, zIndex: t.zIndex.drawer + 1, transition: 'left 0.25s ease',
          boxShadow: isCollapsed ? 'none' : t.shadows[8],
        },
      })}
    >
      {!isCollapsed && (
        <Tooltip title="Close runs">
          <IconButton
            aria-label="Close runs"
            onClick={() => onToggle(true)}
            sx={{ display: { xs: 'inline-flex', md: 'none' }, position: 'absolute', right: 8, top: 8, zIndex: 10 }}
          >
            <X size={16} />
          </IconButton>
        </Tooltip>
      )}
      {!isCollapsed && (
        <Box
          onMouseDown={startResizing}
          sx={(t) => ({
            display: { xs: 'none', md: 'block' },
            position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', zIndex: 10,
            bgcolor: isResizing ? 'primary.main' : 'transparent', transition: 'background-color 0.2s',
            '&:hover': { bgcolor: isResizing ? 'primary.main' : t.palette.divider },
          })}
        />
      )}

      <Box sx={{ p: '14px 12px 10px', display: 'flex', flexDirection: 'column', gap: 1.25, alignItems: isCollapsed ? 'center' : 'stretch' }}>
        <Box sx={{ display: 'flex', justifyContent: isCollapsed ? 'center' : 'space-between', alignItems: 'center', gap: 1 }}>
          {!isCollapsed ? (
            <>
              <MuiButton variant="contained" startIcon={<Plus size={15} />} onClick={onNew} sx={{ flex: 1, height: 34 }}>
                New agent run
              </MuiButton>
              <Tooltip title="Collapse sidebar">
                <IconButton aria-label="Collapse sidebar" onClick={() => onToggle(true)} sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
                  <ChevronLeft size={16} />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <Tooltip title="New agent run" placement="right">
              <IconButton aria-label="New agent run" onClick={onNew} sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 1, '&:hover': { bgcolor: 'primary.dark' } }}>
                <Plus size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {isCollapsed && (
          <Tooltip title="Expand sidebar" placement="right">
            <IconButton aria-label="Expand sidebar" onClick={() => onToggle(false)}>
              <ChevronRight size={16} />
            </IconButton>
          </Tooltip>
        )}

        {!isCollapsed && runs.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, fontWeight: 600 }}>Runs</Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: isCollapsed ? 1 : 1.25, pb: 2.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {!isCollapsed && runs.length === 0 && (
          <Box sx={{ py: 3, px: 1.5, textAlign: 'center', color: 'text.secondary' }}>
            <Workflow size={22} style={{ opacity: 0.4, marginBottom: 8 }} />
            <Typography variant="body2">No agent runs yet — describe a goal to start one.</Typography>
          </Box>
        )}
        {runs.map(r => {
          const active = activeRunId === r.id
          return (
            <Box
              key={r.id}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: 0.5,
                borderRadius: 1, overflow: 'hidden', position: 'relative',
                bgcolor: active ? 'action.selected' : 'transparent',
                boxShadow: active ? (th) => `inset 2px 0 0 ${th.palette.primary.main}` : 'none',
                '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
              }}
            >
              <ButtonBase
                onClick={() => onSelect(r.id)}
                aria-label={isCollapsed ? r.goal : undefined}
                aria-current={active ? 'true' : undefined}
                title={isCollapsed ? r.goal : undefined}
                sx={{
                  flex: 1, minWidth: 0, textAlign: 'left', justifyContent: isCollapsed ? 'center' : 'flex-start',
                  py: isCollapsed ? 1.5 : 1, pl: isCollapsed ? 0 : 1.5, pr: 0.5, display: 'flex',
                }}
              >
                {!isCollapsed ? (
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap variant="body1" sx={{ fontWeight: active ? 600 : 500, color: active ? 'text.primary' : 'text.secondary' }}>
                      {r.goal}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STATUS_COLOR[r.status], flexShrink: 0 }} />
                      <Typography variant="caption" sx={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{STATUS_LABEL[r.status]}</Typography>
                      <Typography variant="caption" color="text.secondary">· {timeAgo(r.created_at)}</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATUS_COLOR[r.status] }} />
                )}
              </ButtonBase>
              {!isCollapsed && (
                <Tooltip title="Delete run">
                  <IconButton
                    aria-label={`Delete run ${r.goal}`}
                    onClick={() => setConfirmDelete(r.id)}
                    sx={{ flexShrink: 0, mr: 0.5, '&:hover': { color: 'error.main' } }}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        })}
      </Box>

      <Modal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete run"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { if (confirmDelete !== null) onDelete(confirmDelete); setConfirmDelete(null) }}>Delete</Button>
          </>
        }
      >
        <Typography variant="body1" color="text.secondary">
          Delete <b>{runs.find(r => r.id === confirmDelete)?.goal ?? 'this run'}</b>? Its steps and history will be removed.
        </Typography>
      </Modal>
    </Box>
  )
})

RunSidebar.displayName = 'RunSidebar'
