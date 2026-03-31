import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Activity,
  ScrollText, Terminal as TerminalIcon, RefreshCw, Wifi, Shield,
  Search, Download, Power, Settings as SettingsIcon, Loader2,
  ChevronRight, Gauge, Layers, Server, HelpCircle,
  Trash2, Maximize2, Minimize2
} from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon } from '../components/OSIcons'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { api, buildWsUrl } from '../api/client'
import { format } from 'date-fns'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'

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
  const toast = useToastStore()
  const [server, setServer] = useState<Server | null>(null)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [activeTab, setActiveTab] = useState('Overview')
  const [loading, setLoading] = useState(true)
  const [logSearch, setLogSearch] = useState('')
  const [rebooting, setRebooting] = useState(false)
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false)
  // Preferences form
  const [prefName, setPrefName] = useState('')
  const [prefTags, setPrefTags] = useState('')
  const [prefDesc, setPrefDesc] = useState('')
  const [prefSaving, setPrefSaving] = useState(false)
  const [purgingMetrics, setPurgingMetrics] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const logWsRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)

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
      // Sync pref fields when server loads
      setPrefName(res.data.name || '')
      setPrefTags(res.data.tags || '')
      setPrefDesc(res.data.description || '')
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
    fitAddonRef.current = fitAddon

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

  function toggleTerminalFullscreen() {
    setIsTerminalFullscreen(!isTerminalFullscreen)
    // Delay fit by one event loop cycle to allow CSS to apply
    setTimeout(() => {
      fitAddonRef.current?.fit()
      xtermRef.current?.focus()
    }, 50)
  }

  async function runDiagnostics() {
    try {
      await api.post(`/api/servers/${id}/diagnose`)
      toast.info('Diagnostics Started', 'Real-time diagnostic logs will appear in the output.')
    } catch (err: any) {
      console.error('Diagnostic trigger failed:', err)
      const errorMsg = err.response?.data?.error || err.message || 'Unknown error'
      toast.error('Diagnostic failed', errorMsg)
    }
  }

  async function clearLogs() {
    try {
      await api.delete(`/api/servers/${id}/logs`)
      setLogs([])
      toast.success('Logs cleared', 'All historical log entries removed.')
    } catch (err: any) {
      toast.error('Clear failed', err.response?.data?.error || 'Failed to clear logs')
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
    try {
      await api.delete(`/api/servers/${id}`)
      toast.success('Server deleted', 'All data has been permanently removed.')
      navigate('/servers')
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.error || 'Delete failed')
    }
  }

  async function handleReboot() {
    setRebooting(true)
    try {
      await api.post(`/api/servers/${id}/reboot`)
      setServer(prev => prev ? { ...prev, status: 'offline' } : null)
      toast.warning('Reboot initiated', `${server?.name} is restarting. It will come back online shortly.`)
      navigate('/servers')
    } catch (err: any) {
      toast.error('Reboot failed', err.response?.data?.error || 'Reboot command failed')
    } finally {
      setRebooting(false)
    }
  }

  async function handleSavePreferences() {
    setPrefSaving(true)
    try {
      const res = await api.patch(`/api/servers/${id}/preferences`, {
        name: prefName,
        tags: prefTags,
        description: prefDesc,
      })
      setServer(res.data)
      toast.success('Preferences saved', 'Server display settings have been updated.')
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.error || 'Could not save preferences.')
    } finally {
      setPrefSaving(false)
    }
  }

  async function handlePurgeMetrics() {
    setPurgingMetrics(true)
    try {
      await api.delete(`/api/servers/${id}/metrics`)
      setMetrics([])
      toast.success('Metrics purged', 'All historical performance data removed.')
    } catch (err: any) {
      toast.error('Purge failed', err.response?.data?.error || 'Could not purge metrics.')
    } finally {
      setPurgingMetrics(false)
    }
  }

  const tabs = ['Overview', 'Logs']
  if (can('use-terminal')) tabs.push('Terminal')
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
            {server.os === 'darwin' ? <AppleIcon size={30} color="#fff" /> : 
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
              { label: 'NET RX / TX',  value: latest ? `${latest.net_rx_mbps.toFixed(2)} / ${latest.net_tx_mbps.toFixed(2)}` : '—', icon: Wifi, color: '#3b82f6', unit: 'MB/s' },
            ].map(({ label, value, icon: Icon, color, unit }) => (
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
                    <div style={{ 
                      fontSize: value.length > 10 ? 18 : 24, 
                      fontWeight: 800, 
                      color: 'var(--text-primary)', 
                      lineHeight: 1 
                    }}>
                      {value}
                      {unit && <span style={{ fontSize: 12, marginLeft: 4, opacity: 0.7 }}>{unit}</span>}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.05em' }}>{label}</div>
                  </div>
                </div>
                <div style={{ height: 6, background: 'var(--bg-app)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ 
                    height: '100%', 
                    width: value.includes('%') ? value : (label.includes('NET') ? '0%' : '50%'), 
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
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
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
                     style={{ paddingLeft: 34, height: 36, fontSize: 13, minWidth: 280, background: 'var(--bg-card)' }} />
                  </div>
                  <button className="btn btn-secondary" onClick={runDiagnostics} style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 'bold' }}>
                    <Activity size={14} color="var(--brand-primary)" /> Run Diagnostics
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={clearLogs} 
                    style={{ height: 36, fontSize: 12, color: 'var(--danger)', borderColor: 'var(--danger-glow)' }}
                    title="Clear Historical Logs"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button className="btn btn-secondary" onClick={loadLogs} style={{ height: 36, fontSize: 12 }}><RefreshCw size={14} /></button>
                  <button className="btn btn-secondary" style={{ height: 36, fontSize: 12 }}><Download size={14} /></button>
               </div>
            </div>
            
            <div className="log-viewer" style={{ border: 'none', borderRadius: 0, height: 500, background: 'var(--bg-app)', overflowY: 'auto' }}>
              {filteredLogs.length === 0
                ? <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>No log entries matching your criteria</div>
                : filteredLogs.map(log => (
                  <div key={log.id} className="log-line" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', padding: '6px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <span className="log-ts" style={{ color: '#64748b', fontSize: 11, minWidth: 85, fontFamily: 'monospace' }}>{format(new Date(log.timestamp), 'HH:mm:ss.SSS')}</span>
                    <span className="log-badge" style={{ 
                      borderRadius: 4, width: 44, textAlign: 'center', flexShrink: 0, padding: '1px 0', fontSize: 9, fontWeight: 900,
                      background: log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warning)' : 'var(--brand-primary)',
                      color: 'var(--text-inverse)'
                    }}>{log.level.toUpperCase()}</span>
                    <span className="log-msg" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{log.message}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Terminal Tab ── */}
      {activeTab === 'Terminal' && can('use-terminal') && (
        <div className={`fade-in ${isTerminalFullscreen ? 'terminal-fullscreen' : ''}`} style={isTerminalFullscreen ? {
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, background: 'var(--bg-app)', padding: 0
        } : {}}>
          <div className="card" style={{ 
            padding: 0, 
            overflow: 'hidden', 
            background: 'var(--bg-app)', 
            border: isTerminalFullscreen ? 'none' : '1px solid var(--border)',
            height: isTerminalFullscreen ? '100%' : 'auto',
            borderRadius: isTerminalFullscreen ? 0 : 'var(--radius-lg)'
          }}>
            <div style={{ padding: '8px 20px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f56' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#27c93f' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12, fontWeight: 700 }}>
                <TerminalIcon size={12} />
                SSH TERMINAL — {server.ssh_user}@{server.host}
              </div>
              <button 
                onClick={toggleTerminalFullscreen}
                style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600 }}
              >
                {isTerminalFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {isTerminalFullscreen ? 'MINIMIZE' : 'MAXIMIZE'}
              </button>
            </div>
            <div ref={terminalRef} style={{ height: isTerminalFullscreen ? 'calc(100vh - 40px)' : 600, padding: '16px 4px' }} className="terminal-container" />
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
                  <input className="input" value={prefName} onChange={e => setPrefName(e.target.value)} placeholder={server.name} />
                </div>
                <div className="input-group">
                  <label className="input-label">Tags</label>
                  <input className="input" value={prefTags} onChange={e => setPrefTags(e.target.value)} placeholder="e.g. production, aws-us-east-1" />
                </div>
                <div className="input-group">
                  <label className="input-label">Description</label>
                  <input className="input" value={prefDesc} onChange={e => setPrefDesc(e.target.value)} placeholder="Optional note" />
                </div>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 8 }}
                  onClick={handleSavePreferences}
                  disabled={prefSaving}
                >
                  {prefSaving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : 'Save Preferences'}
                </button>
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
                      <button
                        className="btn btn-secondary"
                        onClick={handlePurgeMetrics}
                        disabled={purgingMetrics}
                        style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                      >
                        {purgingMetrics ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : 'Purge'}
                      </button>
                   </div>
                   
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>Rotate SSH Credentials</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Force a reconnection with updated authentication tokens.</div>
                      </div>
                      <button className="btn btn-secondary" onClick={() => {
                        // Re-open the edit server modal on the Servers page
                        navigate(`/servers?edit=${id}`)
                      }}>Rotate</button>
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
