import { useState, useEffect, useRef, useCallback, memo } from 'react'
import {
  Send, ChevronDown, Menu, Workflow, Terminal, Boxes, Bot,
  CheckCircle2, XCircle, AlertTriangle, Ban, Loader, Check, X, StopCircle,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, buildWsUrl } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { RunSidebar, type AgentRunSummary } from '../components/agent/RunSidebar'

interface ServerData { id: number; name: string; is_k8s?: boolean }

interface AgentStep {
  id: number
  agent_run_id: number
  step_number: number
  kind: 'ssh_command' | 'mcp_tool' | 'final_answer' | 'unknown_tool'
  tool_name: string
  tool_args: string
  reasoning: string
  status: 'pending_approval' | 'approved' | 'rejected' | 'executed' | 'failed'
  output: string
  error_text: string
  executed_at?: string
}

interface AgentRun extends AgentRunSummary {
  server_id: number
  provider: string
  model: string
  started_at: string
  finished_at?: string
  error_text: string
  steps: AgentStep[]
}

const STATUS_BADGE: Record<AgentRun['status'], { label: string; color: string }> = {
  running: { label: 'Running', color: 'var(--brand-primary)' },
  awaiting_approval: { label: 'Needs your approval', color: 'var(--warning, #d97706)' },
  completed: { label: 'Completed', color: 'var(--success)' },
  failed: { label: 'Failed', color: 'var(--danger)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)' },
}

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function kindMeta(kind: AgentStep['kind']) {
  switch (kind) {
    case 'ssh_command': return { label: 'SSH command', icon: Terminal, color: 'var(--info, #3b82f6)' }
    case 'mcp_tool': return { label: 'Kubernetes / MCP tool', icon: Boxes, color: 'var(--brand-primary)' }
    case 'unknown_tool': return { label: 'Unknown tool', icon: Ban, color: 'var(--danger)' }
    default: return { label: 'Final answer', icon: Bot, color: 'var(--success)' }
  }
}

const StepCard = memo(({ step, isBusy, onApprove, onReject }: {
  step: AgentStep
  isBusy: boolean
  onApprove: (id: number) => void
  onReject: (id: number) => void
}) => {
  if (step.kind === 'final_answer') {
    return (
      <div className="fade-up" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Bot size={16} color="var(--success)" />
        </div>
        <div style={{ flex: 1, minWidth: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
          <div className="markdown-body" style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <Markdown remarkPlugins={[remarkGfm]}>{step.reasoning}</Markdown>
          </div>
        </div>
      </div>
    )
  }

  const meta = kindMeta(step.kind)
  const Icon = meta.icon

  return (
    <div className="fade-up" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0 }}>#{step.step_number}</span>
        <Icon size={15} color={meta.color} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{meta.label}</span>
        {step.tool_name && (
          <code style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 6 }}>{step.tool_name}</code>
        )}
        <div style={{ flex: 1 }} />
        {step.status === 'pending_approval' && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--warning, #d97706)' }}>Awaiting approval</span>}
        {step.status === 'executed' && <CheckCircle2 size={16} color="var(--success)" />}
        {step.status === 'failed' && <AlertTriangle size={16} color="var(--danger)" />}
        {step.status === 'rejected' && <XCircle size={16} color="var(--text-muted)" />}
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {step.reasoning && (
          <div className="markdown-body" style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <Markdown remarkPlugins={[remarkGfm]}>{step.reasoning}</Markdown>
          </div>
        )}

        {step.tool_args && (
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-secondary)', overflowX: 'auto', fontFamily: 'var(--font-mono, monospace)' }}>
            {prettyArgs(step.tool_args)}
          </pre>
        )}

        {step.status === 'pending_approval' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              disabled={isBusy}
              onClick={() => onApprove(step.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius-md)',
                background: 'var(--brand-primary)', color: 'var(--text-inverse)', border: 'none', fontSize: 13, fontWeight: 800,
                cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.6 : 1,
              }}
            >
              {isBusy ? <Loader size={14} className="spin" /> : <Check size={14} strokeWidth={3} />}
              Approve &amp; run
            </button>
            <button
              disabled={isBusy}
              onClick={() => onReject(step.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: 13, fontWeight: 800,
                cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.6 : 1,
              }}
            >
              <X size={14} strokeWidth={3} />
              Reject
            </button>
          </div>
        )}

        {step.status === 'executed' && step.output && (
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-primary)', overflowX: 'auto', maxHeight: 320, overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)' }}>
            {step.output}
          </pre>
        )}

        {step.status === 'failed' && step.error_text && (
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--danger)', overflowX: 'auto', maxHeight: 320, overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)' }}>
            {step.error_text}
          </pre>
        )}

        {step.status === 'rejected' && (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>Rejected — not executed.</div>
        )}
      </div>
    </div>
  )
})
StepCard.displayName = 'StepCard'

export function Agent() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [selectedServer, setSelectedServer] = useState<number | ''>('')
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [goal, setGoal] = useState('')
  const [starting, setStarting] = useState(false)
  const [busyStepId, setBusyStepId] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeRun?.steps.length])

  const startRun = useCallback(async () => {
    if (!goal.trim() || !selectedServer || starting) return
    setStarting(true)
    try {
      const res = await api.post('/api/agent/runs', { goal: goal.trim(), server_id: Number(selectedServer) })
      setGoal('')
      setActiveRunId(res.data.id)
      setActiveRun(res.data)
      fetchRuns()
    } catch (err: any) {
      toast.error('Could not start agent run', err.response?.data?.error || err.message)
    } finally {
      setStarting(false)
    }
  }, [goal, selectedServer, starting, fetchRuns, toast])

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      startRun()
    }
  }

  const selectStyle: React.CSSProperties = {
    height: 34, padding: '0 26px 0 10px', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none',
  }

  const activeServerName = servers.find(s => s.id === activeRun?.server_id)?.name

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
        isCollapsed={isSidebarCollapsed}
        onToggle={setIsSidebarCollapsed}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>
        <header className="ai-chat-header" style={{
          width: '100%', padding: '12px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)', flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="show-mobile-only btn-icon"
              onClick={() => setIsSidebarCollapsed(false)}
              title="Runs"
              style={{ padding: 8, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
            >
              <Menu size={16} />
            </button>
            <div style={{
              width: 38, height: 38, borderRadius: 'var(--radius-md)',
              background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Workflow size={18} color="var(--brand-primary)" />
            </div>
            <div>
              <h1 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>Agent</h1>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                Human-approved DevOps automation{activeServerName ? <> · <span style={{ color: 'var(--text-secondary)' }}>{activeServerName}</span></> : null}
              </div>
            </div>
          </div>

          {activeRun && (activeRun.status === 'running' || activeRun.status === 'awaiting_approval') && (
            <button
              onClick={cancelRun}
              disabled={cancelling}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--danger)',
                fontSize: 12.5, fontWeight: 800, cursor: cancelling ? 'default' : 'pointer', opacity: cancelling ? 0.6 : 1,
              }}
            >
              <StopCircle size={14} /> Cancel run
            </button>
          )}
        </header>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '24px 16px 150px' }}>
          <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

            {activeRun ? (
              <>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.5 }}>{activeRun.goal}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_BADGE[activeRun.status].color }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: STATUS_BADGE[activeRun.status].color }}>{STATUS_BADGE[activeRun.status].label}</span>
                  </div>
                  {activeRun.status === 'failed' && activeRun.error_text && (
                    <div style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 600 }}>{activeRun.error_text}</div>
                  )}
                </div>

                {activeRun.steps.map(step => (
                  <StepCard
                    key={step.id}
                    step={step}
                    isBusy={busyStepId === step.id}
                    onApprove={approveStep}
                    onReject={rejectStep}
                  />
                ))}

                {activeRun.status === 'running' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>
                    <Loader size={14} className="spin" /> Thinking…
                  </div>
                )}

                <div ref={bottomRef} />
              </>
            ) : (
              <div className="fade-in" style={{ padding: '8px 0 8px' }}>
                <h2 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                  What should the Agent do?
                </h2>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Describe a goal — e.g. "restart the nginx service" or "scale the checkout deployment to 3 replicas" —
                  and pick the target server below. The Agent proposes one SSH or Kubernetes action at a time; nothing
                  runs until you approve it.
                </div>
              </div>
            )}
          </div>
        </div>

        {!activeRun && (
          <div className="ai-input-wrapper" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px', background: 'linear-gradient(to top, var(--bg-app) 55%, transparent)', pointerEvents: 'none' }}>
            <div style={{ maxWidth: 860, margin: '0 auto', pointerEvents: 'auto' }}>
              <div className="chat-input-container" style={{
                background: 'var(--bg-input)',
                border: `1px solid ${inputFocused ? 'var(--brand-primary)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-lg)', padding: '12px 14px',
                display: 'flex', gap: 10, alignItems: 'flex-end',
                boxShadow: inputFocused ? '0 0 0 3px var(--brand-glow)' : 'var(--shadow-sm, none)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}>
                <textarea
                  value={goal} onChange={e => setGoal(e.target.value)} onKeyDown={handleKeyDown}
                  onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
                  placeholder="Describe the goal for the Agent…"
                  disabled={starting} rows={1}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13, padding: '8px 0', resize: 'none', lineHeight: 1.6, maxHeight: 150 }}
                  onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px' }}
                />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <select value={selectedServer} onChange={e => setSelectedServer(Number(e.target.value) || '')} title="Target server" style={{ ...selectStyle, maxWidth: 180 }}>
                    <option value="">Select server…</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.is_k8s ? '☸ ' : ''}{s.name}</option>)}
                  </select>
                  <ChevronDown size={13} color="var(--text-muted)" style={{ position: 'absolute', right: 8, pointerEvents: 'none' }} />
                </div>
                <button onClick={startRun} disabled={!goal.trim() || !selectedServer || starting} title="Start agent run (Enter)"
                  style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', flexShrink: 0, background: goal.trim() && selectedServer && !starting ? 'var(--brand-primary)' : 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', transition: 'all 0.2s' }}>
                  {starting ? <Loader size={16} className="spin" color="var(--text-muted)" /> : <Send size={16} color={goal.trim() && selectedServer ? 'var(--text-inverse)' : 'var(--text-muted)'} />}
                </button>
              </div>
              <div className="hidden-mobile" style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 8, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                <span>Enter to start · Shift+Enter for a new line · every action needs your approval</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
