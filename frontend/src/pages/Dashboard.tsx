import { useEffect, useState, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, Cpu, MemoryStick, HardDrive, Wifi,
  Plus, RefreshCw, AlertTriangle, ArrowRight, TrendingUp, Activity, HelpCircle,
  Boxes, Search, Terminal, Settings, Database, Zap, CheckCircle, XCircle,
  Gauge, ShieldCheck, ScrollText
} from 'lucide-react'
import { useUIStore } from '../store/uiStore'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { api, buildWsUrl } from '../api/client'
import { StatCard, SectionHeader, SearchInput } from '../components/ui'

import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../components/OSIcons'

interface ServerData {
  id: number; name: string; host: string; status: string;
  tags: string; description: string; port: number; ssh_user: string;
  os: string;
  is_k8s: boolean;
  kube_config?: string;
}
interface MetricData {
  cpu_percent: number; mem_percent: number; disk_percent: number;
  net_rx_mbps: number; net_tx_mbps: number; load_avg_1: number;
}
interface ResourceData {
  id: number; name: string; status: string; protocol: string; host: string;
  port: number; resource_type: string; use_gateway: boolean;
}
interface HistPoint {
  t: number; cpu: number; mem: number; disk: number; rx: number; tx: number; load: number;
}
interface HealingAction {
  id: number; created_at: string; server_id: number;
  trigger_info: string; command: string; status: string;
}
interface SecurityScanSummary {
  target_type: string; target_id: number; scan_type: string;
  finding_count: number; high_count: number; scanned_at: string;
}
interface LogStatsBucket {
  t: number; info: number; warn: number; error: number;
}

// Categorical series palette (validated CVD-safe, adjacent pairs, light+dark).
// Slot is keyed to the server's position in id order — color follows the
// entity, never its rank in a filtered view.
const SERIES_LIGHT = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948']
const SERIES_DARK = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767']

const timeAgo = (iso: string) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const RangeSelector = memo(({ value, onChange, ranges }: { value: number; onChange: (m: number) => void; ranges: { minutes: number; label: string }[] }) => (
  <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>
    {ranges.map(r => (
      <button
        key={r.minutes}
        onClick={() => onChange(r.minutes)}
        style={{
          padding: '5px 12px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
          background: value === r.minutes ? 'var(--brand-primary)' : 'transparent',
          color: value === r.minutes ? 'var(--text-inverse)' : 'var(--text-muted)',
          border: 'none', cursor: 'pointer', transition: 'all 0.15s'
        }}
      >
        {r.label}
      </button>
    ))}
  </div>
))

const MetricBar = memo(({ value, danger = 80, warn = 60 }: { value: number; danger?: number; warn?: number }) => {
  const color = value >= danger
    ? 'var(--danger)'
    : value >= warn
    ? 'var(--warning)'
    : 'var(--success)'
  return (
    <div className="metric-bar-outer">
      <div
        className="metric-bar-fill"
        style={{ width: `${Math.min(value, 100)}%`, background: color }}
      />
    </div>
  )
})

const ServerCard = memo(({ server, metric }: { server: ServerData; metric?: MetricData }) => {
  const navigate = useNavigate()

  const statusColors: Record<string, string> = {
    online: 'var(--success)',
    offline: 'var(--danger)',
    unknown: 'var(--warning)',
  }
  const statusColor = statusColors[server.status] || 'var(--text-muted)'

  return (
    <div
      className="card server-card fade-up"
      onClick={() => navigate(`/servers/${server.id}`)}
      style={{ cursor: 'pointer', padding: 24, overflow: 'hidden' }}
    >
      {/* Header row: icon + info + status badge */}
      <div className="server-card-header" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <div style={{
            width: 32, height: 32, borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)', border: `1px solid var(--border)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {server.is_k8s ? <KubernetesIcon size={18} /> :
             server.os === 'darwin' ? <AppleIcon size={16} color="var(--brand-primary)" /> :
             server.os === 'windows'? <WindowsIcon size={14} color="var(--brand-primary)" /> :
             server.os === 'linux'  ? <LinuxIcon size={14} color="var(--brand-primary)" /> :
             <HelpCircle size={16} color="var(--brand-primary)" />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 13, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{server.name}</h3>
              <span className={`badge badge-${server.status}`} style={{ fontSize: 11, padding: '1px 6px', fontWeight: 900 }}>{server.status}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 800 }}>{server.host || 'DIRECT API'}</div>
          </div>
        </div>
      </div>

      {metric ? (
        <div className="server-metric-stack" style={{ margin: '14px 0', gap: 8 }}>
          {[
            { label: 'CPU', value: metric.cpu_percent },
            { label: 'MEM', value: metric.mem_percent },
            { label: 'DSK', value: metric.disk_percent },
          ].map(({ label, value }) => (
            <div key={label} className="metric-row" style={{ gap: 8 }}>
              <div className="metric-label" style={{ width: 28, fontSize: 11 }}>{label}</div>
              <MetricBar value={value} danger={90} warn={75} />
              <span style={{ width: 24, textAlign: 'right', fontSize: 11, fontWeight: 900, color: 'var(--text-secondary)' }}>
                {value.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '24px 0', display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--text-muted)', fontSize: 13, fontWeight: 500,
        }}>
          <Wifi size={14} /> No metrics collected yet
        </div>
      )}

      <div className="server-card-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
        <div className="server-tag-group" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {server.tags && typeof server.tags === 'string'
            ? server.tags.split(',').slice(0, 2).map(t => (
                <span key={t} className="server-tag" style={{ fontSize: 12, padding: '2px 6px' }}>{t.trim()}</span>
              ))
            : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tags</span>
          }
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
           {server.status === 'online' && (
             <>
               <button onClick={(e) => { e.stopPropagation(); navigate(`/servers/${server.id}?tab=Terminal`); }} className="btn-icon-sm" title="Terminal"><Terminal size={14} /></button>
               <button onClick={(e) => { e.stopPropagation(); navigate(`/servers/${server.id}?tab=Logs`); }} className="btn-icon-sm" title="Logs"><Activity size={14} /></button>
             </>
           )}
           <button onClick={(e) => { e.stopPropagation(); navigate(`/servers/${server.id}?tab=Settings`); }} className="btn-icon-sm" title="Settings"><Settings size={14} /></button>
           <button className="btn-icon-sm primary" title="View Detail"><ArrowRight size={14} /></button>
        </div>
      </div>
    </div>
  )
})


export function Dashboard() {
  const navigate = useNavigate()
  const { darkMode } = useUIStore()
  const [servers, setServers] = useState<ServerData[]>([])
  const [metrics, setMetrics] = useState<Record<number, MetricData>>({})
  const [resources, setResources] = useState<ResourceData[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [history, setHistory] = useState<Record<number, HistPoint[]>>({})
  const [fleetMetric, setFleetMetric] = useState<'cpu' | 'mem' | 'disk'>('cpu')
  const [fleetRange, setFleetRange] = useState(60) // minutes
  const [healingActions, setHealingActions] = useState<HealingAction[] | null>(null)
  const [securityScans, setSecurityScans] = useState<SecurityScanSummary[] | null>(null)
  const [logStats, setLogStats] = useState<{ buckets: LogStatsBucket[]; totals: { info: number; warn: number; error: number } } | null>(null)

  const RANGES: { minutes: number; label: string }[] = [
    { minutes: 15, label: '15m' },
    { minutes: 60, label: '1h' },
    { minutes: 360, label: '6h' },
    { minutes: 1440, label: '24h' },
  ]

  // Fetch per-server history for the current time range. Called on load and
  // whenever the range changes (widening it needs a fresh, longer fetch).
  async function loadHistory(serverList: ServerData[], minutes: number) {
    serverList.forEach(async (s) => {
      try {
        const h = await api.get(`/api/servers/${s.id}/metrics?minutes=${minutes}`)
        const pts: HistPoint[] = (Array.isArray(h.data) ? h.data : []).map((m: any) => ({
          t: new Date(m.timestamp).getTime(),
          cpu: m.cpu_percent, mem: m.mem_percent, disk: m.disk_percent,
          rx: m.net_rx_mbps, tx: m.net_tx_mbps, load: m.load_avg_1,
        }))
        setHistory(prev => ({ ...prev, [s.id]: pts }))
      } catch { /* no history yet */ }
    })
  }

  // Fleet-wide log volume/error-rate — 403s for roles without any log
  // access hide the panel rather than showing an empty chart.
  async function loadLogStats(minutes: number) {
    try {
      const res = await api.get(`/api/logs/stats?minutes=${minutes}`)
      // A misconfigured/stale proxy can 200 with an HTML fallback page
      // instead of a 404 — guard against treating that as real data.
      const data = res.data
      if (data && Array.isArray(data.buckets) && data.totals) {
        setLogStats(data)
      } else {
        setLogStats(null)
      }
    } catch { setLogStats(null) }
  }

  // Refetch history + log stats when the user widens/narrows the time range
  useEffect(() => {
    if (servers.length > 0) loadHistory(servers, fleetRange)
    loadLogStats(fleetRange)
  }, [fleetRange])

  async function loadData() {
    setLoading(true)
    try {
      const serversRes = await api.get('/api/servers')
      const list = Array.isArray(serversRes.data) ? serversRes.data : []
      setServers(list)

      const resourcesRes = await api.get('/api/resources')
      const resourcesList = Array.isArray(resourcesRes.data) ? resourcesRes.data : []
      setResources(resourcesList)

      // Stop full-page loading once servers are listed
      setLoading(false)

      loadHistory(list, fleetRange)

      // Fetch latest metric per server for the cards
      list.forEach(async (s: ServerData) => {
        try {
          const m = await api.get(`/api/servers/${s.id}/metrics/latest`)
          setMetrics(prev => ({ ...prev, [s.id]: m.data }))
        } catch { /* no metrics yet */ }
      })

      // Automation activity (403 for roles without access — hide the panel)
      try {
        const ha = await api.get('/api/healing-actions')
        setHealingActions(Array.isArray(ha.data) ? ha.data.slice(0, 8) : [])
      } catch { setHealingActions(null) }

      // Security posture (403 for roles without access — hide the panel)
      try {
        const sec = await api.get('/api/audit/summary')
        setSecurityScans(Array.isArray(sec.data) ? sec.data : [])
      } catch { setSecurityScans(null) }
    } catch (err) {
      console.error('Failed to load dashboard data', err)
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        loadData();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(buildWsUrl('/ws/metrics/all'));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'metric') {
          const payload = msg.payload;
          setMetrics(prev => ({
            ...prev,
            [payload.server_id]: {
              cpu_percent: payload.cpu_percent,
              mem_percent: payload.mem_percent,
              disk_percent: payload.disk_percent,
              net_rx_mbps: payload.net_rx_mbps,
              net_tx_mbps: payload.net_tx_mbps,
              load_avg_1: payload.load_avg_1,
            }
          }))
          setHistory(prev => {
            const arr = prev[payload.server_id] || []
            const pt: HistPoint = {
              t: Date.now(),
              cpu: payload.cpu_percent, mem: payload.mem_percent, disk: payload.disk_percent,
              rx: payload.net_rx_mbps, tx: payload.net_tx_mbps, load: payload.load_avg_1,
            }
            // Keep enough points for a 24h window at 30s cadence (~2880) + margin
            return { ...prev, [payload.server_id]: [...arr, pt].slice(-3200) }
          })
        }
      } catch (err) {
        console.error('WS metrics parse error', err);
      }
    };
    return () => ws.close();
  }, []);

  const filteredServers = useMemo(() => {
    if (!searchQuery) return servers;
    const q = searchQuery.toLowerCase();
    return servers.filter(s => 
      s.name.toLowerCase().includes(q) || 
      s.host.toLowerCase().includes(q) || 
      (s.tags && s.tags.toLowerCase().includes(q)) ||
      (s.os && s.os.toLowerCase().includes(q))
    );
  }, [servers, searchQuery]);

  const { total, k8sServers, online, offline, avgCpu } = useMemo(() => {
    const tot = filteredServers.length;
    const k8s = filteredServers.filter(s => s.is_k8s).length;
    const on = filteredServers.filter(s => s.status === 'online').length;
    const off = filteredServers.filter(s => s.status === 'offline').length;
    const vals = filteredServers.map(s => metrics[s.id]).filter(Boolean);
    const cpu = vals.length > 0
      ? (vals.reduce((a, m) => a + m!.cpu_percent, 0) / vals.length).toFixed(1) + '%'
      : 'N/A';
    return { total: tot, k8sServers: k8s, online: on, offline: off, avgCpu: cpu };
  }, [filteredServers, metrics]);

  const analyticsChartData = useMemo(() => {
    return filteredServers.map(s => {
      const m = metrics[s.id]
      return {
        name: s.name,
        CPU: m ? parseFloat(m.cpu_percent.toFixed(1)) : 0,
        Memory: m ? parseFloat(m.mem_percent.toFixed(1)) : 0,
        Disk: m ? parseFloat(m.disk_percent.toFixed(1)) : 0,
      }
    })
  }, [filteredServers, metrics])

  // Latest disk utilization per server, ranked highest-first for the pie + legend.
  const diskUsageData = useMemo(() => {
    return filteredServers
      .filter(s => metrics[s.id])
      .map(s => ({ id: s.id, name: s.name, value: parseFloat(metrics[s.id]!.disk_percent.toFixed(1)) }))
      .sort((a, b) => b.value - a.value)
  }, [filteredServers, metrics])

  const avgDisk = diskUsageData.length > 0
    ? Math.round(diskUsageData.reduce((a, d) => a + d.value, 0) / diskUsageData.length)
    : null

  // Servers with any history, in stable id order — palette slot is keyed to
  // this order so a search filter never repaints the surviving series.
  const seriesServers = useMemo(() => {
    return [...servers]
      .sort((a, b) => a.id - b.id)
      .filter(s => (history[s.id] || []).length > 0)
      .slice(0, 8)
  }, [servers, history])

  const seriesColors = darkMode ? SERIES_DARK : SERIES_LIGHT

  // Bucket width scales with the range so every window shows a readable ~30-60
  // points: 1-min buckets for ≤1h, 5-min for 6h, 15-min for 24h.
  const bucketMs = fleetRange <= 60 ? 60_000 : fleetRange <= 360 ? 300_000 : 900_000
  const windowStart = () => Date.now() - fleetRange * 60_000

  // 1-minute buckets so points from different servers align on the time axis
  const timelineData = useMemo(() => {
    const cutoff = windowStart()
    const rows = new Map<number, any>()
    seriesServers.forEach(s => {
      (history[s.id] || []).forEach(p => {
        if (p.t < cutoff) return
        const t = Math.round(p.t / bucketMs) * bucketMs
        const row = rows.get(t) || { t }
        row[s.name] = parseFloat((fleetMetric === 'cpu' ? p.cpu : fleetMetric === 'mem' ? p.mem : p.disk).toFixed(1))
        rows.set(t, row)
      })
    })
    return [...rows.values()].sort((a, b) => a.t - b.t)
  }, [history, seriesServers, fleetMetric, fleetRange])

  const networkData = useMemo(() => {
    const cutoff = windowStart()
    const rows = new Map<number, { t: number; RX: number; TX: number }>()
    seriesServers.forEach(s => {
      (history[s.id] || []).forEach(p => {
        if (p.t < cutoff) return
        const t = Math.round(p.t / bucketMs) * bucketMs
        const row = rows.get(t) || { t, RX: 0, TX: 0 }
        row.RX += p.rx || 0
        row.TX += p.tx || 0
        rows.set(t, row)
      })
    })
    return [...rows.values()]
      .map(r => ({ ...r, RX: parseFloat(r.RX.toFixed(2)), TX: parseFloat(r.TX.toFixed(2)) }))
      .sort((a, b) => a.t - b.t)
  }, [history, seriesServers, fleetRange])

  // Fleet-wide average 1-min load average per bucket — unlike CPU/mem/disk
  // this isn't a percentage (can exceed 1 per core), so it gets its own
  // auto-scaled axis rather than the shared 0-100% one.
  const loadAvgData = useMemo(() => {
    const cutoff = windowStart()
    const rows = new Map<number, { t: number; sum: number; count: number }>()
    seriesServers.forEach(s => {
      (history[s.id] || []).forEach(p => {
        if (p.t < cutoff || p.load == null) return
        const t = Math.round(p.t / bucketMs) * bucketMs
        const row = rows.get(t) || { t, sum: 0, count: 0 }
        row.sum += p.load
        row.count += 1
        rows.set(t, row)
      })
    })
    return [...rows.values()]
      .map(r => ({ t: r.t, Load: parseFloat((r.sum / r.count).toFixed(2)) }))
      .sort((a, b) => a.t - b.t)
  }, [history, seriesServers, fleetRange])

  // Fleet security posture — findings summed by scan type (kernel / hardening
  // / cluster / resource), since that's the only breakdown the backend stores
  // (no medium/low severity split, only total + high-severity counts).
  const securityByType = useMemo(() => {
    if (!securityScans) return []
    const byType = new Map<string, { findings: number; high: number }>()
    securityScans.forEach(s => {
      const row = byType.get(s.scan_type) || { findings: 0, high: 0 }
      row.findings += s.finding_count
      row.high += s.high_count
      byType.set(s.scan_type, row)
    })
    return [...byType.entries()]
      .map(([name, v]) => ({ name, value: v.findings, high: v.high }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [securityScans])

  const securityTotals = useMemo(() => {
    if (!securityScans) return null
    return securityScans.reduce((acc, s) => ({
      findings: acc.findings + s.finding_count,
      high: acc.high + s.high_count,
    }), { findings: 0, high: 0 })
  }, [securityScans])

  const SCAN_TYPE_LABEL: Record<string, string> = {
    kernel: 'Kernel CVEs', hardening: 'OS Hardening', cluster: 'Cluster Posture', resource: 'Resource Exposure',
  }

  // On short ranges show HH:MM; on 24h include the day so the axis reads clearly
  const fmtClock = (t: number) => fleetRange >= 1440
    ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Direct label at the last point of each line — series identity is never
  // carried by color alone (relief rule for the light-mode palette).
  const endLabel = (name: string, count: number) => (props: any) => {
    if (props.index !== count - 1) return <g key={`el-${name}-${props.index}`} />
    return (
      <text key={`el-${name}-${props.index}`} x={props.x + 6} y={props.y + 3} fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-secondary)" fontWeight={700}>
        {name}
      </text>
    )
  }

  const [currentTime, setCurrentTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="page">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle hidden-mobile">
            Infrastructure Overview — {currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="page-header-actions" style={{ marginLeft: 'auto' }}>
          <SearchInput value={searchQuery} onChange={setSearchQuery} />
          <button className="btn btn-secondary" onClick={loadData} disabled={loading} style={{ height: 40 }}>
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            <span className="hidden-mobile">Refresh</span>
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/servers?add=1')} style={{ height: 40 }}>
            <Plus size={16} />
            <span className="hidden-mobile">Add Server</span><span className="show-mobile-only">Add</span>
          </button>
        </div>
      </div>

      <div className="grid-stats" style={{ marginBottom: 32 }}>
        <StatCard label="Total Servers" value={loading ? 'N/A' : (total - k8sServers)} icon={Server} color="var(--brand-primary)" />
        <StatCard label="K8s Clusters" value={loading ? 'N/A' : k8sServers} icon={Boxes} color="var(--info)" />
        <StatCard label="Status Online" value={loading ? 'N/A' : online} icon={Wifi} color="var(--success)" delta={total > 0 ? `${((online / total) * 100).toFixed(0)}% uptime` : undefined} />
        <StatCard label="Status Offline" value={loading ? 'N/A' : offline} icon={AlertTriangle} color={offline > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
        <StatCard label="Global Avg CPU" value={loading ? 'N/A' : avgCpu} icon={TrendingUp} color="var(--info)" />
        <StatCard label="Resources" value={loading ? 'N/A' : resources.length} icon={Database} color="var(--brand-primary)" delta={loading ? undefined : `${resources.filter(r => r.status === 'online').length} online`} />
      </div>

      {/* Fleet timeline + automation activity */}
      {!loading && seriesServers.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 32, alignItems: 'stretch' }}>
          <div className="card fade-up" style={{ flex: '2 1 420px', minWidth: 0, padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
            <SectionHeader
              title="Fleet Utilization"
              subtitle={`Per-node ${fleetMetric === 'cpu' ? 'CPU' : fleetMetric === 'mem' ? 'memory' : 'disk'} — last ${RANGES.find(r => r.minutes === fleetRange)?.label}, live`}
              action={
                <>
                  <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>
                    {([['cpu', 'CPU'], ['mem', 'MEM'], ['disk', 'DISK']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setFleetMetric(key)}
                        style={{
                          padding: '5px 14px', fontSize: 11, fontWeight: 700,
                          background: fleetMetric === key ? 'var(--brand-primary)' : 'transparent',
                          color: fleetMetric === key ? 'var(--text-inverse)' : 'var(--text-muted)',
                          border: 'none', cursor: 'pointer', transition: 'all 0.15s'
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />
                </>
              }
            />
            <div style={{ flex: 1, minHeight: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData} margin={{ top: 6, right: 76, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="t" tickFormatter={fmtClock} stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} minTickGap={40} />
                  <YAxis domain={[0, 100]} stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    labelFormatter={(t: any) => fmtClock(t)}
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                  />
                  {seriesServers.length > 1 && (
                    <Legend iconType="plainline" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 16, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                  )}
                  {seriesServers.map((s, i) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.name}
                      stroke={seriesColors[i]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                      isAnimationActive={false}
                      label={seriesServers.length === 1 ? endLabel(s.name, timelineData.length) : undefined}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {healingActions !== null && (
            <div className="card fade-up" style={{ flex: '1 1 300px', minWidth: 0, padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader
                icon={Zap}
                iconColor="var(--warning)"
                title="Automation Activity"
                action={<button className="btn btn-secondary btn-sm" onClick={() => navigate('/alerts')}>Rules</button>}
              />
              {healingActions.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 10, padding: '24px 0' }}>
                  <Zap size={22} style={{ opacity: 0.3 }} />
                  <span style={{ fontSize: 12 }}>No self-healing actions fired yet</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto', maxHeight: 260 }}>
                  {healingActions.map(a => {
                    const ok = a.status === 'success'
                    const srv = servers.find(s => s.id === a.server_id)
                    return (
                      <div key={a.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                        {ok
                          ? <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
                          : <XCircle size={14} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.trigger_info || 'Alert rule triggered'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                            {srv?.name ? `${srv.name} • ` : ''}{a.command || '—'}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: 2 }}>{timeAgo(a.created_at)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Fleet network throughput + disk usage breakdown, side by side */}
      {!loading && (networkData.length > 1 || diskUsageData.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 32, alignItems: 'stretch' }}>
          {networkData.length > 1 && (
            <div className="card fade-up" style={{ flex: '2 1 420px', minWidth: 0, padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader
                title="Fleet Network I/O"
                subtitle="Aggregate receive / transmit across all nodes — MB/s"
                action={<RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />}
              />
              <div style={{ flex: 1, minHeight: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={networkData} margin={{ top: 6, right: 46, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="t" tickFormatter={fmtClock} stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} minTickGap={40} />
                    <YAxis stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      labelFormatter={(t: any) => fmtClock(t)}
                      formatter={(v: any) => `${v} MB/s`}
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                    <Legend iconType="plainline" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 16, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                    <Line type="monotone" dataKey="RX" stroke={seriesColors[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                    <Line type="monotone" dataKey="TX" stroke={seriesColors[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {diskUsageData.length > 0 && (
            <div className="card fade-up" style={{ flex: '1 1 300px', minWidth: 0, padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader
                title="Disk Usage by Server"
                subtitle={`${diskUsageData.length} node${diskUsageData.length === 1 ? '' : 's'} reporting`}
              />
              <div style={{ width: 168, height: 168, position: 'relative', flexShrink: 0, margin: '0 auto 16px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={diskUsageData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={diskUsageData.length > 1 ? 2 : 0}
                      stroke="var(--bg-card)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {diskUsageData.map((d, i) => (
                        <Cell key={d.id} fill={seriesColors[i % seriesColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any, n: any) => [`${v}%`, n]}
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)' }}>{avgDisk}%</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fleet Avg</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: 150 }}>
                {diskUsageData.map((d, i) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: seriesColors[i % seriesColors.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ width: 34, textAlign: 'right', fontSize: 12, fontWeight: 900, color: d.value >= 90 ? 'var(--danger)' : d.value >= 75 ? 'var(--warning)' : 'var(--text-primary)' }}>{d.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fleet load average trend + security posture, side by side */}
      {!loading && (loadAvgData.length > 1 || securityScans !== null) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 32, alignItems: 'stretch' }}>
          {loadAvgData.length > 1 && (
            <div className="card fade-up" style={{ flex: '2 1 420px', minWidth: 0, padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader
                icon={Gauge}
                iconColor="var(--brand-primary)"
                title="Fleet Load Average"
                subtitle={`Average 1-min load across all nodes — last ${RANGES.find(r => r.minutes === fleetRange)?.label}`}
                action={<RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />}
              />
              <div style={{ flex: 1, minHeight: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={loadAvgData} margin={{ top: 6, right: 16, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="t" tickFormatter={fmtClock} stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} minTickGap={40} />
                    <YAxis stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      labelFormatter={(t: any) => fmtClock(t)}
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                    <Line type="monotone" dataKey="Load" stroke={seriesColors[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {securityScans !== null && (
            <div className="card fade-up" style={{ flex: '1 1 300px', minWidth: 0, padding: '24px 20px', display: 'flex', flexDirection: 'column' }}>
              <SectionHeader
                icon={ShieldCheck}
                iconColor={securityTotals && securityTotals.high > 0 ? 'var(--danger)' : 'var(--success)'}
                title="Security Posture"
                subtitle={`${securityScans.length} scan${securityScans.length === 1 ? '' : 's'} across kernel, hardening, cluster & resource checks`}
                action={<button className="btn btn-secondary btn-sm" onClick={() => navigate('/audit/kernel')}>Review</button>}
              />
              {!securityTotals || securityTotals.findings === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 10, padding: '24px 0' }}>
                  <ShieldCheck size={22} style={{ opacity: 0.3 }} />
                  <span style={{ fontSize: 12 }}>{securityScans.length === 0 ? 'No security scans run yet' : 'No findings — clean bill of health'}</span>
                </div>
              ) : (
                <>
                  <div style={{ width: 168, height: 168, position: 'relative', flexShrink: 0, margin: '0 auto 16px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={securityByType}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={80}
                          paddingAngle={securityByType.length > 1 ? 2 : 0}
                          stroke="var(--bg-card)"
                          strokeWidth={2}
                          isAnimationActive={false}
                        >
                          {securityByType.map((d, i) => (
                            <Cell key={d.name} fill={seriesColors[i % seriesColors.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: any, n: any) => [`${v} finding${v === 1 ? '' : 's'}`, SCAN_TYPE_LABEL[n] || n]}
                          contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)' }}>{securityTotals.findings}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Findings</span>
                    </div>
                  </div>
                  {securityTotals.high > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, background: 'rgba(201, 25, 11, 0.08)', border: '1px solid rgba(201, 25, 11, 0.2)', borderRadius: 'var(--radius-md)' }}>
                      <AlertTriangle size={14} color="var(--danger)" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>{securityTotals.high} high-severity finding{securityTotals.high === 1 ? '' : 's'}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: 150 }}>
                    {securityByType.map((d, i) => (
                      <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: seriesColors[i % seriesColors.length], flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{SCAN_TYPE_LABEL[d.name] || d.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 900, color: d.high > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && resources.length > 0 && (
        <div className="card fade-up" style={{ marginBottom: 32, padding: '24px 20px' }}>
          <SectionHeader
            title="Resource Inventory"
            subtitle="Click any resource to manage user access and audit logs."
            action={<button className="btn btn-secondary btn-sm" onClick={() => navigate('/resources')}><span className="hidden-mobile">View full resources</span><span className="show-mobile-only">Resources</span></button>}
          />
          <div style={{ overflowX: 'auto' }}>
            <table className="k-table" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Protocol</th>
                  <th>Host</th>
                  <th>Port</th>
                  <th>Status</th>
                  <th>Users</th>
                </tr>
              </thead>
              <tbody>
                {resources.slice(0, 4).map((resource) => (
                  <tr key={resource.id} onClick={() => navigate(`/resources/${resource.id}`)} style={{ cursor: 'pointer' }}>
                    <td>{resource.name}</td>
                    <td>{resource.resource_type}</td>
                    <td>{resource.protocol}</td>
                    <td>{resource.host}</td>
                    <td>{resource.port || '—'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{resource.status}</td>
                    <td>{resource.use_gateway ? 'Gateway' : 'Direct'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && servers.length > 0 && (
        <div className="card fade-up" style={{ marginBottom: 32, padding: '32px 24px' }}>
          <SectionHeader
            icon={Activity}
            title="Performance Analytics"
            subtitle="Resource utilization across connected nodes"
          />
          <div style={{ height: 450, marginTop: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analyticsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip
                  cursor={{ fill: 'var(--bg-elevated)' }}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
                <Legend iconType="square" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 24, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                <Bar dataKey="CPU" fill="#3b82f6" radius={0} maxBarSize={30} />
                <Bar dataKey="Memory" fill="#10b981" radius={0} maxBarSize={30} />
                <Bar dataKey="Disk" fill="#f59e0b" radius={0} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!loading && logStats !== null && (
        <div className="card fade-up" style={{ marginBottom: 32, padding: '32px 24px' }}>
          <SectionHeader
            icon={ScrollText}
            title="Log Volume & Error Rate"
            subtitle={
              logStats.totals.error + logStats.totals.warn + logStats.totals.info === 0
                ? `No log activity in the last ${RANGES.find(r => r.minutes === fleetRange)?.label}`
                : `${logStats.totals.error} error · ${logStats.totals.warn} warn · ${logStats.totals.info} info — last ${RANGES.find(r => r.minutes === fleetRange)?.label}, fleet-wide`
            }
            action={<RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />}
          />
          <div style={{ height: 260, marginTop: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={logStats.buckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="t" tickFormatter={fmtClock} stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis allowDecimals={false} stroke="#52525b" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(t: any) => fmtClock(t)}
                  cursor={{ fill: 'var(--bg-elevated)' }}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
                <Legend iconType="square" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 24, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                <Bar dataKey="info" name="Info" stackId="logs" fill="var(--text-muted)" radius={0} maxBarSize={30} />
                <Bar dataKey="warn" name="Warn" stackId="logs" fill="var(--warning)" radius={0} maxBarSize={30} />
                <Bar dataKey="error" name="Error" stackId="logs" fill="var(--danger)" radius={0} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
           <div className="card-skeleton" style={{ height: 160 }} />
           <div className="card-skeleton" style={{ height: 400 }} />
        </div>
      ) : servers.length === 0 ? (
        <div className="empty-state fade-up">
          <div style={{ width: 80, height: 80, borderRadius: 24, background: 'var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
            <Server size={40} color="var(--brand-primary)" />
          </div>
          <h2>No infrastructure connected</h2>
          <p>Begin by adding a standalone server or a Kubernetes cluster to monitor your fleet.</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={() => navigate('/servers?add=1')}>Add Standard Server</button>
            <button className="btn btn-secondary" onClick={() => navigate('/kubernetes')}>Add K8s Cluster</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          
          {/* Managed Clusters Section */}
          {filteredServers.filter(s => s.is_k8s).length > 0 && (
            <div>
              <SectionHeader
                icon={KubernetesIcon as any}
                title="Managed Clusters"
                action={<span className="badge badge-primary hidden-mobile">{filteredServers.filter(s => s.is_k8s).length} Active</span>}
              />
              <div className="grid-cards">
                {filteredServers.filter(s => s.is_k8s).map((s) => (
                  <ServerCard key={s.id} server={s} metric={metrics[s.id]} />
                ))}
              </div>
            </div>
          )}

          {/* Infrastructure Fleet Section */}
          {filteredServers.filter(s => !s.is_k8s).length > 0 && (
            <div>
              <SectionHeader
                icon={Server}
                title="Resource Fleet"
                action={<span className="badge badge-neutral hidden-mobile">{filteredServers.filter(s => !s.is_k8s).length} Nodes</span>}
              />
              <div className="grid-cards">
                {filteredServers.filter(s => !s.is_k8s).map((s) => (
                  <ServerCard key={s.id} server={s} metric={metrics[s.id]} />
                ))}
              </div>
            </div>
          )}

          {filteredServers.length === 0 && searchQuery && (
             <div className="empty-state" style={{ padding: '60px 0' }}>
                <Search size={32} color="var(--text-muted)" style={{ marginBottom: 16 }} />
                <p>No results for "{searchQuery}"</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setSearchQuery('')}>Clear Filter</button>
             </div>
          )}
        </div>
      )}
    </div>
  )
}
