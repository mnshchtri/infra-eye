import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Activity,
  ScrollText, Terminal, Boxes, RefreshCw, Wifi,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { api, buildWsUrl } from '../api/client'
import { format } from 'date-fns'

interface Server {
  id: number; name: string; host: string; port: number; ssh_user: string;
  status: string; tags: string; description: string; auth_type: string;
}
interface Metric {
  id: number; timestamp: string; cpu_percent: number; mem_percent: number;
  disk_percent: number; mem_used_mb: number; mem_total_mb: number;
  load_avg_1: number; uptime_seconds: number; net_rx_mbps: number; net_tx_mbps: number;
}
interface LogEntry {
  id: number; timestamp: string; level: string; message: string; stream: string;
}

const tabs = ['Overview', 'Logs', 'Terminal', 'Kubectl']

const CHART_COLORS = {
  cpu:  { stroke: '#6c63ff', fill: 'rgba(108,99,255,0.15)' },
  mem:  { stroke: '#00e5a0', fill: 'rgba(0,229,160,0.15)' },
  disk: { stroke: '#ffb547', fill: 'rgba(255,181,71,0.15)' },
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [server, setServer] = useState<Server | null>(null)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [activeTab, setActiveTab] = useState('Overview')
  const [loading, setLoading] = useState(true)
  const [logSearch, setLogSearch] = useState('')
  const [kubectlCmd, setKubectlCmd]       = useState('get pods')
  const [kubectlOutput, setKubectlOutput] = useState('')
  const [kubectlLoading, setKubectlLoading] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const logWsRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<any>(null)

  useEffect(() => {
    loadServer()
    loadMetrics()
    loadLogs()
    startMetricsWs()
    return () => {
      wsRef.current?.close()
      logWsRef.current?.close()
    }
  }, [id])

  async function loadServer() {
    setLoading(true)
    try {
      const res = await api.get(`/api/servers/${id}`)
      setServer(res.data)
    } finally {
      setLoading(false)
    }
  }

  async function loadMetrics() {
    const res = await api.get(`/api/servers/${id}/metrics?minutes=60`)
    setMetrics(res.data || [])
  }

  async function loadLogs() {
    try {
      const res = await api.get(`/api/servers/${id}/logs?limit=100`)
      setLogs(res.data?.data || [])
    } catch { /* might not be connected */ }
  }

  function startMetricsWs() {
    const ws = new WebSocket(buildWsUrl(`/ws/servers/${id}/metrics`))
    wsRef.current = ws
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'metric') {
        setMetrics(prev => [...prev.slice(-119), msg.payload])
      }
    }
  }

  // Initialize xterm terminal when tab becomes active
  useEffect(() => {
    if (activeTab === 'Terminal' && terminalRef.current && !xtermRef.current) {
      initTerminal()
    }
  }, [activeTab])

  async function initTerminal() {
    const { Terminal: XTerm } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    await import('@xterm/xterm/css/xterm.css')

    const xterm = new XTerm({
      theme: {
        background: '#0a0c12', foreground: '#e8eaf6',
        cursor: '#6c63ff', selectionBackground: 'rgba(108,99,255,0.3)',
      },
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(terminalRef.current!)
    fitAddon.fit()
    xtermRef.current = xterm

    const ws = new WebSocket(buildWsUrl(`/ws/servers/${id}/terminal`))
    logWsRef.current = ws
    ws.binaryType = 'arraybuffer'
    ws.onopen  = () => xterm.writeln('\x1b[32mConnected. Type to interact.\x1b[0m')
    ws.onclose = () => xterm.writeln('\r\n\x1b[31mConnection closed.\x1b[0m')
    ws.onerror = () => xterm.writeln('\r\n\x1b[31mConnection error.\x1b[0m')
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        xterm.write(new Uint8Array(e.data))
      } else {
        xterm.write(e.data)
      }
    }
    xterm.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
  }

  async function runKubectl() {
    if (!kubectlCmd.trim()) return
    setKubectlLoading(true)
    try {
      const res = await api.post(`/api/servers/${id}/kubectl`, { command: kubectlCmd })
      setKubectlOutput(res.data.output || res.data.error || '')
    } catch (e: any) {
      setKubectlOutput(e.response?.data?.error || 'Command failed')
    } finally {
      setKubectlLoading(false)
    }
  }

  const chartData = metrics.slice(-30).map(m => ({
    t: format(new Date(m.timestamp), 'HH:mm'),
    CPU: parseFloat(m.cpu_percent?.toFixed(1)),
    Memory: parseFloat(m.mem_percent?.toFixed(1)),
    Disk: parseFloat(m.disk_percent?.toFixed(1)),
  }))

  const latest = metrics[metrics.length - 1]
  const filteredLogs = logs.filter(l =>
    logSearch === '' || l.message.toLowerCase().includes(logSearch.toLowerCase())
  )

  if (loading && !server) return <div className="page"><div className="empty-state"><div className="spinner" /></div></div>
  if (!server) return <div className="page"><div className="empty-state"><p>Server not found</p></div></div>

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ padding: '8px 10px' }}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`status-dot ${server.status}`} />
              {server.name}
            </h1>
            <p className="page-subtitle">{server.ssh_user}@{server.host}:{server.port}</p>
          </div>
        </div>
        <span className={`badge badge-${server.status}`}>{server.status}</span>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(tab => (
          <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}>
            {tab === 'Overview' && <Activity size={14} />}
            {tab === 'Logs' && <ScrollText size={14} />}
            {tab === 'Terminal' && <Terminal size={14} />}
            {tab === 'Kubectl' && <Boxes size={14} />}
            {tab}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'Overview' && (
        <div className="fade-in">
          {/* Stat cards */}
          <div className="grid-4" style={{ marginBottom: 24 }}>
            {[
              { label: 'CPU', value: latest ? `${latest.cpu_percent.toFixed(1)}%` : '—', icon: Cpu, color: 'var(--accent)' },
              { label: 'Memory', value: latest ? `${latest.mem_percent.toFixed(1)}%` : '—', icon: MemoryStick, color: 'var(--success)' },
              { label: 'Disk', value: latest ? `${latest.disk_percent.toFixed(1)}%` : '—', icon: HardDrive, color: 'var(--warning)' },
              { label: 'Load avg', value: latest ? latest.load_avg_1.toFixed(2) : '—', icon: Activity, color: 'var(--info)' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="card stat-card">
                <div className="stat-icon" style={{ background: color + '22', color }}><Icon size={20} /></div>
                <div>
                  <div className="stat-value">{value}</div>
                  <div className="stat-label">{label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 600 }}>Resource Usage (last 30 samples)</h3>
              <button className="btn btn-secondary" onClick={loadMetrics}><RefreshCw size={13} /></button>
            </div>
            {chartData.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <Wifi size={32} /><p>No metrics yet</p>
                <span>Metrics will appear once the collector connects to this server</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="t" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} stroke="var(--text-muted)" tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="CPU"    stroke={CHART_COLORS.cpu.stroke}  dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Memory" stroke={CHART_COLORS.mem.stroke}  dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Disk"   stroke={CHART_COLORS.disk.stroke} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── Logs Tab ── */}
      {activeTab === 'Logs' && (
        <div className="fade-in">
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <input className="input" placeholder="Search logs…" value={logSearch}
              onChange={e => setLogSearch(e.target.value)} style={{ maxWidth: 360 }} />
            <button className="btn btn-secondary" onClick={loadLogs}><RefreshCw size={14} /> Refresh</button>
          </div>
          <div className="log-viewer">
            {filteredLogs.length === 0
              ? <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>No logs found</div>
              : filteredLogs.map(log => (
                <div key={log.id} className={`log-line log-${log.level}`}>
                  <span className="log-ts">{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
                  <span className={`log-badge log-badge-${log.level}`}>{log.level}</span>
                  <span className="log-msg">{log.message}</span>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── Terminal Tab ── */}
      {activeTab === 'Terminal' && (
        <div className="fade-in">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="terminal-topbar">
              <span className="terminal-dot" style={{ background: '#ff5f56' }} />
              <span className="terminal-dot" style={{ background: '#ffbd2e' }} />
              <span className="terminal-dot" style={{ background: '#27c93f' }} />
              <span className="terminal-title">{server.ssh_user}@{server.host} — SSH Terminal</span>
            </div>
            <div ref={terminalRef} className="terminal-container" />
          </div>
        </div>
      )}

      {/* ── Kubectl Tab ── */}
      {activeTab === 'Kubectl' && (
        <div className="fade-in">
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Boxes size={16} /> Run kubectl command
            </h3>
            <div className="kubectl-input-row">
              <span className="kubectl-prefix">kubectl</span>
              <input className="input kubectl-input" value={kubectlCmd}
                onChange={e => setKubectlCmd(e.target.value)}
                placeholder="get pods --all-namespaces"
                onKeyDown={e => e.key === 'Enter' && runKubectl()}
              />
              <button className="btn btn-primary" onClick={runKubectl} disabled={kubectlLoading}>
                {kubectlLoading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Running</> : 'Run'}
              </button>
            </div>
            <div className="kubectl-suggestions">
              {['get pods', 'get nodes', 'get services', 'get deployments', 'top nodes', 'get namespaces'].map(cmd => (
                <button key={cmd} className="kubectl-chip" onClick={() => { setKubectlCmd(cmd); }}>
                  {cmd}
                </button>
              ))}
            </div>
          </div>
          {kubectlOutput && (
            <div className="card">
              <div className="kubectl-output">{kubectlOutput}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
