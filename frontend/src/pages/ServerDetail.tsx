import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Activity,
  ScrollText, Terminal as TerminalIcon, Boxes, RefreshCw, Wifi, Shield,
  Search, Download, Power, Settings as SettingsIcon, Loader2,
  ChevronRight, Gauge, Layers, Server, ArrowRight, Info, Apple, HelpCircle
} from 'lucide-react'
import { WindowsIcon, LinuxIcon } from '../components/OSIcons'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { api, buildWsUrl } from '../api/client'
import { format } from 'date-fns'
import { usePermission } from '../hooks/usePermission'

interface Server {
  id: number; name: string; host: string; port: number; ssh_user: string;
  status: string; tags: string; description: string; auth_type: string; os: string;
}
interface Metric {
  id: number; timestamp: string; cpu_percent: number; mem_percent: number;
  disk_percent: number; mem_used_mb: number; mem_total_mb: number;
  load_avg_1: number; uptime_seconds: number; net_rx_mbps: number; net_tx_mbps: number;
}
interface LogEntry {
  id: number; timestamp: string; level: 'info' | 'warn' | 'error' | 'debug'; message: string; stream: string;
}



const CHART_COLORS = {
  cpu:  { stroke: 'hsl(247, 82%, 70%)', fill: 'hsla(247, 82%, 70%, 0.12)' },
  mem:  { stroke: 'hsl(158, 70%, 50%)', fill: 'hsla(158, 70%, 50%, 0.12)' },
  disk: { stroke: 'hsl(38, 92%, 50%)',  fill: 'hsla(38, 92%, 50%, 0.12)' },
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const [server, setServer] = useState<Server | null>(null)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [activeTab, setActiveTab] = useState('Overview')
  const [loading, setLoading] = useState(true)
  const [logSearch, setLogSearch] = useState('')
  const [kubectlCmd, setKubectlCmd]       = useState('get pods')
  const [kubectlOutput, setKubectlOutput] = useState('')
  const [kubectlLoading, setKubectlLoading] = useState(false)
  const [rebooting, setRebooting] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const logWsRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<any>(null)

  useEffect(() => {
    loadServer()
    loadMetrics()
    loadLogs()
    startMetricsWs()
    startLogsWs()
    return () => {
      wsRef.current?.close()
      logWsRef.current?.close()
    }
  }, [id])

  // Poll metrics every 5s until we have data (handles freshly connected servers)
  useEffect(() => {
    if (metrics.length > 0) return // already have data
    const poll = setInterval(async () => {
      const res = await api.get(`/api/servers/${id}/metrics?minutes=60`).catch(() => null)
      if (res && res.data?.length > 0) {
        setMetrics(res.data)
        clearInterval(poll)
      }
    }, 5000)
    return () => clearInterval(poll)
  }, [id, metrics.length])

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

  function startLogsWs() {
    const ws = new WebSocket(buildWsUrl(`/ws/servers/${id}/logs`))
    logWsRef.current = ws
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'log') {
        setLogs(prev => [msg.payload, ...prev].slice(0, 500))
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
        cursor: '#6c63ff', selectionBackground: 'rgba(99,102,241,0.2)',
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

  async function handleDeleteServer() {
    if (!confirm('PERMANENTLY DELETE this server and ALL associated metrics/logs? This action CANNOT be undone.')) return
    try {
      await api.delete(`/api/servers/${id}`)
      navigate('/servers')
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  async function handleReboot() {
    if (!confirm('🚨 ARE YOU SURE YOU WANT TO RESTART THIS SERVER?\n\nThis will issue a command locally to the system and disrupt active workloads.')) return
    setRebooting(true)
    try {
      await api.post(`/api/servers/${id}/reboot`)
      setServer(prev => prev ? { ...prev, status: 'offline' } : null)
      alert("Reboot command sent to " + server?.name)
      navigate('/servers')
    } catch (err: any) {
      alert(err.response?.data?.error || 'Reboot failed')
    } finally {
      setRebooting(false)
    }
  }

  async function handleClearHistory(type: 'logs' | 'metrics') {
    if (!confirm(`Clear all ${type} for this server?`)) return
    try {
      // We'll use the DeleteServer logic but scoped if we had endpoints, 
      // but for now let's just implement the server-wide delete or simple placeholder
      // Actually, since I didn't add specific clear-logs endpoints (only healing history), 
      // I should probably just focus on the Hard Delete for now or add them.
      alert('Feature coming soon: Selective clearing of logs/metrics.')
    } catch (err) {
      console.error(err)
    }
  }

  const tabs = ['Overview', 'Logs']
  if (can('use-terminal')) tabs.push('Terminal')
  if (can('use-kubectl')) tabs.push('Kubectl')
  if (can('manage-servers')) tabs.push('Settings')

  if (loading && !server) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
  if (!server) return <div className="page"><div className="empty-state"><p>Server not found</p></div></div>

  return (
    <div className="page" style={{ paddingBottom: 60 }}>
      {/* ── Breadcrumbs & Action Bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className="btn btn-secondary" onClick={() => navigate('/servers')} style={{ padding: '8px 10px', borderRadius: 10 }}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>
          <span>Infrastructure</span>
          <ChevronRight size={14} />
          <span style={{ color: 'var(--text-primary)' }}>Servers</span>
          <ChevronRight size={14} />
          <span style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{server.name}</span>
        </div>
      </div>

      {/* ── Premium Header ── */}
      <div className="page-header" style={{ marginBottom: 40, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ 
            width: 64, height: 64, borderRadius: 18, 
            background: 'var(--brand-primary)', border: '1px solid var(--brand-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 16px var(--brand-glow)'
          }}>
            {server.os === 'darwin' ? <Apple size={30} color="#fff" /> : 
             server.os === 'windows' ? <WindowsIcon size={24} color="#fff" /> :
             server.os === 'linux'  ? <LinuxIcon size={26} color="#fff" /> : 
             <HelpCircle size={30} color="#fff" />}
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 28, marginBottom: 4 }}>{server.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className={`badge badge-${server.status}`} style={{ padding: '4px 12px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', marginRight: 6, display: 'inline-block' }} />
                {server.status.toUpperCase()}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: '"JetBrains Mono", monospace' }}>
                {server.ssh_user}@{server.host}:{server.port}
              </span>
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" style={{ gap: 8 }} onClick={handleReboot} disabled={rebooting || server.status !== 'online'}>
            {rebooting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> : <Power size={14} color="var(--danger)" />} Restart
          </button>
          <button className="btn btn-primary" onClick={() => setActiveTab('Terminal')} style={{ gap: 8 }}>
            <TerminalIcon size={14} /> Connect SSH
          </button>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div style={{ 
        display: 'flex', gap: 24, marginBottom: 32, 
        borderBottom: '1px solid var(--border)', paddingBottom: 0
      }}>
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '12px 4px', fontSize: 14, fontWeight: 700,
              transition: 'all 0.2s', cursor: 'pointer', border: 'none',
              background: 'transparent',
              display: 'flex', alignItems: 'center', gap: 10,
              position: 'relative',
              color: activeTab === tab ? 'var(--brand-primary)' : 'var(--text-muted)',
            }}
          >
            {tab === 'Overview' && <Gauge size={16} />}
            {tab === 'Logs' && <ScrollText size={16} />}
            {tab === 'Terminal' && <TerminalIcon size={16} />}
            {tab === 'Kubectl' && <Boxes size={16} />}
            {tab === 'Settings' && <SettingsIcon size={16} />}
            {tab}
            {activeTab === tab && (
              <div style={{ 
                position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, 
                background: 'var(--brand-primary)', boxShadow: '0 0 8px var(--brand-glow)' 
              }} />
            )}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'Overview' && (
        <div className="fade-up">
          {/* Stat cards */}
          <div className="grid-stats" style={{ marginBottom: 32 }}>
            {[
              { label: 'CPU LOAD',   value: latest ? `${latest.cpu_percent.toFixed(1)}%`  : '—', icon: Cpu,          color: 'var(--brand-primary)' },
              { label: 'MEMORY',      value: latest ? `${latest.mem_percent.toFixed(1)}%`  : '—', icon: MemoryStick,   color: '#10b981' },
              { label: 'DISK USAGE',   value: latest ? `${latest.disk_percent.toFixed(1)}%` : '—', icon: HardDrive,     color: '#f59e0b' },
              { label: 'NET RX/TX',    value: latest ? `${latest.net_rx_mbps.toFixed(1)} MB/s` : '—', icon: Wifi,       color: '#3b82f6' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="card stat-card" style={{ padding: 24, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ 
                    width: 42, height: 42, borderRadius: 12, 
                    background: `${color}10`, border: `1px solid ${color}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Icon size={20} color={color} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.05em' }}>{label}</div>
                  </div>
                </div>
                <div style={{ height: 6, background: 'var(--bg-app)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ 
                    height: '100%', 
                    width: value.includes('%') ? value : '50%', 
                    background: color,
                    borderRadius: 3,
                    boxShadow: `0 0 10px ${color}40`
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="card" style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, padding: '4px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(79, 70, 229, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' }}>
                  <Activity size={20} color="var(--brand-primary)" />
                </div>
                <div>
                  <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>Performance Analytics</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Real-time resource utilization</p>
                </div>
              </div>
              <button className="btn btn-secondary" onClick={loadMetrics} style={{ fontSize: 12, padding: '8px 16px' }}>
                <RefreshCw size={13} style={{ marginRight: 6 }} /> Sync Data
              </button>
            </div>
            {chartData.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <Wifi size={32} color="var(--text-muted)" />
                <p>No metrics available</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="t" stroke="var(--text-muted)" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="var(--text-muted)" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, boxShadow: 'var(--shadow-lg)' }}
                    itemStyle={{ padding: '2px 0' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ paddingTop: 20, fontSize: 12 }} />
                  <Line type="monotone" dataKey="CPU"    stroke={CHART_COLORS.cpu.stroke}  dot={false} strokeWidth={3} strokeLinecap="round" />
                  <Line type="monotone" dataKey="Memory" stroke={CHART_COLORS.mem.stroke}  dot={false} strokeWidth={3} strokeLinecap="round" />
                  <Line type="monotone" dataKey="Disk"   stroke={CHART_COLORS.disk.stroke} dot={false} strokeWidth={3} strokeLinecap="round" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── Logs Tab ── */}
      {activeTab === 'Logs' && (
        <div className="fade-in">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(79, 70, 229, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ScrollText size={16} color="var(--brand-primary)" />
                </div>
                <span style={{ fontWeight: 800, fontSize: 14 }}>Log Explorer</span>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                 <div className="search-box" style={{ position: 'relative' }}>
                   <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                   <input className="input" placeholder="Search logs…" value={logSearch} 
                    onChange={e => setLogSearch(e.target.value)} 
                    style={{ paddingLeft: 34, height: 36, fontSize: 13, minWidth: 280, background: '#fff' }} />
                 </div>
                 <button className="btn btn-secondary" onClick={loadLogs} style={{ height: 36, fontSize: 12 }}><RefreshCw size={14} /></button>
                 <button className="btn btn-secondary" style={{ height: 36, fontSize: 12 }}><Download size={14} /></button>
              </div>
            </div>
            
            <div className="log-viewer" style={{ border: 'none', borderRadius: 0, height: 500, background: '#0a0c12' }}>
              {filteredLogs.length === 0
                ? <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>No log entries matching your criteria</div>
                : filteredLogs.map(log => (
                  <div key={log.id} className={`log-line log-${log.level}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <span className="log-ts">{format(new Date(log.timestamp), 'HH:mm:ss.SSS')}</span>
                    <span className={`log-badge log-badge-${log.level}`} style={{ borderRadius: 4, width: 'auto', padding: '0 8px', fontSize: 10, fontWeight: 900 }}>{log.level.toUpperCase()}</span>
                    <span className="log-msg" style={{ fontFamily: '"JetBrains Mono", monospace', opacity: 0.9 }}>{log.message}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Terminal Tab ── */}
      {activeTab === 'Terminal' && can('use-terminal') && (
        <div className="fade-in">
          <div className="card" style={{ padding: 0, overflow: 'hidden', background: '#0a0c12', border: '1px solid #1e293b' }}>
            <div style={{ padding: '12px 20px', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 12, fontWeight: 700 }}>
                <TerminalIcon size={12} />
                SSH TERMINAL — {server.ssh_user}@{server.host}
              </div>
              <div style={{ width: 40 }} />
            </div>
            <div ref={terminalRef} style={{ height: 600, padding: '16px 4px' }} className="terminal-container" />
          </div>
        </div>
      )}

      {/* ── Kubectl Tab ── */}
      {activeTab === 'Kubectl' && can('use-kubectl') && (
        <div className="fade-in">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
            <div>
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(79, 70, 229, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Boxes size={18} color="var(--brand-primary)" />
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 800, fontSize: 16 }}>Command Console</h3>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Execute kubectl commands against the connected cluster</p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: 12, position: 'relative' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontWeight: 800, color: 'var(--text-muted)', fontSize: 13 }}>kubectl</span>
                    <input className="input" value={kubectlCmd}
                      onChange={e => setKubectlCmd(e.target.value)}
                      placeholder="get pods"
                      onKeyDown={e => e.key === 'Enter' && runKubectl()}
                      style={{ paddingLeft: 64, height: 44, fontSize: 14, fontWeight: 600, background: '#f8fafc' }}
                    />
                  </div>
                  <button className="btn btn-primary" onClick={runKubectl} disabled={kubectlLoading} style={{ width: 100 }}>
                    {kubectlLoading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : 'Execute'}
                  </button>
                </div>
              </div>

              {kubectlOutput && (
                <div className="card" style={{ padding: 0, overflow: 'hidden', background: '#0a0c12' }}>
                   <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em' }}>OUTPUT STREAM</span>
                     <button className="btn" style={{ height: 24, fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)' }} onClick={() => setKubectlOutput('')}>Clear</button>
                   </div>
                   <div className="kubectl-output" style={{ padding: 24, minHeight: 400, color: '#f8fafc', fontFamily: '"JetBrains Mono", monospace', fontSize: 13, lineHeight: 1.6 }}>{kubectlOutput}</div>
                </div>
              )}
            </div>

            <div>
              <div className="card">
                <h4 style={{ fontSize: 13, fontWeight: 800, marginBottom: 16, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick Actions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['get pods', 'get nodes', 'get services', 'get deployments', 'top nodes', 'describe nodes', 'get namespaces'].map(cmd => (
                    <button key={cmd} onClick={() => { setKubectlCmd(cmd); runKubectl(); }}
                      style={{ 
                        padding: '10px 14px', borderRadius: 10, background: 'var(--bg-app)', border: '1px solid var(--border)', 
                        textAlign: 'left', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                      }}
                      className="hover-lift"
                    >
                      <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{cmd}</span>
                      <ArrowRight size={14} style={{ opacity: 0.4 }} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="card" style={{ marginTop: 24, background: 'var(--brand-primary)05', border: '1px solid var(--brand-glow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <Info size={16} color="var(--brand-primary)" />
                  <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--brand-primary)' }}>Usage Note</span>
                </div>
                <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                  All commands are executed with system-level privileges on the target server's active cluster context. Use caution with destructive actions.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Management Tab ── */}
      {activeTab === 'Settings' && can('manage-servers') && (
        <div className="fade-in">
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
             <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(79, 70, 229, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Layers size={18} color="var(--brand-primary)" />
                  </div>
                  <h3 style={{ fontWeight: 800, fontSize: 16 }}>Server Preferences</h3>
                </div>
                
                <div className="input-group">
                  <label className="input-label">Display Name</label>
                  <input className="input" defaultValue={server.name} />
                </div>
                <div className="input-group">
                  <label className="input-label">Description / Tags</label>
                  <input className="input" defaultValue={server.tags} placeholder="e.g. production, aws-us-east-1" />
                </div>
                <button className="btn btn-primary" style={{ marginTop: 8 }}>Save Preferences</button>
             </div>

             <div className="card" style={{ border: '1px solid rgba(239, 68, 68, 0.1)', background: 'rgba(239, 68, 68, 0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Shield size={18} color="var(--danger)" />
                  </div>
                  <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--danger)' }}>Danger Zone</h3>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>Purge Metric History</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Permanently delete all performance data for this server.</div>
                      </div>
                      <button className="btn btn-secondary" onClick={() => handleClearHistory('metrics')}>Purge</button>
                   </div>
                   
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>Rotate SSH Credentials</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Force a reconnection with updated authentication tokens.</div>
                      </div>
                      <button className="btn btn-secondary">Rotate</button>
                   </div>

                   <div style={{ paddingTop: 20, marginTop: 10, borderTop: '1px solid rgba(239, 68, 68, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>Delete This Server</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This action is irreversible. All data will be lost.</div>
                      </div>
                      <button className="btn btn-primary" style={{ background: 'var(--danger)', border: 'none' }} onClick={handleDeleteServer}>Delete Server</button>
                   </div>
                </div>
             </div>
           </div>
        </div>
      )}
    </div>
  )
}
