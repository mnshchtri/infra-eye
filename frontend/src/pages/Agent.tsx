import { useState, useEffect, useCallback } from 'react'
import {
  Menu, Workflow, Server, Hash, Clock, StopCircle, Cpu,
} from 'lucide-react'
import { api, buildWsUrl } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { Badge } from '../components/ui'
import { RunSidebar, type AgentRunSummary } from '../components/agent/RunSidebar'
import { AgentFlowCanvas } from '../components/agent/AgentFlowCanvas'
import { StepInspector } from '../components/agent/StepInspector'
import { LauncherFlowCanvas } from '../components/agent/LauncherFlowCanvas'
import type { AgentProvider } from '../components/agent/LauncherFlowNodes'
import type { ServerData, AgentRun } from './agentTypes'

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
    } catch (err: any) {
      toast.error('Could not start agent run', err.response?.data?.error || err.message)
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
    } catch (err: any) {
      toast.error('Could not approve step', err.response?.data?.error || err.message)
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
    } catch (err: any) {
      toast.error('Could not reject step', err.response?.data?.error || err.message)
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
    } catch (err: any) {
      toast.error('Could not cancel run', err.response?.data?.error || err.message)
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
    } catch (err: any) {
      toast.error('Could not delete run', err.response?.data?.error || err.message)
    }
  }, [activeRunId, toast])

  const activeServerName = servers.find(s => s.id === activeRun?.server_id)?.name
  const isRunActive = activeRun && (activeRun.status === 'running' || activeRun.status === 'awaiting_approval')
  const isLaunchable = !!goal.trim() && !!selectedServer && !starting
  const selectedStep = activeRun?.steps?.find(s => s.id === selectedStepId) ?? null

  return (
    <div className={`ai-assistant-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ display: 'flex', height: '100%', background: 'var(--bg-app)', position: 'relative' }}>
      <div
        className={`ai-sidebar-overlay ${!isSidebarCollapsed ? 'mobile-open' : ''}`}
        onClick={() => setIsSidebarCollapsed(true)}
      />

      <RunSidebar
        runs={runs}
        activeRunId={activeRunId}
        onSelect={id => { setActiveRunId(id); if (window.innerWidth <= 768) setIsSidebarCollapsed(true) }}
        onNew={() => { setActiveRunId(null); if (window.innerWidth <= 768) setIsSidebarCollapsed(true) }}
        onDelete={deleteRun}
        isCollapsed={isSidebarCollapsed}
        onToggle={setIsSidebarCollapsed}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>
        <button
          className="show-mobile-only btn-icon"
          onClick={() => setIsSidebarCollapsed(false)}
          title="Runs"
          style={{ position: 'absolute', top: 14, left: 14, zIndex: 5, padding: 8, background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
        >
          <Menu size={16} />
        </button>

        {activeRun ? (
          <>
            <div style={{
              padding: '14px 24px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-card)', flexShrink: 0, zIndex: 2,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.4 }}>{activeRun.goal}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <Badge variant={STATUS_BADGE[activeRun.status].variant} dot>{STATUS_BADGE[activeRun.status].label}</Badge>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                    <Server size={12.5} /> {activeServerName ?? `Server #${activeRun.server_id}`}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                    <Hash size={12.5} /> {activeRun.steps?.length ?? 0} step{(activeRun.steps?.length ?? 0) === 1 ? '' : 's'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                    <Clock size={12.5} /> started {timeAgo(activeRun.started_at)}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                    <Cpu size={12.5} /> {PROVIDER_LABEL[activeRun.provider] ?? activeRun.provider}
                    {activeRun.model ? ` · ${activeRun.model}` : ''}
                  </span>
                </div>
                {activeRun.status === 'failed' && activeRun.error_text && (
                  <div style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 600 }}>{activeRun.error_text}</div>
                )}
              </div>

              {isRunActive && (
                <button
                  onClick={cancelRun}
                  disabled={cancelling}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--danger)',
                    fontSize: 12.5, fontWeight: 800, cursor: cancelling ? 'default' : 'pointer', opacity: cancelling ? 0.6 : 1, flexShrink: 0,
                  }}
                >
                  <StopCircle size={14} /> Cancel run
                </button>
              )}
            </div>

            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
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
            </div>
          </>
        ) : (
          <>
            <div style={{
              padding: '14px 24px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-card)', flexShrink: 0, zIndex: 2,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md)',
                background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Workflow size={18} color="var(--brand-primary)" />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>New Agent Run</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Connect a server, provider, and goal — then trigger to launch. Every SSH or Kubernetes action is proposed first, nothing runs without your approval.</div>
              </div>
            </div>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
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
            </div>
          </>
        )}
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes agentNodePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .agent-node-pulse { animation: agentNodePulse 1.4s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
