import { useState, useRef, useEffect, useCallback } from 'react'
import { Terminal, Play, Loader2, X, ChevronDown, Zap, Wrench, RefreshCw, Copy, Check, Maximize2, Minimize2, Eraser, CornerDownLeft } from 'lucide-react'
import { api } from '../../api/client'

interface MCPTerminalProps {
  clusterId: number
  clusterName: string
  onClose: () => void
}

interface CommandEntry {
  id: number
  cmd: string
  toolUsed: string
  output: string
  isError: boolean
  timestamp: string
  duration?: number
}

interface MCPTool {
  name: string
  description?: string
  inputSchema?: { properties?: Record<string, any>; required?: string[] }
}

// Console palette — resolves to a light "paper console" in light theme and
// GitHub-dark in dark theme (see the --term-* block in index.css).
const TERM = {
  bg: 'var(--term-bg)',
  bgSubtle: 'var(--term-bg-subtle)',
  border: 'var(--term-border)',
  text: 'var(--term-text)',
  textBright: 'var(--term-text-bright)',
  muted: 'var(--term-muted)',
  faint: 'var(--term-faint)',
  green: 'var(--term-green)',
  red: 'var(--term-red)',
  yellow: 'var(--term-yellow)',
  blue: 'var(--term-blue)',
  blueBg: 'var(--term-blue-bg)',
  blueBorder: 'var(--term-blue-border)',
  yellowBg: 'var(--term-yellow-bg)',
  yellowBorder: 'var(--term-yellow-border)',
  redBg: 'var(--term-red-bg)',
  redBorder: 'var(--term-red-border)',
}

// Smart parser: maps common kubectl commands → MCP tool name + arguments
function parseKubectlToMCP(cmd: string, clusterId: number): { tool: string; args: Record<string, any> } | null {
  const parts = cmd.trim().split(/\s+/)
  const verb = parts[0]?.toLowerCase()
  const resource = parts[1]?.toLowerCase()
  const name = parts[2]
  const nsIdx = parts.findIndex(p => p === '-n' || p === '--namespace')
  const namespace = nsIdx !== -1 ? parts[nsIdx + 1] : undefined
  const allNs = parts.includes('-A') || parts.includes('--all-namespaces')

  const ctx = `server-${clusterId}`

  // Get / list mappings
  if (verb === 'get' || verb === 'list') {
    const base = { context: ctx, ...(namespace ? { namespace } : {}) }
    if (resource === 'pods' || resource === 'pod' || resource === 'po') {
      return name
        ? { tool: 'pods_get', args: { ...base, name } }
        : { tool: 'pods_list', args: { ...base, ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'nodes' || resource === 'node' || resource === 'no') {
      return name
        ? { tool: 'nodes_get', args: { context: ctx, name } }
        : { tool: 'nodes_list', args: { context: ctx } }
    }
    if (resource === 'namespaces' || resource === 'namespace' || resource === 'ns') {
      return { tool: 'namespaces_list', args: { context: ctx } }
    }
    if (resource === 'deployments' || resource === 'deployment' || resource === 'deploy') {
      return name
        ? { tool: 'resources_get', args: { ...base, resource: 'deployments', name } }
        : { tool: 'resources_list', args: { ...base, resource: 'deployments', ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'services' || resource === 'service' || resource === 'svc') {
      return name
        ? { tool: 'resources_get', args: { ...base, resource: 'services', name } }
        : { tool: 'resources_list', args: { ...base, resource: 'services', ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'events' || resource === 'event' || resource === 'ev') {
      return { tool: 'events_list', args: { ...base, ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'configmaps' || resource === 'cm') {
      return { tool: 'resources_list', args: { ...base, resource: 'configmaps', ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'secrets' || resource === 'secret') {
      return { tool: 'resources_list', args: { ...base, resource: 'secrets', ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'ingresses' || resource === 'ingress' || resource === 'ing') {
      return { tool: 'resources_list', args: { ...base, resource: 'ingresses', ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'daemonsets' || resource === 'ds') {
      return { tool: 'resources_list', args: { ...base, resource: 'daemonsets', ...(allNs ? { all_namespaces: true } : {}) } }
    }
    if (resource === 'statefulsets' || resource === 'sts') {
      return { tool: 'resources_list', args: { ...base, resource: 'statefulsets', ...(allNs ? { all_namespaces: true } : {}) } }
    }
    // Generic fallback
    if (resource) {
      return name
        ? { tool: 'resources_get', args: { ...base, resource, name } }
        : { tool: 'resources_list', args: { ...base, resource, ...(allNs ? { all_namespaces: true } : {}) } }
    }
  }

  // Describe
  if (verb === 'describe') {
    if (resource === 'pod' || resource === 'pods' || resource === 'po') {
      return { tool: 'pods_get', args: { context: ctx, name: name || '', ...(namespace ? { namespace } : {}) } }
    }
    if (resource === 'node' || resource === 'nodes' || resource === 'no') {
      return { tool: 'nodes_get', args: { context: ctx, name: name || '' } }
    }
    if (resource && name) {
      return { tool: 'resources_get', args: { context: ctx, resource, name, ...(namespace ? { namespace } : {}) } }
    }
  }

  // Delete
  if (verb === 'delete' && resource && name) {
    return {
      tool: 'resources_delete',
      args: { context: ctx, resource, name, ...(namespace ? { namespace } : {}) }
    }
  }

  // Logs
  if (verb === 'logs' && resource) {
    return {
      tool: 'pods_log',
      args: { context: ctx, name: resource, ...(namespace ? { namespace } : {}) }
    }
  }

  return null
}

const QUICK_COMMANDS = [
  { label: 'Pods', cmd: 'get pods -A' },
  { label: 'Nodes', cmd: 'get nodes' },
  { label: 'Events', cmd: 'get events -A' },
  { label: 'Deployments', cmd: 'get deployments -A' },
  { label: 'Services', cmd: 'get svc -A' },
  { label: 'Namespaces', cmd: 'get namespaces' },
  { label: 'Ingresses', cmd: 'get ingresses -A' },
  { label: 'ConfigMaps', cmd: 'get configmaps -A' },
  { label: 'DaemonSets', cmd: 'get daemonsets -A' },
]

const EXAMPLE_COMMANDS = ['get pods -A', 'get nodes', 'describe pod my-pod -n default', 'logs my-pod -n default']

let cmdIdCounter = 0

// Per-entry copy button (lives on the dark console surface)
function CopyOutputButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      title="Copy output"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
        color: copied ? TERM.green : TERM.faint, fontSize: 12, fontFamily: 'inherit', flexShrink: 0,
      }}
      onMouseEnter={e => { if (!copied) e.currentTarget.style.color = TERM.muted }}
      onMouseLeave={e => { if (!copied) e.currentTarget.style.color = TERM.faint }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

export function MCPTerminal({ clusterId, clusterName, onClose }: MCPTerminalProps) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<CommandEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [mcpAvailable, setMcpAvailable] = useState<boolean | null>(null)
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [showQuick, setShowQuick] = useState(true)
  const [showTools, setShowTools] = useState(false)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const cmdHistory = useRef<string[]>([])

  const loadTools = useCallback(async () => {
    setToolsLoading(true)
    try {
      const res = await api.get('/api/mcp/tools')
      const rawTools = res.data?.tools || res.data || []
      setMcpTools(Array.isArray(rawTools) ? rawTools : [])
    } catch { /* ignore */ }
    finally { setToolsLoading(false) }
  }, [])

  // Check MCP + load tools
  useEffect(() => {
    api.get('/api/mcp/status')
      .then(res => {
        setMcpAvailable(res.data.available === true)
        if (res.data.available) loadTools()
      })
      .catch(() => setMcpAvailable(false))
  }, [loadTools])

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [history])

  // Esc closes the drawer (unless typing mid-command)
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  const runCommand = useCallback(async (rawCmd: string) => {
    const cmd = rawCmd.replace(/^kubectl\s+/, '').trim()
    if (!cmd || loading) return

    cmdHistory.current.unshift(cmd)
    setHistoryIndex(-1)
    setInput('')
    setLoading(true)

    const startTime = Date.now()

    const entry: CommandEntry = {
      id: ++cmdIdCounter,
      cmd,
      toolUsed: '',
      output: '',
      isError: false,
      timestamp: new Date().toLocaleTimeString(),
    }

    try {
      // 1. Try to map to an MCP tool
      const mapped = parseKubectlToMCP(cmd, clusterId)

      if (mapped && mcpAvailable) {
        entry.toolUsed = mapped.tool
        const res = await api.post('/api/mcp/tool', {
          tool: mapped.tool,
          arguments: mapped.args,
          server_id: clusterId,
        })

        if (res.data.success) {
          entry.output = typeof res.data.output === 'string'
            ? res.data.output
            : JSON.stringify(res.data.output, null, 2)
          entry.isError = res.data.is_error === true
        } else {
          // MCP tool failed → fall back to native kubectl via backend
          throw new Error(res.data.error || 'MCP tool returned no output')
        }
      } else {
        // 2. No mapping or MCP unavailable → fallback to backend kubectl (SSH or direct)
        entry.toolUsed = 'kubectl'
        const res = await api.post(`/api/servers/${clusterId}/kubectl`, { command: cmd })
        entry.output = res.data.output || res.data.error || '(no output)'
        entry.isError = !res.data.success
      }
    } catch (e: any) {
      // 3. Final fallback to SSH kubectl
      try {
        entry.toolUsed = 'kubectl (SSH)'
        const res = await api.post(`/api/servers/${clusterId}/kubectl`, { command: cmd })
        entry.output = res.data.output || res.data.error || '(no output)'
        entry.isError = !res.data.success
      } catch (e2: any) {
        entry.output = e2.response?.data?.error ?? e.message ?? 'Command failed'
        entry.isError = true
      }
    }

    entry.duration = Date.now() - startTime
    setHistory(prev => [...prev, entry])
    setLoading(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [clusterId, loading, mcpAvailable])

  // Execute a specific MCP tool directly (from tool browser)
  const runTool = useCallback(async (tool: MCPTool) => {
    const entry: CommandEntry = {
      id: ++cmdIdCounter,
      cmd: `tool: ${tool.name}`,
      toolUsed: tool.name,
      output: '',
      isError: false,
      timestamp: new Date().toLocaleTimeString(),
    }
    setLoading(true)
    const startTime = Date.now()
    try {
      const res = await api.post('/api/mcp/tool', {
        tool: tool.name,
        arguments: { context: `server-${clusterId}` },
        server_id: clusterId,
      })
      entry.output = res.data.output || JSON.stringify(res.data, null, 2)
      entry.isError = res.data.is_error === true
    } catch (e: any) {
      entry.output = e.response?.data?.error || 'Tool execution failed'
      entry.isError = true
    }
    entry.duration = Date.now() - startTime
    setHistory(prev => [...prev, entry])
    setLoading(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [clusterId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      runCommand(input)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(historyIndex + 1, cmdHistory.current.length - 1)
      setHistoryIndex(newIdx)
      setInput(cmdHistory.current[newIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = Math.max(historyIndex - 1, -1)
      setHistoryIndex(newIdx)
      setInput(newIdx === -1 ? '' : cmdHistory.current[newIdx] || '')
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setHistory([])
    }
  }

  const statusColor = mcpAvailable === null ? 'var(--text-muted)' : mcpAvailable ? 'var(--success)' : 'var(--warning)'
  const statusLabel = mcpAvailable === null ? 'Checking…' : mcpAvailable ? `MCP · ${mcpTools.length} tools` : 'MCP offline · SSH fallback'

  const sectionToggleStyle: React.CSSProperties = {
    width: '100%', padding: '8px 16px', background: 'none', border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
    color: 'var(--text-muted)',
  }

  return (
    <div
      className="fade-in"
      style={{
        position: 'fixed', right: 0, top: 0, bottom: 0,
        width: isMaximized ? 'min(1100px, 100vw)' : 'min(660px, 100vw)',
        zIndex: 1050,
        background: 'var(--bg-sidebar)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
        fontFamily: 'var(--font-mono)',
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* ── Title Bar ── */}
      <div style={{
        height: 52, padding: '0 12px 0 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-app)', flexShrink: 0, gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Terminal size={14} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>kubectl</span>
          <span style={{
            fontSize: 12, color: 'var(--text-secondary)', fontWeight: 700,
            background: 'var(--bg-elevated)', padding: '3px 10px',
            borderRadius: 99, border: '1px solid var(--border)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {clusterName}
          </span>
          <div title={mcpAvailable ? 'Commands auto-map to MCP tools' : mcpAvailable === false ? 'MCP sidecar unreachable — commands run over SSH' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
            <span className="hidden-mobile" style={{ fontSize: 12.5, color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={() => setHistory([])}
            title="Clear output (Ctrl+L)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 7, borderRadius: 'var(--radius-md)', display: 'flex' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <Eraser size={15} />
          </button>
          <button
            className="hidden-mobile"
            onClick={() => setIsMaximized(m => !m)}
            title={isMaximized ? 'Restore width' : 'Expand'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 7, borderRadius: 'var(--radius-md)', display: 'flex' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 7, borderRadius: 'var(--radius-md)', display: 'flex' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Quick Commands ── */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-app)', flexShrink: 0 }}>
        <button onClick={() => setShowQuick(q => !q)} style={sectionToggleStyle}>
          <Zap size={12} />
          <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick commands</span>
          <ChevronDown size={13} style={{ marginLeft: 'auto', transform: showQuick ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
        {showQuick && (
          <div style={{ padding: '0 16px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {QUICK_COMMANDS.map(qc => (
              <button
                key={qc.cmd}
                onClick={() => runCommand(qc.cmd)}
                disabled={loading}
                title={`kubectl ${qc.cmd}`}
                style={{
                  padding: '5px 12px', borderRadius: 99, border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 12,
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-mono)', transition: 'all 0.12s',
                  opacity: loading ? 0.5 : 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand-primary)'; e.currentTarget.style.color = 'var(--brand-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                {qc.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── MCP Tool Browser ── */}
      {mcpAvailable && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-app)', flexShrink: 0 }}>
          <button onClick={() => setShowTools(t => !t)} style={sectionToggleStyle}>
            <Wrench size={12} />
            <span style={{ fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>MCP tools ({mcpTools.length})</span>
            {toolsLoading && <Loader2 size={12} className="spin" style={{ marginLeft: 4 }} />}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); loadTools() }}
                style={{ display: 'flex', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                title="Refresh tools"
              >
                <RefreshCw size={12} />
              </span>
              <ChevronDown size={13} style={{ transform: showTools ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
          </button>
          {showTools && (
            <div style={{ padding: '0 16px 12px', maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {mcpTools.length === 0 && !toolsLoading && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No tools discovered.</span>
              )}
              {mcpTools.map(tool => (
                <button
                  key={tool.name}
                  onClick={() => runTool(tool)}
                  disabled={loading}
                  title={tool.description}
                  style={{
                    padding: '7px 10px', borderRadius: 'var(--radius-md)', border: '1px solid transparent',
                    background: 'transparent', color: 'var(--text-secondary)',
                    fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-mono)', textAlign: 'left', display: 'flex',
                    gap: 10, alignItems: 'baseline', transition: 'all 0.1s',
                    fontWeight: 600, minWidth: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
                >
                  <span style={{ color: 'var(--brand-primary)', flexShrink: 0 }}>{tool.name}</span>
                  {tool.description && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tool.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Console (dark surface: output + input) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: TERM.bg }}>
        <div ref={outputRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {history.length === 0 && (
            <div style={{ color: TERM.muted, fontSize: 13, padding: '12px 4px', lineHeight: 2 }}>
              <p style={{ color: TERM.textBright, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                kubectl — {clusterName}
              </p>
              <p>Commands auto-map to MCP tools when available, with SSH fallback.</p>
              <p style={{ color: TERM.faint, marginTop: 10, marginBottom: 4 }}>Try one:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {EXAMPLE_COMMANDS.map(ex => (
                  <button
                    key={ex}
                    onClick={() => { setInput(ex); inputRef.current?.focus() }}
                    style={{
                      padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                      background: TERM.bgSubtle, border: `1px solid ${TERM.border}`,
                      color: TERM.blue, fontSize: 12, fontFamily: 'inherit',
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <p style={{ color: TERM.faint, marginTop: 12 }}>↑↓ history · Ctrl+L clear · Esc close</p>
            </div>
          )}

          {history.map(entry => (
            <div key={entry.id} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, minWidth: 0 }}>
                <span style={{ color: entry.isError ? TERM.red : TERM.green, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>❯</span>
                <button
                  onClick={() => { setInput(entry.cmd.startsWith('tool:') ? '' : entry.cmd); inputRef.current?.focus() }}
                  title="Click to reuse this command"
                  style={{
                    fontSize: 13, color: TERM.textBright, background: 'none', border: 'none',
                    cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                  }}
                >
                  kubectl {entry.cmd}
                </button>
                <span style={{
                  fontSize: 11.5, padding: '1px 7px', borderRadius: 99, flexShrink: 0, fontWeight: 700,
                  ...(entry.toolUsed.includes('kubectl')
                    ? { background: TERM.yellowBg, color: TERM.yellow, border: `1px solid ${TERM.yellowBorder}` }
                    : { background: TERM.blueBg, color: TERM.blue, border: `1px solid ${TERM.blueBorder}` }),
                }}>
                  {entry.toolUsed}
                </span>
                <span className="hidden-mobile" style={{ fontSize: 12, color: TERM.faint, flexShrink: 0 }}>{entry.timestamp}</span>
                {entry.duration !== undefined && (
                  <span style={{ fontSize: 12, color: TERM.faint, flexShrink: 0 }}>{entry.duration}ms</span>
                )}
                <CopyOutputButton text={entry.output} />
              </div>
              <pre style={{
                margin: 0, padding: '10px 14px',
                background: entry.isError ? TERM.redBg : TERM.bgSubtle,
                border: `1px solid ${entry.isError ? TERM.redBorder : TERM.border}`,
                borderLeft: `3px solid ${entry.isError ? TERM.red : TERM.green}`,
                borderRadius: 8,
                fontSize: 12.5, lineHeight: 1.65,
                color: entry.isError ? TERM.red : TERM.text,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: isMaximized ? 560 : 360, overflowY: 'auto',
              }}>
                {entry.output || '(no output)'}
              </pre>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: TERM.muted, fontSize: 13, padding: '6px 0' }}>
              <Loader2 size={14} className="spin" color={TERM.blue} />
              <span>Executing via {mcpAvailable ? 'MCP' : 'kubectl over SSH'}…</span>
            </div>
          )}
        </div>

        {/* ── Input Bar ── */}
        <div style={{
          borderTop: `1px solid ${TERM.border}`, background: TERM.bgSubtle,
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ color: TERM.green, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>❯</span>
          <span style={{ color: TERM.faint, fontSize: 13, flexShrink: 0 }}>kubectl</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="get pods -n default"
            autoFocus
            disabled={loading}
            spellCheck={false}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: TERM.textBright, fontSize: 13.5, fontFamily: 'inherit',
              caretColor: TERM.blue,
            }}
          />
          <button
            onClick={() => runCommand(input)}
            disabled={loading || !input.trim()}
            style={{
              background: input.trim() && !loading ? TERM.blue : 'transparent',
              border: `1px solid ${input.trim() && !loading ? TERM.blue : TERM.border}`,
              borderRadius: 6, padding: '5px 14px', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              color: input.trim() && !loading ? TERM.bg : TERM.faint,
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
              fontFamily: 'inherit', transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            {loading ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
            Run
            {!loading && input.trim() && <CornerDownLeft size={12} style={{ opacity: 0.7 }} />}
          </button>
        </div>
      </div>
    </div>
  )
}
