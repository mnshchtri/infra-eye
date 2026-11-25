import { useState, useEffect, useCallback } from 'react'
import {
  Menu, Workflow, Server, Hash, Clock, StopCircle, Cpu,
} from 'lucide-react'
import { Box, IconButton, Button as MuiButton, Tooltip, Typography, alpha } from '@mui/material'
import { api, buildWsUrl } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { Badge } from '../components/ui'
import { RunSidebar, type AgentRunSummary } from '../components/agent/RunSidebar'
import { AgentFlowCanvas } from '../components/agent/AgentFlowCanvas'
import { StepInspector } from '../components/agent/StepInspector'
import { LauncherFlowCanvas } from '../components/agent/LauncherFlowCanvas'
import type { AgentProvider } from '../components/agent/LauncherFlowNodes'
import type { ServerData, AgentRun } from './agentTypes'
import { errMessage } from '../utils/errors'

const STATUS_BADGE: Record<AgentRun['status'], { label: string; variant: 'primary' | 'warning' | 'success' | 'danger' | 'neutral' }> = {
  running: { label: 'Running', variant: 'primary' },
  awaiting_approval: { label: 'Needs your approval', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
}

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  local: 'Local LLM',
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (isNaN(diff) || diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}

export function Agent() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [selectedServer, setSelectedServer] = useState<number | ''>('')
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [goal, setGoal] = useState('')
  const [provider, setProvider] = useState<AgentProvider>('claude')
  const [starting, setStarting] = useState(false)
  const [busyStepId, setBusyStepId] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null)

  const toast = useToastStore()

  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data)).catch(() => {})
  }, [])

  const fetchRuns = useCallback(async () => {
    try {
      const res = await api.get('/api/agent/runs')
      setRuns(res.data)
    } catch (err) {
      console.error('Failed to fetch agent runs', err)
    }
  }, [])

  useEffect(() => { fetchRuns() }, [fetchRuns])

  const fetchActiveRun = useCallback(async (id: number) => {
    try {
      const res = await api.get(`/api/agent/runs/${id}`)
      setActiveRun(res.data)
    } catch (err) {
      console.error('Failed to fetch agent run', err)
    }
  }, [])

  useEffect(() => {
    if (activeRunId == null) {
      setActiveRun(null)
      setSelectedStepId(null)
      return
    }
    fetchActiveRun(activeRunId)
  }, [activeRunId, fetchActiveRun])

  useEffect(() => {
    if (activeRunId == null) return
    const socket = new WebSocket(buildWsUrl(`/ws/agent/runs/${activeRunId}`))
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (['step_created', 'step_updated', 'run_completed', 'run_failed', 'run_cancelled'].includes(msg.type)) {
          fetchActiveRun(activeRunId)
          fetchRuns()
        }
      } catch (err) {
        console.error('WS agent parse error', err)
      }
    }
    return () => socket.close()
  }, [activeRunId, fetchActiveRun, fetchRuns])

  // Auto-focus the newest pending step so the inspector opens itself as the run progresses.
  useEffect(() => {
    if (!activeRun) return
    const pending = activeRun.steps?.find(s => s.status === 'pending_approval')
    if (pending) setSelectedStepId(pending.id)
  }, [activeRun])

  const startRun = useCallback(async () => {
    if (!goal.trim() || !selectedServer || starting) return
    setStarting(true)
    try {
      const res = await api.post('/api/agent/runs', { goal: goal.trim(), server_id: Number(selectedServer), provider })
      setGoal('')
      setActiveRunId(res.data.id)
      setActiveRun(res.data)
      fetchRuns()
    } catch (err: unknown) {
      toast.error('Could not start agent run', errMessage(err))
    } finally {
      setStarting(false)
    }
  }, [goal, selectedServer, provider, starting, fetchRuns, toast])

  const approveStep = useCallback(async (stepId: number) => {
    if (!activeRunId) return
    setBusyStepId(stepId)
    try {
      const res = await api.post(`/api/agent/runs/${activeRunId}/steps/${stepId}/approve`)
      setActiveRun(res.data)
      fetchRuns()
    } catch (err: unknown) {
      toast.error('Could not approve step', errMessage(err))
    } finally {
      setBusyStepId(null)
    }
  }, [activeRunId, fetchRuns, toast])

  const rejectStep = useCallback(async (stepId: number) => {
    if (!activeRunId) return
    setBusyStepId(stepId)
    try {
      const res = await api.post(`/api/agent/runs/${activeRunId}/steps/${stepId}/reject`)
      setActiveRun(res.data)
      fetchRuns()
    } catch (err: unknown) {
      toast.error('Could not reject step', errMessage(err))
    } finally {
      setBusyStepId(null)
    }
  }, [activeRunId, fetchRuns, toast])

  const cancelRun = useCallback(async () => {
    if (!activeRunId) return
    setCancelling(true)
    try {
      const res = await api.post(`/api/agent/runs/${activeRunId}/cancel`)
      setActiveRun(res.data)
      fetchRuns()
    } catch (err: unknown) {
      toast.error('Could not cancel run', errMessage(err))
    } finally {
      setCancelling(false)
    }
  }, [activeRunId, fetchRuns, toast])

  const deleteRun = useCallback(async (id: number) => {
    try {
      await api.delete(`/api/agent/runs/${id}`)
      if (id === activeRunId) {
        setActiveRunId(null)
        setActiveRun(null)
      }
      setRuns(prev => prev.filter(r => r.id !== id))
    } catch (err: unknown) {
      toast.error('Could not delete run', errMessage(err))
    }
  }, [activeRunId, toast])

  const activeServerName = servers.find(s => s.id === activeRun?.server_id)?.name
  const isRunActive = activeRun && (activeRun.status === 'running' || activeRun.status === 'awaiting_approval')
  const isLaunchable = !!goal.trim() && !!selectedServer && !starting
  const selectedStep = activeRun?.steps?.find(s => s.id === selectedStepId) ?? null

  const metaSx = { display: 'flex', alignItems: 'center', gap: 0.625, color: 'text.secondary' } as const

  return (
    <Box sx={{ display: 'flex', height: '100%', bgcolor: 'background.default', position: 'relative', minHeight: 0 }}>
      {!isSidebarCollapsed && (
        <Box
          onClick={() => setIsSidebarCollapsed(true)}
          sx={(t) => ({ display: { xs: 'block', md: 'none' }, position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.4)', zIndex: t.zIndex.drawer })}
        />
      )}

      <RunSidebar
        runs={runs}
        activeRunId={activeRunId}
        onSelect={id => { setActiveRunId(id); if (window.innerWidth <= 900) setIsSidebarCollapsed(true) }}
        onNew={() => { setActiveRunId(null); if (window.innerWidth <= 900) setIsSidebarCollapsed(true) }}
        onDelete={deleteRun}
        isCollapsed={isSidebarCollapsed}
        onToggle={setIsSidebarCollapsed}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>
        <Tooltip title="Runs">
          <IconButton
            aria-label="Open runs"
            onClick={() => setIsSidebarCollapsed(false)}
            sx={{ display: { xs: 'inline-flex', md: 'none' }, position: 'absolute', top: 10, left: 10, zIndex: 5, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}
          >
            <Menu size={16} />
          </IconButton>
        </Tooltip>

        {activeRun ? (
          <>
            <Box sx={{
              px: { xs: 7, md: 3 }, py: 1.75, borderBottom: 1, borderColor: 'divider',
              bgcolor: 'background.paper', flexShrink: 0, zIndex: 2,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap',
            }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                <Typography variant="h5" component="h1" sx={{ lineHeight: 1.4 }}>{activeRun.goal}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, flexWrap: 'wrap' }}>
                  <Badge variant={STATUS_BADGE[activeRun.status].variant} dot>{STATUS_BADGE[activeRun.status].label}</Badge>
                  <Typography variant="body2" sx={metaSx}>
                    <Server size={12.5} /> {activeServerName ?? `Server #${activeRun.server_id}`}
                  </Typography>
                  <Typography variant="body2" sx={metaSx}>
                    <Hash size={12.5} /> {activeRun.steps?.length ?? 0} step{(activeRun.steps?.length ?? 0) === 1 ? '' : 's'}
                  </Typography>
                  <Typography variant="body2" sx={metaSx}>
                    <Clock size={12.5} /> started {timeAgo(activeRun.started_at)}
                  </Typography>
                  <Typography variant="body2" sx={metaSx}>
                    <Cpu size={12.5} /> {PROVIDER_LABEL[activeRun.provider] ?? activeRun.provider}
                    {activeRun.model ? ` · ${activeRun.model}` : ''}
                  </Typography>
                </Box>
                {activeRun.status === 'failed' && activeRun.error_text && (
                  <Typography variant="body2" color="error" sx={{ fontWeight: 500 }}>{activeRun.error_text}</Typography>
                )}
              </Box>

              {isRunActive && (
                <MuiButton
                  variant="outlined"
                  color="error"
                  onClick={cancelRun}
                  disabled={cancelling}
                  startIcon={<StopCircle size={14} />}
                  sx={{ flexShrink: 0 }}
                >
                  Cancel run
                </MuiButton>
              )}
            </Box>

            <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <AgentFlowCanvas
                run={activeRun}
                selectedStepId={selectedStepId}
                onSelectStep={setSelectedStepId}
                onApprove={approveStep}
                onReject={rejectStep}
                busyStepId={busyStepId}
              />
              {selectedStep && (
                <StepInspector
                  step={selectedStep}
                  onClose={() => setSelectedStepId(null)}
                />
              )}
            </Box>
          </>
        ) : (
          <>
            <Box sx={{
              px: { xs: 7, md: 3 }, py: 1.75, borderBottom: 1, borderColor: 'divider',
              bgcolor: 'background.paper', flexShrink: 0, zIndex: 2,
              display: 'flex', alignItems: 'center', gap: 1.5,
            }}>
              <Box sx={(t) => ({
                width: 36, height: 36, borderRadius: 1, flexShrink: 0,
                bgcolor: alpha(t.palette.primary.main, 0.1), border: 1, borderColor: 'primary.main', color: 'primary.main',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              })}>
                <Workflow size={18} />
              </Box>
              <Box>
                <Typography variant="h5" component="h1">New agent run</Typography>
                <Typography variant="body2" color="text.secondary">Connect a server, provider, and goal — then launch. Every SSH or Kubernetes action is proposed first, nothing runs without your approval.</Typography>
              </Box>
            </Box>
            <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <LauncherFlowCanvas
                servers={servers}
                selectedServer={selectedServer}
                onSelectServer={setSelectedServer}
                provider={provider}
                onSelectProvider={setProvider}
                goal={goal}
                onGoalChange={setGoal}
                onLaunch={startRun}
                isLaunchable={isLaunchable}
                starting={starting}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  )
}
