import { useState, useRef, useEffect, useCallback } from 'react'
import { Terminal, Play, Loader2, X, ChevronDown, Cpu, CheckCircle2, AlertTriangle, Wrench, RefreshCw } from 'lucide-react'
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
  { label: 'ConfigMaps', cmd: 'get configmaps -A', },
  { label: 'DaemonSets', cmd: 'get daemonsets -A' },
]

let cmdIdCounter = 0

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
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const cmdHistory = useRef<string[]>([])

  // Check MCP + load tools
  useEffect(() => {
    api.get('/api/mcp/status')
      .then(res => {
        setMcpAvailable(res.data.available === true)
        if (res.data.available) loadTools()
      })
      .catch(() => setMcpAvailable(false))
  }, [])

  const loadTools = useCallback(async () => {
    setToolsLoading(true)
    try {
      const res = await api.get('/api/mcp/tools')
      const rawTools = res.data?.tools || res.data || []
      setMcpTools(Array.isArray(rawTools) ? rawTools : [])
    } catch { /* ignore */ }
    finally { setToolsLoading(false) }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [history])

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

  const statusColor = mcpAvailable === null ? '#8b949e' : mcpAvailable ? '#3fb950' : '#d29922'
  const statusLabel = mcpAvailable === null ? 'checking…' : mcpAvailable ? `MCP · ${mcpTools.length} tools` : 'MCP offline · SSH fallback'

  return (
    <div
      className="fade-in"
      style={{
        position: 'fixed', right: 0, top: 0, bottom: 0,
        width: 660, zIndex: 1050,
        background: '#0d1117', borderLeft: '1px solid #21262d',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-24px 0 80px rgba(0,0,0,0.6)',
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      {/* ── Title Bar ── */}
      <div style={{
        height: 52, padding: '0 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', borderBottom: '1px solid #21262d',
        background: '#161b22', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f56' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ffbd2e' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#27c93f' }} />
          </div>
          <div style={{ width: 1, height: 18, background: '#30363d' }} />
          <Terminal size={13} color="#58a6ff" />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9' }}>kubectl</span>
          <span style={{
            fontSize: 10, color: '#58a6ff',
            background: 'rgba(88,166,255,0.12)', padding: '2px 8px',
            borderRadius: 5, border: '1px solid rgba(88,166,255,0.2)'
          }}>
            {clusterName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
            <span style={{ fontSize: 10, color: statusColor, fontFamily: 'Inter, sans-serif' }}>{statusLabel}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setHistory([])}
            style={{ background: 'none', border: '1px solid #30363d', cursor: 'pointer', color: '#8b949e', fontSize: 10, padding: '3px 8px', borderRadius: 4, fontFamily: 'inherit' }}
          >
            Ctrl+L Clear
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b949e', padding: 4, borderRadius: 4, display: 'flex' }}>
            <X size={15} />
          </button>
        </div>
      </div>

      {/* ── Quick Commands ── */}
      <div style={{ borderBottom: '1px solid #21262d', background: '#161b22', flexShrink: 0 }}>
        <button
          onClick={() => setShowQuick(q => !q)}
          style={{ width: '100%', padding: '7px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: '#8b949e' }}
        >
          <Cpu size={11} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick Commands</span>
          <ChevronDown size={11} style={{ marginLeft: 'auto', transform: showQuick ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
        {showQuick && (
          <div style={{ padding: '2px 16px 10px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {QUICK_COMMANDS.map(qc => (
              <button
                key={qc.cmd}
                onClick={() => runCommand(qc.cmd)}
                disabled={loading}
                style={{
                  padding: '3px 10px', borderRadius: 5, border: '1px solid #30363d',
                  background: '#0d1117', color: '#58a6ff', fontSize: 11,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.12s',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {qc.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── MCP Tool Browser ── */}
      {mcpAvailable && (
        <div style={{ borderBottom: '1px solid #21262d', background: '#161b22', flexShrink: 0 }}>
          <button
            onClick={() => setShowTools(t => !t)}
            style={{ width: '100%', padding: '7px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: '#8b949e' }}
          >
            <Wrench size={11} />
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>MCP Tools ({mcpTools.length})</span>
            {toolsLoading && <Loader2 size={10} className="spin" style={{ marginLeft: 4 }} />}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={(e) => { e.stopPropagation(); loadTools() }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b949e', padding: 2 }}
                title="Refresh tools"
              >
                <RefreshCw size={10} />
              </button>
              <ChevronDown size={11} style={{ transform: showTools ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
          </button>
          {showTools && (
            <div style={{ padding: '4px 16px 12px', maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {mcpTools.length === 0 && !toolsLoading && (
                <span style={{ fontSize: 11, color: '#6e7681', padding: '8px 0' }}>No tools discovered. Check MCP server status.</span>
              )}
              {mcpTools.map(tool => (
                <button
                  key={tool.name}
                  onClick={() => runTool(tool)}
                  disabled={loading}
                  style={{
                    padding: '5px 10px', borderRadius: 5, border: '1px solid #21262d',
                    background: 'transparent', color: '#c9d1d9',
                    fontSize: 11, cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', textAlign: 'left', display: 'flex',
                    gap: 10, alignItems: 'flex-start', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1c2128')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: '#3fb950', fontSize: 11, flexShrink: 0 }}>{tool.name}</span>
                  {tool.description && (
                    <span style={{ color: '#6e7681', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      — {tool.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Output Area ── */}
      <div ref={outputRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {history.length === 0 && (
          <div style={{ color: '#8b949e', fontSize: 11.5, padding: '16px 0', lineHeight: 1.9 }}>
            <p style={{ color: '#58a6ff', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
              kubectl — {clusterName}
            </p>
            <p>Commands auto-map to MCP tools when available, with SSH fallback.</p>
            <p style={{ color: '#484f58' }}>Examples: get pods -A · get nodes · describe pod my-pod -n default</p>
            <p style={{ color: '#484f58', marginTop: 6 }}>↑↓ history · Ctrl+L clear · Enter to run</p>
          </div>
        )}

        {history.map(entry => (
          <div key={entry.id} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ color: entry.isError ? '#f85149' : '#3fb950', fontWeight: 700, fontSize: 12 }}>❯</span>
              <span style={{ fontSize: 12, color: '#e6edf3', flex: 1 }}>kubectl {entry.cmd}</span>
              <span style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 4,
                background: 'rgba(88,166,255,0.12)', color: '#58a6ff',
                border: '1px solid rgba(88,166,255,0.2)', flexShrink: 0,
              }}>
                {entry.toolUsed}
              </span>
              <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>{entry.timestamp}</span>
              {entry.duration !== undefined && (
                <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>{entry.duration}ms</span>
              )}
            </div>
            <pre style={{
              margin: 0, padding: '10px 14px',
              background: entry.isError ? 'rgba(248,81,73,0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${entry.isError ? 'rgba(248,81,73,0.25)' : '#21262d'}`,
              borderLeft: `3px solid ${entry.isError ? '#f85149' : '#3fb950'}`,
              borderRadius: 8,
              fontSize: 11.5, lineHeight: 1.65,
              color: entry.isError ? '#f85149' : '#c9d1d9',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: 360, overflowY: 'auto',
            }}>
              {entry.output || '(no output)'}
            </pre>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#8b949e', fontSize: 12, padding: '6px 0' }}>
            <Loader2 size={13} className="spin" color="#58a6ff" />
            <span>Executing via {mcpAvailable ? 'MCP' : 'kubectl SSH'}…</span>
          </div>
        )}
      </div>

      {/* ── Input Bar ── */}
      <div style={{
        borderTop: '1px solid #21262d', background: '#161b22',
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span style={{ color: '#3fb950', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>❯</span>
        <span style={{ color: '#6e7681', fontSize: 12, flexShrink: 0 }}>kubectl</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="get pods -n default"
          autoFocus
          disabled={loading}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#e6edf3', fontSize: 12.5, fontFamily: 'inherit',
            caretColor: '#58a6ff',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {mcpAvailable !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {mcpAvailable
                ? <CheckCircle2 size={11} color="#3fb950" />
                : <AlertTriangle size={11} color="#d29922" />}
            </div>
          )}
          <button
            onClick={() => runCommand(input)}
            disabled={loading || !input.trim()}
            style={{
              background: input.trim() && !loading ? 'rgba(88,166,255,0.15)' : 'transparent',
              border: `1px solid ${input.trim() && !loading ? '#58a6ff' : '#30363d'}`,
              borderRadius: 6, padding: '4px 12px', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              color: input.trim() && !loading ? '#58a6ff' : '#484f58',
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {loading ? <Loader2 size={11} className="spin" /> : <Play size={11} />}
            Run
          </button>
        </div>
      </div>
    </div>
  )
}
