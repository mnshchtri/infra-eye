import { useEffect, useState, useRef, useMemo, memo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Activity,
  ScrollText, Terminal as TerminalIcon, RefreshCw, Wifi, Shield,
  Search, Download, Power, Settings as SettingsIcon, Loader2,
  ChevronRight, Gauge, Layers, HelpCircle,
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
  is_k8s?: boolean;
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

const StatCard = memo(({ label, value, icon: Icon, color, unit }: any) => (
  <div className="card stat-card" style={{ padding: '16px 20px', border: '1px solid var(--border)', transition: 'all 0.2s ease' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ 
        width: 36, height: 36, borderRadius: 10, 
        background: `${color}10`, border: `1px solid ${color}25`,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Icon size={18} color={color} />
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ 
          fontSize: value.length > 10 ? 16 : 20, 
          fontWeight: 800, 
          color: 'var(--text-primary)', 
          lineHeight: 1.1 
        }}>
          {value}
          {unit && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>{unit}</span>}
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.05em' }}>{label}</div>
      </div>
    </div>
    <div style={{ height: 4, background: 'var(--bg-app)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ 
        height: '100%', 
        width: typeof value === 'string' && value.includes('%') ? value : (label.includes('NET') ? '0%' : '50%'), 
        background: color,
        borderRadius: 2,
        boxShadow: `0 0 10px ${color}40`
      }} />
    </div>
  </div>
))

const LogLine = memo(({ log }: { log: LogEntry }) => (
  <div className="log-line" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', padding: '6px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
    <span className="log-ts" style={{ color: '#64748b', fontSize: 11, minWidth: 85, fontFamily: 'monospace' }}>{format(new Date(log.timestamp), 'HH:mm:ss.SSS')}</span>
    <span className="log-badge" style={{ 
      borderRadius: 4, width: 44, textAlign: 'center', flexShrink: 0, padding: '1px 0', fontSize: 9, fontWeight: 900,
      background: log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warning)' : 'var(--brand-primary)',
      color: 'var(--text-inverse)'
    }}>{log.level.toUpperCase()}</span>
    <span className="log-msg" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{log.message}</span>
  </div>
))

export function ServerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const toast = useToastStore()
  const [server, setServer] = useState<Server | null>(null)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'Overview'
  const setActiveTab = (tab: string) => setSearchParams({ tab }, { replace: true })
  const [loading, setLoading] = useState(true)
  const [logSearch, setLogSearch] = useState('')
  const [rebooting, setRebooting] = useState(false)
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false)
  const [isLogsFullscreen, setIsLogsFullscreen] = useState(false)
  
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

  const [searchParams] = useSearchParams()

  // Always show all tabs — permissions enforced at the server/API level
  const tabs = ['Overview', 'Logs', 'Terminal', 'Settings']

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    const allTabs = ['Overview', 'Logs', 'Terminal', 'Settings']
    if (tabParam && allTabs.includes(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

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
    if (metrics.length > 0) return 
    const poll = setInterval(async () => {
      try {
        const res = await api.get(`/api/servers/${id}/metrics?minutes=60`)
        if (res.data?.length > 0) {
          setMetrics(res.data)
          clearInterval(poll)
        }
      } catch (e) {}
    }, 5000)
    return () => clearInterval(poll)
  }, [id, metrics.length])

  async function loadServer() {
    setLoading(true)
    try {
      const res = await api.get(`/api/servers/${id}`)
      setServer(res.data)
      setPrefName(res.data.name || '')
      setPrefTags(res.data.tags || '')
      setPrefDesc(res.data.description || '')
    } finally {
      setLoading(false)
    }
  }

  async function loadMetrics() {
    try {
      const res = await api.get(`/api/servers/${id}/metrics?minutes=60`)
      setMetrics(res.data || [])
    } catch {}
  }

  async function loadLogs() {
    try {
      const res = await api.get(`/api/servers/${id}/logs?limit=100`)
      setLogs(res.data?.data || [])
    } catch { }
  }

  function startMetricsWs() {
    if (wsRef.current) wsRef.current.close()
    const ws = new WebSocket(buildWsUrl(`/ws/servers/${id}/metrics`))
    wsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'metric') {
          setMetrics(prev => [...prev.slice(-119), msg.payload])
        }
      } catch {}
    }
  }

  function startLogsWs() {
    if (logWsRef.current) logWsRef.current.close()
    const ws = new WebSocket(buildWsUrl(`/ws/servers/${id}/logs`))
    logWsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'log') {
          setLogs(prev => [msg.payload, ...prev].slice(0, 500))
        }
      } catch {}
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
      theme: { background: '#0a0c12', foreground: '#e8eaf6', cursor: '#6c63ff', selectionBackground: 'rgba(99,102,241,0.2)' },
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
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) xterm.write(new Uint8Array(e.data))
      else xterm.write(e.data)
    }
    xterm.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
  }

  const toggleTerminalFullscreen = () => {
    setIsTerminalFullscreen(prev => !prev)
    setTimeout(() => {
      fitAddonRef.current?.fit()
      xtermRef.current?.focus()
    }, 50)
  }

  const toggleLogsFullscreen = () => setIsLogsFullscreen(prev => !prev)

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.classList.contains('xterm-helper-textarea');
      
      if (activeTab === 'Terminal') {
        if (e.key === 'Escape' && isTerminalFullscreen) {
          e.preventDefault()
          toggleTerminalFullscreen()
        } else if (e.key === ' ' && !isInput) {
          e.preventDefault();
          toggleTerminalFullscreen();
        }
      } else if (activeTab === 'Logs') {
        if (e.key === 'Escape' && isLogsFullscreen) {
          e.preventDefault()
          toggleLogsFullscreen()
        } else if (e.key === ' ' && !isInput) {
          e.preventDefault();
          toggleLogsFullscreen();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeTab, isTerminalFullscreen, isLogsFullscreen]);

  const runDiagnostics = async () => {
    try {
      await api.post(`/api/servers/${id}/diagnose`)
      toast.info('Diagnostics Started', 'Real-time diagnostic logs will appear in the output.')
    } catch (err: any) {
      toast.error('Diagnostic failed', err.response?.data?.error || 'Unknown error')
    }
  }

  const clearLogs = async () => {
    try {
      await api.delete(`/api/servers/${id}/logs`)
      setLogs([])
      toast.success('Logs cleared', 'All historical log entries removed.')
    } catch (err: any) {
      toast.error('Clear failed', err.response?.data?.error || 'Failed to clear logs')
    }
  }

  const chartData = useMemo(() => {
    return metrics.slice(-30).map(m => ({
      t: format(new Date(m.timestamp), 'HH:mm'),
      CPU: parseFloat(m.cpu_percent?.toFixed(1)),
      Memory: parseFloat(m.mem_percent?.toFixed(1)),
      Disk: parseFloat(m.disk_percent?.toFixed(1)),
    }))
  }, [metrics])

  const latest = useMemo(() => metrics[metrics.length - 1], [metrics])
  
  const filteredLogs = useMemo(() => {
    if (!logSearch) return logs;
    const lower = logSearch.toLowerCase();
    return logs.filter(l => l.message.toLowerCase().includes(lower))
  }, [logs, logSearch])

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
      toast.warning('Reboot initiated', `${server?.name} is restarting.`)
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
      const res = await api.patch(`/api/servers/${id}/preferences`, { name: prefName, tags: prefTags, description: prefDesc })
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


  if (loading && !server) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
  if (!server) return <div className="page"><div className="empty-state"><p>Server not found</p></div></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', paddingBottom: 0 }} className="page">
      {/* Breadcrumbs */}
      <div className="breadcrumb-container" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/servers')} style={{ padding: '8px 10px', borderRadius: 10 }}>
          <ArrowLeft size={16} />
        </button>
        <div className="breadcrumbs" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span className="hidden-mobile">Infrastructure</span>
          <ChevronRight size={14} className="hidden-mobile" />
          <span>Servers</span>
          <ChevronRight size={14} />
          <span style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{server.name}</span>
        </div>
      </div>

      {/* Header */}
      <div className="page-header server-detail-header" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
          <div className="server-icon-large" style={{ 
            width: 52, height: 52, borderRadius: 14, 
            background: 'var(--brand-primary)', border: '1px solid var(--brand-glow)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 14px var(--brand-glow)',
            flexShrink: 0
          }}>
            {server.os === 'darwin' ? <AppleIcon size={26} color="#fff" /> : 
             server.os === 'windows' ? <WindowsIcon size={22} color="#fff" /> :
             server.os === 'linux'  ? <LinuxIcon size={24} color="#fff" /> : 
             <HelpCircle size={26} color="#fff" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{server.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className={`badge badge-${server.status}`} style={{ padding: '3px 10px' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', marginRight: 5, display: 'inline-block' }} />
                {server.status.toUpperCase()}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: '"JetBrains Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {server.host ? `${server.ssh_user}@${server.host}:${server.port}` : 'Direct Cluster API'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="page-header-actions" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
          {server.is_k8s && (
            <button className="btn btn-secondary" style={{ gap: 8, borderColor: 'var(--brand-primary)', color: 'var(--brand-primary)' }} onClick={() => navigate('/kubernetes')}>
              <Layers size={14} /> <span className="hidden-mobile">Open Cluster</span>
            </button>
          )}
          <button className="btn btn-secondary" style={{ gap: 8 }} onClick={handleReboot} disabled={rebooting || server.status !== 'online'}>
            {rebooting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> : <Power size={14} />} 
            <span className="hidden-mobile">Restart</span>
          </button>
          {server.host && (
             <button className="btn btn-primary" onClick={() => setActiveTab('Terminal')} style={{ gap: 8 }}>
                <TerminalIcon size={14} /> 
                <span className="hidden-mobile">Connect SSH</span>
                <span className="show-mobile-only">SSH</span>
             </button>
          )}
        </div>
      </div>

      {/* Tabs — always visible, never sticky/clipped */}
      <div
        className="tabs-container"
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '2px solid var(--border)',
          flexShrink: 0,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          marginBottom: 0,
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab}
            id={`tab-${tab.toLowerCase()}`}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '14px 20px',
              fontSize: 13,
              fontWeight: 600,
              transition: 'color 0.2s',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              position: 'relative',
              color: activeTab === tab ? 'var(--brand-primary)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {tab === 'Overview'  && <Gauge size={14} />}
            {tab === 'Logs'      && <ScrollText size={14} />}
            {tab === 'Terminal'  && <TerminalIcon size={14} />}
            {tab === 'Settings'  && <SettingsIcon size={14} />}
            <span>{tab}</span>
            {activeTab === tab && (
              <div style={{
                position: 'absolute', bottom: -2, left: 0, right: 0,
                height: 2, background: 'var(--brand-primary)',
                boxShadow: '0 0 8px var(--brand-glow)',
              }} />
            )}
          </button>
        ))}
      </div>

      {/* Scrollable tab content */}
      <div className={isTerminalFullscreen || isLogsFullscreen ? '' : 'fade-up'} style={{ flex: 1, overflowY: 'auto', paddingTop: 28, paddingBottom: 60 }}>

      {/* Content */}
      {activeTab === 'Overview' && (
        <div className="fade-up">
          <div className="grid-stats-4">
            <StatCard label="CPU LOAD"   value={latest ? `${latest.cpu_percent.toFixed(1)}%`  : 'N/A'} icon={Cpu}        color="var(--brand-primary)" />
            <StatCard label="MEMORY"     value={latest ? `${latest.mem_percent.toFixed(1)}%`  : 'N/A'} icon={MemoryStick} color="#10b981" />
            <StatCard label="DISK USAGE" value={latest ? `${latest.disk_percent.toFixed(1)}%` : 'N/A'} icon={HardDrive}   color="#f59e0b" />
            <StatCard label="NET RX / TX" value={latest ? `${latest.net_rx_mbps.toFixed(2)} / ${latest.net_tx_mbps.toFixed(2)}` : 'N/A'} icon={Wifi} color="#3b82f6" unit="MB/s" />
          </div>

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
                  />
                  <Legend iconType="circle" wrapperStyle={{ paddingTop: 20, fontSize: 12 }} />
                  <Line type="monotone" dataKey="CPU"    stroke={CHART_COLORS.cpu.stroke}  dot={false} strokeWidth={3} />
                  <Line type="monotone" dataKey="Memory" stroke={CHART_COLORS.mem.stroke}  dot={false} strokeWidth={3} />
                  <Line type="monotone" dataKey="Disk"   stroke={CHART_COLORS.disk.stroke} dot={false} strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Logs' && (
        <div className={`fade-in ${isLogsFullscreen ? 'logs-fullscreen' : ''}`} style={isLogsFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg-app)', padding: 16 } : {}}>
          <div className="card" style={{ padding: 0, overflow: 'hidden', height: isLogsFullscreen ? '100%' : 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header-flex" style={{ 
              padding: '16px 20px', borderBottom: '1px solid var(--border)', 
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
              background: 'var(--bg-elevated)', flexWrap: 'wrap', gap: 12, flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(79, 70, 229, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ScrollText size={16} color="var(--brand-primary)" />
                </div>
                <span style={{ fontWeight: 800, fontSize: 14 }}>Explorer</span>
              </div>
               <div className="header-actions" style={{ display: 'flex', gap: 8, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="search-box search-container" style={{ minWidth: 200, maxWidth: 280 }}>
                    <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="input" placeholder="Search logs…" value={logSearch} 
                     onChange={e => setLogSearch(e.target.value)} 
                     style={{ paddingLeft: 34, height: 36, fontSize: 13 }} />
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={runDiagnostics} title="Run Diagnostics">
                    <Activity size={14} color="var(--brand-primary)" /> 
                    <span className="hidden-mobile">Diagnose</span>
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={clearLogs} style={{ color: 'var(--danger)' }} title="Clear Logs">
                    <Trash2 size={14} />
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={loadLogs} title="Refresh Logs">
                    <RefreshCw size={14} />
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={toggleLogsFullscreen} title="Toggle Fullscreen (Space/Esc)">
                    {isLogsFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
               </div>
            </div>
            
            <div className="log-viewer" style={{ border: 'none', borderRadius: 0, height: isLogsFullscreen ? '100%' : 500, background: 'var(--bg-app)', overflowY: 'auto', flex: 1 }}>
              {filteredLogs.length === 0
                ? <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>No log entries found</div>
                : filteredLogs.map(log => <LogLine key={log.id} log={log} />)
              }
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Terminal' && (
        <div className={`fade-in ${isTerminalFullscreen ? 'terminal-fullscreen' : ''}`} style={isTerminalFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#0a0c12' } : {}}>
          <div className="card" style={{ padding: 0, overflow: 'hidden', height: isTerminalFullscreen ? '100%' : 'auto', borderRadius: isTerminalFullscreen ? 0 : 'var(--radius-lg)', background: '#0a0c12', border: '1px solid #1e293b' }}>
            <div style={{ padding: '8px 20px', background: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 12, fontWeight: 700 }}>
                 <TerminalIcon size={12} />
                 SSH TERMINAL — {server.ssh_user}@{server.host}
               </div>
               <div style={{ display: 'flex', gap: 12 }}>
                 <button onClick={toggleTerminalFullscreen} style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}>
                   {isTerminalFullscreen ? 'MINIMIZE (SPACE / ESC)' : 'MAXIMIZE (SPACE)'}
                 </button>
               </div>
            </div>
            <div ref={terminalRef} style={{ height: isTerminalFullscreen ? 'calc(100vh - 40px)' : 600, padding: '16px 4px', background: '#0a0c12' }} className="terminal-container" />
          </div>
        </div>
      )}

      {activeTab === 'Settings' && (
        <div className="fade-in">
           <div className="grid-2-col" style={{ gap: 24 }}>
             <div className="card">
                <h3 style={{ fontWeight: 800, fontSize: 16, marginBottom: 24 }}>Preferences</h3>
                <div className="input-group">
                  <label className="input-label">Display Name</label>
                  <input className="input" value={prefName} onChange={e => setPrefName(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Tags</label>
                  <input className="input" value={prefTags} onChange={e => setPrefTags(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Description</label>
                  <input className="input" value={prefDesc} onChange={e => setPrefDesc(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSavePreferences} disabled={prefSaving}>{prefSaving ? 'Saving…' : 'Save Changes'}</button>
             </div>
 
             <div className="card" style={{ border: '1px solid rgba(239, 68, 68, 0.1)', background: 'rgba(239, 68, 68, 0.02)' }}>
                <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--danger)', marginBottom: 24 }}>Danger Zone</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>Purge Metrics</div>
                      <button className="btn btn-secondary" onClick={handlePurgeMetrics} disabled={purgingMetrics} style={{ color: 'var(--danger)', height: 36 }}>Purge</button>
                   </div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>Remove Server</div>
                      <button className="btn btn-primary" style={{ background: 'var(--danger)', height: 36 }} onClick={handleDeleteServer}>Delete</button>
                   </div>
                </div>
             </div>
           </div>
        </div>
      )}
      </div>{/* end scrollable tab content */}
    </div>
  )
}
