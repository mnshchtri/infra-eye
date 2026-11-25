import { useEffect, useState, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, Wifi,
  Plus, RefreshCw, AlertTriangle, ArrowRight, TrendingUp, Activity, HelpCircle,
  Boxes, Search, Terminal, Settings, Database, Zap, CheckCircle, XCircle,
  Gauge, ShieldCheck, ScrollText
} from 'lucide-react'
import {
  Alert, Box, Card, Chip, IconButton, LinearProgress, Skeleton,
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Tooltip as MuiTooltip, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { useUIStore } from '../store/uiStore'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { api, buildWsUrl } from '../api/client'
import { StatCard, SectionHeader, SearchInput, PageHeader, Button, EmptyState } from '../components/ui'

import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../components/OSIcons'

interface ServerData {
  id: number; name: string; host: string; status: string;
  tags: string; description: string; port: number; ssh_user: string;
  os: string;
  is_k8s: boolean;
  has_kubeconfig?: boolean;
}
interface MetricData {
  cpu_percent: number; mem_percent: number; disk_percent: number;
  net_rx_mbps: number; net_tx_mbps: number; load_avg_1: number;
}
interface ResourceData {
  id: number; name: string; status: string; protocol: string; host: string;
  port: number; resource_type: string; use_gateway: boolean;
}
/** One row from /api/servers/:id/metrics, as the chart consumes it. */
interface MetricSample {
  timestamp: string
  cpu_percent?: number
  mem_percent?: number
  disk_percent?: number
  net_rx_mbps?: number
  net_tx_mbps?: number
  load_avg_1?: number
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


function RangeSelector({ value, onChange, ranges }: { value: number; onChange: (m: number) => void; ranges: { minutes: number; label: string }[] }) {
  return (
    <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, v) => v !== null && onChange(v)} aria-label="Time range">
      {ranges.map(r => (
        <ToggleButton key={r.minutes} value={r.minutes} sx={{ px: 1.25, py: 0.25, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.label}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

const MetricBar = memo(({ value, danger = 80, warn = 60 }: { value: number; danger?: number; warn?: number }) => (
  <LinearProgress
    variant="determinate"
    value={Math.min(value, 100)}
    color={value >= danger ? 'error' : value >= warn ? 'warning' : 'success'}
    sx={{ flex: 1, height: 6, borderRadius: 3 }}
  />
))

/** Titled panel used by every chart/list block on the dashboard. */
function Panel({ children, sx, grow = 1, basis = 300 }: { children: ReactNode; sx?: object; grow?: number; basis?: number }) {
  return (
    <Card sx={{ flex: `${grow} 1 ${basis}px`, minWidth: 0, p: 2.5, display: 'flex', flexDirection: 'column', ...sx }}>{children}</Card>
  )
}

function Donut({ children, center, label }: { children: ReactNode; center: ReactNode; label: string }) {
  return (
    <Box sx={{ width: 168, height: 168, position: 'relative', flexShrink: 0, mx: 'auto', mb: 2 }}>
      {children}
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <Typography variant="h4" component="span">{center}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700 }}>{label}</Typography>
      </Box>
    </Box>
  )
}

function Legend2({ color, label, value, valueColor }: { color: string; label: string; value: ReactNode; valueColor?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, color: valueColor ?? 'text.primary' }}>{value}</Typography>
    </Box>
  )
}

const ServerCard = memo(({ server, metric }: { server: ServerData; metric?: MetricData }) => {
  const navigate = useNavigate()
  const go = (e: React.MouseEvent, to: string) => { e.stopPropagation(); navigate(to) }
  return (
    <Card
      onClick={() => navigate(`/servers/${server.id}`)}
      sx={{ cursor: 'pointer', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, '&:hover': { borderColor: 'primary.main' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: 1, border: 1, borderColor: 'divider', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          {server.is_k8s ? <KubernetesIcon size={18} /> :
           server.os === 'darwin' ? <AppleIcon size={16} color="var(--brand-primary)" /> :
           server.os === 'windows' ? <WindowsIcon size={14} color="var(--brand-primary)" /> :
           server.os === 'linux' ? <LinuxIcon size={14} color="var(--brand-primary)" /> :
           <HelpCircle size={16} color="var(--brand-primary)" />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" noWrap>{server.name}</Typography>
            <Chip label={server.status} size="small" color={server.status === 'online' ? 'success' : 'default'} variant={server.status === 'online' ? 'filled' : 'outlined'} sx={{ height: 18, fontSize: 10 }} />
          </Box>
          <Typography variant="caption" color="text.secondary">{server.host || 'DIRECT API'}</Typography>
        </Box>
      </Box>

      {metric ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[
            { label: 'CPU', value: metric.cpu_percent },
            { label: 'MEM', value: metric.mem_percent },
            { label: 'DSK', value: metric.disk_percent },
          ].map(({ label, value }) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 28, fontWeight: 700 }}>{label}</Typography>
              <MetricBar value={value} danger={90} warn={75} />
              <Typography variant="caption" sx={{ width: 30, textAlign: 'right', fontWeight: 700 }}>{value.toFixed(0)}%</Typography>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Wifi size={14} /> No metrics collected yet
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, borderTop: 1, borderColor: 'divider', pt: 1, mt: 'auto' }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.5, overflow: 'hidden' }}>
          {server.tags && typeof server.tags === 'string'
            ? server.tags.split(',').slice(0, 2).map(t => <Chip key={t} label={t.trim()} size="small" variant="outlined" />)
            : <Typography variant="caption" color="text.secondary">No tags</Typography>}
        </Box>
        {server.status === 'online' && (
          <>
            <MuiTooltip title="Terminal"><IconButton aria-label="Terminal" onClick={e => go(e, `/servers/${server.id}?tab=Terminal`)}><Terminal size={14} /></IconButton></MuiTooltip>
            <MuiTooltip title="Logs"><IconButton aria-label="Logs" onClick={e => go(e, `/servers/${server.id}?tab=Logs`)}><Activity size={14} /></IconButton></MuiTooltip>
          </>
        )}
        <MuiTooltip title="Settings"><IconButton aria-label="Settings" onClick={e => go(e, `/servers/${server.id}?tab=Settings`)}><Settings size={14} /></IconButton></MuiTooltip>
        <MuiTooltip title="View detail"><IconButton color="primary" aria-label="View detail"><ArrowRight size={14} /></IconButton></MuiTooltip>
      </Box>
    </Card>
  )
})

export function Dashboard() {
  const navigate = useNavigate()
  const { darkMode } = useUIStore()
  const theme = useTheme()
  // Shared recharts styling, driven by the MUI theme so charts follow light/dark.
  const axisTick = { fontSize: 11, fontFamily: 'var(--font-mono)', fill: theme.palette.text.secondary }
  const gridStroke = theme.palette.divider
  const tooltipStyle = { background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }
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
        const pts: HistPoint[] = (Array.isArray(h.data) ? h.data : []).map((m: MetricSample) => ({
          t: new Date(m.timestamp).getTime(),
          cpu: m.cpu_percent ?? 0, mem: m.mem_percent ?? 0, disk: m.disk_percent ?? 0,
          rx: m.net_rx_mbps ?? 0, tx: m.net_tx_mbps ?? 0, load: m.load_avg_1 ?? 0,
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
  const windowStart = (now: number) => now - fleetRange * 60_000

  // 1-minute buckets so points from different servers align on the time axis
  const timelineData = useMemo(() => {
    // Reading the clock here is what "last N minutes" means. Hoisting it into
    // state would need a timer whose only job is to invalidate these memos,
    // trading a real re-render cost for a lint rule.
    // eslint-disable-next-line react-hooks/purity
    const cutoff = windowStart(Date.now())
    const rows = new Map<number, Record<string, number>>()
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
    // Reading the clock here is what "last N minutes" means. Hoisting it into
    // state would need a timer whose only job is to invalidate these memos,
    // trading a real re-render cost for a lint rule.
    // eslint-disable-next-line react-hooks/purity
    const cutoff = windowStart(Date.now())
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
    // Reading the clock here is what "last N minutes" means. Hoisting it into
    // state would need a timer whose only job is to invalidate these memos,
    // trading a real re-render cost for a lint rule.
    // eslint-disable-next-line react-hooks/purity
    const cutoff = windowStart(Date.now())
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
    code: 'Code Security', dast: 'DAST',
  }

  // On short ranges show HH:MM; on 24h include the day so the axis reads clearly
  const fmtClock = (t: number) => fleetRange >= 1440
    ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // Direct label at the last point of each line — series identity is never
  // carried by color alone (relief rule for the light-mode palette).
  // Recharts types LabelList's `content` as its own internal render-prop union,
  // which a hand-written signature can't satisfy from outside the library; the
  // fields actually used are destructured and guarded below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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


  const timeRangeLabel = RANGES.find(r => r.minutes === fleetRange)?.label
  const k8sList = filteredServers.filter(s => s.is_k8s)
  const nodeList = filteredServers.filter(s => !s.is_k8s)
  const row = { display: 'flex', flexWrap: 'wrap', gap: 3, mb: 3, alignItems: 'stretch' } as const
  const chartBox = { flex: 1, minHeight: 220 } as const
  const xAxis = <XAxis dataKey="t" tickFormatter={fmtClock} tick={axisTick} axisLine={false} tickLine={false} minTickGap={40} />

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle={`Infrastructure Overview — ${currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`}
        actions={
          <>
            <Box sx={{ width: 240 }}><SearchInput value={searchQuery} onChange={setSearchQuery} /></Box>
            <Button variant="secondary" onClick={loadData} loading={loading} icon={<RefreshCw size={14} />}>Refresh</Button>
            <Button icon={<Plus size={14} />} onClick={() => navigate('/servers?add=1')}>Add Server</Button>
          </>
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
        <StatCard label="Total Servers" value={loading ? 'N/A' : (total - k8sServers)} icon={Server} color="var(--brand-primary)" />
        <StatCard label="K8s Clusters" value={loading ? 'N/A' : k8sServers} icon={Boxes} color="var(--info)" />
        <StatCard label="Status Online" value={loading ? 'N/A' : online} icon={Wifi} color="var(--success)" delta={total > 0 ? `${((online / total) * 100).toFixed(0)}% uptime` : undefined} />
        <StatCard label="Status Offline" value={loading ? 'N/A' : offline} icon={AlertTriangle} color={offline > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
        <StatCard label="Global Avg CPU" value={loading ? 'N/A' : avgCpu} icon={TrendingUp} color="var(--info)" />
        <StatCard label="Resources" value={loading ? 'N/A' : resources.length} icon={Database} color="var(--brand-primary)" delta={loading ? undefined : `${resources.filter(r => r.status === 'online').length} online`} />
      </Box>

      {/* Fleet timeline + automation activity */}
      {!loading && seriesServers.length > 0 && (
        <Box sx={row}>
          <Panel grow={2} basis={420}>
            <SectionHeader
              title="Fleet Utilization"
              subtitle={`Per-node ${fleetMetric === 'cpu' ? 'CPU' : fleetMetric === 'mem' ? 'memory' : 'disk'} — last ${timeRangeLabel}, live`}
              action={
                <>
                  <ToggleButtonGroup exclusive size="small" value={fleetMetric} onChange={(_, v) => v && setFleetMetric(v)} aria-label="Metric">
                    {([['cpu', 'CPU'], ['mem', 'MEM'], ['disk', 'DISK']] as const).map(([key, label]) => (
                      <ToggleButton key={key} value={key} sx={{ px: 1.5, py: 0.25, fontSize: 11 }}>{label}</ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />
                </>
              }
            />
            <Box sx={chartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData} margin={{ top: 6, right: 76, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" vertical={false} stroke={gridStroke} />
                  {xAxis}
                  <YAxis domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip labelFormatter={(t) => fmtClock(t)} contentStyle={tooltipStyle} />
                  {seriesServers.length > 1 && (
                    <Legend iconType="plainline" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 16, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                  )}
                  {seriesServers.map((s, i) => (
                    <Line key={s.id} type="monotone" dataKey={s.name} stroke={seriesColors[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false}
                      label={seriesServers.length === 1 ? endLabel(s.name, timelineData.length) : undefined} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Panel>

          {healingActions !== null && (
            <Panel>
              <SectionHeader
                icon={Zap}
                iconColor="var(--warning)"
                title="Automation Activity"
                action={<Button variant="secondary" size="sm" onClick={() => navigate('/alerts')}>Rules</Button>}
              />
              {healingActions.length === 0 ? (
                <EmptyState icon={Zap} title="No self-healing actions fired yet" />
              ) : (
                <Box sx={{ overflowY: 'auto', maxHeight: 260 }}>
                  {healingActions.map(a => {
                    const ok = a.status === 'success'
                    const srv = servers.find(s => s.id === a.server_id)
                    return (
                      <Box key={a.id} sx={{ display: 'flex', gap: 1.25, py: 1.25, borderBottom: 1, borderColor: 'divider', alignItems: 'flex-start' }}>
                        {ok ? <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
                            : <XCircle size={14} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{a.trigger_info || 'Alert rule triggered'}</Typography>
                          <Typography variant="caption" noWrap color="text.secondary" sx={{ display: 'block', fontFamily: 'var(--font-mono)' }}>
                            {srv?.name ? `${srv.name} • ` : ''}{a.command || '—'}
                          </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{timeAgo(a.created_at)}</Typography>
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Panel>
          )}
        </Box>
      )}

      {/* Fleet network throughput + disk usage breakdown */}
      {!loading && (networkData.length > 1 || diskUsageData.length > 0) && (
        <Box sx={row}>
          {networkData.length > 1 && (
            <Panel grow={2} basis={420}>
              <SectionHeader title="Fleet Network I/O" subtitle="Aggregate receive / transmit across all nodes — MB/s" action={<RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />} />
              <Box sx={chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={networkData} margin={{ top: 6, right: 46, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" vertical={false} stroke={gridStroke} />
                    {xAxis}
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} />
                    <Tooltip labelFormatter={(t) => fmtClock(t)} formatter={(v) => `${v} MB/s`} contentStyle={tooltipStyle} />
                    <Legend iconType="plainline" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 16, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                    <Line type="monotone" dataKey="RX" stroke={seriesColors[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                    <Line type="monotone" dataKey="TX" stroke={seriesColors[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Panel>
          )}

          {diskUsageData.length > 0 && (
            <Panel>
              <SectionHeader title="Disk Usage by Server" subtitle={`${diskUsageData.length} node${diskUsageData.length === 1 ? '' : 's'} reporting`} />
              <Donut center={`${avgDisk}%`} label="Fleet Avg">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={diskUsageData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={diskUsageData.length > 1 ? 2 : 0}
                      stroke={theme.palette.background.paper} strokeWidth={2} isAnimationActive={false}>
                      {diskUsageData.map((d, i) => <Cell key={d.id} fill={seriesColors[i % seriesColors.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [`${v}%`, n]} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </Donut>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 150 }}>
                {diskUsageData.map((d, i) => (
                  <Legend2 key={d.id} color={seriesColors[i % seriesColors.length]} label={d.name} value={`${d.value}%`}
                    valueColor={d.value >= 90 ? theme.palette.error.main : d.value >= 75 ? theme.palette.warning.main : undefined} />
                ))}
              </Box>
            </Panel>
          )}
        </Box>
      )}

      {/* Load average + security posture */}
      {!loading && (loadAvgData.length > 1 || securityScans !== null) && (
        <Box sx={row}>
          {loadAvgData.length > 1 && (
            <Panel grow={2} basis={420}>
              <SectionHeader icon={Gauge} iconColor="var(--brand-primary)" title="Fleet Load Average"
                subtitle={`Average 1-min load across all nodes — last ${timeRangeLabel}`}
                action={<RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />} />
              <Box sx={chartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={loadAvgData} margin={{ top: 6, right: 16, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" vertical={false} stroke={gridStroke} />
                    {xAxis}
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} />
                    <Tooltip labelFormatter={(t) => fmtClock(t)} contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="Load" stroke={seriesColors[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Panel>
          )}

          {securityScans !== null && (
            <Panel>
              <SectionHeader
                icon={ShieldCheck}
                iconColor={securityTotals && securityTotals.high > 0 ? 'var(--danger)' : 'var(--success)'}
                title="Security Posture"
                subtitle={`${securityScans.length} scan${securityScans.length === 1 ? '' : 's'} across kernel, hardening, cluster, resource, code & DAST checks`}
                action={<Button variant="secondary" size="sm" onClick={() => navigate('/audit/kernel')}>Review</Button>}
              />
              {!securityTotals || securityTotals.findings === 0 ? (
                <EmptyState icon={ShieldCheck} title={securityScans.length === 0 ? 'No security scans run yet' : 'No findings — clean bill of health'} />
              ) : (
                <>
                  <Donut center={securityTotals.findings} label="Findings">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={securityByType} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={securityByType.length > 1 ? 2 : 0}
                          stroke={theme.palette.background.paper} strokeWidth={2} isAnimationActive={false}>
                          {securityByType.map((d, i) => <Cell key={d.name} fill={seriesColors[i % seriesColors.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v, n) => [`${v} finding${v === 1 ? '' : 's'}`, SCAN_TYPE_LABEL[String(n)] || n]} contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </Donut>
                  {securityTotals.high > 0 && (
                    <Alert severity="error" icon={<AlertTriangle size={16} />} sx={{ mb: 1.5, py: 0 }}>
                      {securityTotals.high} high-severity finding{securityTotals.high === 1 ? '' : 's'}
                    </Alert>
                  )}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 150 }}>
                    {securityByType.map((d, i) => (
                      <Legend2 key={d.name} color={seriesColors[i % seriesColors.length]} label={SCAN_TYPE_LABEL[d.name] || d.name}
                        value={d.value} valueColor={d.high > 0 ? theme.palette.error.main : undefined} />
                    ))}
                  </Box>
                </>
              )}
            </Panel>
          )}
        </Box>
      )}

      {!loading && resources.length > 0 && (
        <Panel sx={{ mb: 3 }} basis={0}>
          <SectionHeader
            title="Resource Inventory"
            subtitle="Click any resource to manage user access and audit logs."
            action={<Button variant="secondary" size="sm" onClick={() => navigate('/resources')}>View full resources</Button>}
          />
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 680 }}>
              <TableHead>
                <TableRow>
                  {['Name', 'Type', 'Protocol', 'Host', 'Port', 'Status', 'Access'].map(h => <TableCell key={h}>{h}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {resources.slice(0, 4).map(resource => (
                  <TableRow key={resource.id} hover onClick={() => navigate(`/resources/${resource.id}`)} sx={{ cursor: 'pointer' }}>
                    <TableCell>{resource.name}</TableCell>
                    <TableCell>{resource.resource_type}</TableCell>
                    <TableCell>{resource.protocol}</TableCell>
                    <TableCell>{resource.host}</TableCell>
                    <TableCell>{resource.port || '—'}</TableCell>
                    <TableCell sx={{ textTransform: 'capitalize' }}>{resource.status}</TableCell>
                    <TableCell>{resource.use_gateway ? 'Gateway' : 'Direct'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Panel>
      )}

      {!loading && servers.length > 0 && (
        <Panel sx={{ mb: 3 }} basis={0}>
          <SectionHeader icon={Activity} title="Performance Analytics" subtitle="Resource utilization across connected nodes" />
          <Box sx={{ height: 400, mt: 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analyticsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" vertical={false} stroke={gridStroke} />
                <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} unit="%" />
                <Tooltip cursor={{ fill: theme.palette.action.hover }} contentStyle={tooltipStyle} />
                <Legend iconType="square" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 24, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                <Bar dataKey="CPU" fill="#3b82f6" radius={0} maxBarSize={30} />
                <Bar dataKey="Memory" fill="#10b981" radius={0} maxBarSize={30} />
                <Bar dataKey="Disk" fill="#f59e0b" radius={0} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Panel>
      )}

      {!loading && logStats !== null && (
        <Panel sx={{ mb: 3 }} basis={0}>
          <SectionHeader
            icon={ScrollText}
            title="Log Volume & Error Rate"
            subtitle={
              logStats.totals.error + logStats.totals.warn + logStats.totals.info === 0
                ? `No log activity in the last ${timeRangeLabel}`
                : `${logStats.totals.error} error · ${logStats.totals.warn} warn · ${logStats.totals.info} info — last ${timeRangeLabel}, fleet-wide`
            }
            action={<RangeSelector value={fleetRange} onChange={setFleetRange} ranges={RANGES} />}
          />
          <Box sx={{ height: 260, mt: 1 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={logStats.buckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" vertical={false} stroke={gridStroke} />
                {xAxis}
                <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                <Tooltip labelFormatter={(t) => fmtClock(t)} cursor={{ fill: theme.palette.action.hover }} contentStyle={tooltipStyle} />
                <Legend iconType="square" align="right" verticalAlign="top" wrapperStyle={{ paddingBottom: 24, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                <Bar dataKey="info" name="Info" stackId="logs" fill={theme.palette.text.disabled} radius={0} maxBarSize={30} />
                <Bar dataKey="warn" name="Warn" stackId="logs" fill={theme.palette.warning.main} radius={0} maxBarSize={30} />
                <Bar dataKey="error" name="Error" stackId="logs" fill={theme.palette.error.main} radius={0} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Panel>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Skeleton variant="rectangular" height={160} />
          <Skeleton variant="rectangular" height={400} />
        </Box>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No infrastructure connected"
          description="Begin by adding a standalone server or a Kubernetes cluster to monitor your fleet."
          action={
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Button onClick={() => navigate('/servers?add=1')}>Add Standard Server</Button>
              <Button variant="secondary" onClick={() => navigate('/kubernetes')}>Add K8s Cluster</Button>
            </Box>
          }
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {k8sList.length > 0 && (
            <Box>
              <SectionHeader icon={KubernetesIcon} title="Managed Clusters" action={<Chip label={`${k8sList.length} Active`} color="primary" size="small" />} />
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 2 }}>
                {k8sList.map(s => <ServerCard key={s.id} server={s} metric={metrics[s.id]} />)}
              </Box>
            </Box>
          )}

          {nodeList.length > 0 && (
            <Box>
              <SectionHeader icon={Server} title="Resource Fleet" action={<Chip label={`${nodeList.length} Nodes`} variant="outlined" size="small" />} />
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 2 }}>
                {nodeList.map(s => <ServerCard key={s.id} server={s} metric={metrics[s.id]} />)}
              </Box>
            </Box>
          )}

          {filteredServers.length === 0 && searchQuery && (
            <EmptyState
              icon={Search}
              title={`No results for "${searchQuery}"`}
              action={<Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>Clear Filter</Button>}
            />
          )}
        </Box>
      )}
    </div>
  )
}
