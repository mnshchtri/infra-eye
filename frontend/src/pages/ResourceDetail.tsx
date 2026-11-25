import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Database, Shield, ShieldCheck, Trash2, Plus, Clock3,
  Table as TableIcon, Globe, Activity, User, Lock, History, Code, RefreshCw,
  Gauge, Zap, Layers, Cpu, AlertTriangle, HardDrive, KeyRound,
} from 'lucide-react'
import {
  Alert, Box, Card, Checkbox, Chip, CircularProgress, FormControlLabel, IconButton, LinearProgress, MenuItem,
  Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip as MuiTooltip, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Button, EmptyState, StatCard, TabSwitcher } from '../components/ui'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from 'recharts'
import { api } from '../api/client'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import { format } from 'date-fns'
import { apiError } from '../utils/errors'
import type { IconComponent } from '../types/k8s'
import { SchemaTree } from '../components/database/SchemaTree'
import { DataGrid } from '../components/database/DataGrid'
import { SqlConsole } from '../components/database/SqlConsole'
import { RedisBrowser } from '../components/database/RedisBrowser'
import { KafkaBrowser } from '../components/database/KafkaBrowser'

interface ResourceDetailData {
  id: number; name: string; description?: string; tags?: string
  resource_type: string; protocol: string; host: string; port: number
  username?: string; auth_type: string; use_gateway: boolean; status: string
  database?: string; created_at?: string; updated_at?: string
}
interface UserData { id: number; username: string; email?: string; role: string }
interface AccessEntry { id: number; resource_id: number; user_id: number; access_level: string; user?: UserData; created_at?: string }
interface AuditEntry { id: number; resource_id: number; user_id: number; action: string; details: string; performed_by: string; created_at: string }
interface MetricRow { id: number; timestamp: string; status: string; latency_ms: number; error?: string; metrics: string }
type ResourceTab = 'observability' | 'overview' | 'database' | 'redis' | 'kafka' | 'access' | 'audit'

interface LiveProbe { status: string; latency_ms: number; error?: string; metrics: Record<string, unknown> }

const accessLevels = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read + write' },
  { value: 'admin', label: 'Admin' },
]

const protoIcon: Record<string, IconComponent> = {
  postgres: Database, mysql: Database, redis: Zap, kafka: Layers, minio: HardDrive, http: Globe, https: Globe,
}

// How to render each known metric key: label, unit, and formatter.
interface TrendDef { key: string; label: string; unit?: string; color: string; rate?: boolean; domainMax?: number; clamp?: boolean; fmt?: (v: number) => string }

// Priority-ordered catalog of metrics worth charting over time. Only those with
// data get rendered, so the same list works for Postgres, Redis, Kafka, etc.
const TREND_CATALOG: TrendDef[] = [
  { key: 'latency', label: 'Latency', color: 'var(--brand-primary)', clamp: true, fmt: fmtMs },
  { key: 'connections', label: 'Connections', color: 'var(--info)' },
  { key: 'active_queries', label: 'Active queries', color: 'var(--warning)' },
  { key: 'cache_hit_pct', label: 'Cache hit rate', unit: '%', color: 'var(--success)', domainMax: 100 },
  { key: 'commits_total', label: 'Transactions', unit: '/s', color: 'var(--brand-light)', rate: true },
  { key: 'longest_query_sec', label: 'Longest query', unit: 's', color: 'var(--danger)' },
  { key: 'db_size_mb', label: 'Database size', unit: 'MB', color: 'var(--info)' },
  { key: 'memory_used_mb', label: 'Memory used', unit: 'MB', color: 'var(--info)' },
  { key: 'ops_per_sec', label: 'Ops / sec', color: 'var(--brand-light)' },
  { key: 'hit_rate_pct', label: 'Cache hit rate', unit: '%', color: 'var(--success)', domainMax: 100 },
  { key: 'commands_total', label: 'Commands', unit: '/s', color: 'var(--brand-light)', rate: true },
  { key: 'keys', label: 'Keys', color: 'var(--info)' },
  { key: 'capacity_gb', label: 'Total capacity', unit: 'GB', color: 'var(--info)' },
  { key: 'used_pct', label: 'Capacity used', unit: '%', color: 'var(--warning)', domainMax: 100 },
]
const TREND_KEYS = new Set(TREND_CATALOG.map(d => d.key))

// Numeric metrics without a dedicated chart, shown as compact snapshot chips.
const EXTRA_SPEC: Record<string, string> = {
  idle_connections: 'Idle connections',
  idle_in_txn: 'Idle in txn',
  rollbacks_total: 'Rollbacks',
  evicted_keys: 'Evicted keys',
  blocked_clients: 'Blocked clients',
  brokers: 'Brokers',
  topics: 'Topics',
  partitions: 'Partitions',
  http_status: 'HTTP status',
  response_time_ms: 'Response time',
  buckets: 'Buckets',
  objects: 'Objects',
  usage_mb: 'Usage (MB)',
  disks_online: 'Disks online',
  disks_total: 'Disks total',
}

// Convert a cumulative counter series into a per-second rate series.
function toRate(pts: { t: number; v: number }[]): { t: number; v: number }[] {
  if (!pts || pts.length < 2) return []
  const out: { t: number; v: number }[] = []
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000
    const dv = pts[i].v - pts[i - 1].v
    out.push({ t: pts[i].t, v: dt > 0 && dv >= 0 ? Math.round((dv / dt) * 10) / 10 : 0 })
  }
  return out
}

function trendFmt(def: TrendDef, v: number) {
  if (def.fmt) return def.fmt(v)
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1)
  if (!def.unit) return n
  return def.unit === '%' || def.unit === '/s' ? n + def.unit : `${n} ${def.unit}`
}

function fmtMs(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`
  return `${Math.round(ms)}ms`
}

function fmtDuration(sec: number) {
  if (!sec || sec < 0) return '—'
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function statusMeta(status?: string): { color: string; chip: 'success' | 'warning' | 'error' | 'default'; label: string } {
  switch (status) {
    case 'online': return { color: 'success.main', chip: 'success', label: 'Online' }
    case 'degraded': return { color: 'warning.main', chip: 'warning', label: 'Degraded' }
    case 'offline': return { color: 'error.main', chip: 'error', label: 'Offline' }
    default: return { color: 'text.disabled', chip: 'default', label: 'Unknown' }
  }
}

export function ResourceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const { can } = usePermission()
  const canManage = can('manage-resources')
  const theme = useTheme()

  const [resource, setResource] = useState<ResourceDetailData | null>(null)
  const [accessRecords, setAccessRecords] = useState<AccessEntry[]>([])
  const [users, setUsers] = useState<UserData[]>([])
  const [audits, setAudits] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<ResourceTab>('observability')
  const [assignUserId, setAssignUserId] = useState<number | ''>('')
  const [assignLevel, setAssignLevel] = useState('read')
  const [savingAccess, setSavingAccess] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  // Observability state
  const [live, setLive] = useState<LiveProbe | null>(null)
  const [history, setHistory] = useState<MetricRow[]>([])
  const [probing, setProbing] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Audit filters
  const [auditLimit, setAuditLimit] = useState(20)
  const [auditSince, setAuditSince] = useState('')
  const [auditUntil, setAuditUntil] = useState('')
  const [loadingAudit, setLoadingAudit] = useState(false)

  // Database tab state
  const [selectedTable, setSelectedTable] = useState<{ schema: string; table: string } | null>(null)
  const [dbView, setDbView] = useState<'browse' | 'console'>('browse')

  const isSqlable = ['postgres', 'postgresql', 'mysql', 'mariadb'].includes(resource?.protocol ?? '')
  const isRedis = resource?.protocol === 'redis'
  const isKafka = resource?.protocol === 'kafka'

  useEffect(() => { if (id) loadPageData() }, [id])
  useEffect(() => { if (activeTab === 'audit') loadAudit() }, [auditLimit, auditSince, auditUntil, activeTab])

  const probe = useCallback(async (showToast = false) => {
    if (!id) return
    setProbing(true)
    try {
      const [snap, hist] = await Promise.all([
        api.get(`/api/resources/${id}/observe`),
        api.get(`/api/resources/${id}/metrics`, { params: { minutes: 60 } }),
      ])
      setLive(snap.data)
      setHistory(hist.data || [])
      if (showToast) toast.success('Refreshed', 'Latest reading captured.')
    } catch (err: unknown) {
      if (showToast) toast.error('Probe failed', apiError(err) || 'Unable to probe resource')
    } finally { setProbing(false) }
  }, [id])

  // Auto-refresh the observability tab every 20s.
  useEffect(() => {
    if (activeTab !== 'observability' || !autoRefresh) return
    const t = setInterval(() => probe(false), 20000)
    return () => clearInterval(t)
  }, [activeTab, autoRefresh, probe])

  async function loadPageData() {
    setLoading(true)
    await Promise.all([loadResource(), loadAccess(), loadAudit(), loadUsers(), probe(false)])
    setLoading(false)
  }

  async function loadResource() {
    try { setResource((await api.get(`/api/resources/${id}`)).data) }
    catch (err: unknown) { toast.error('Load failed', apiError(err) || 'Unable to load resource') }
  }
  async function loadAudit() {
    if (!id) return
    setLoadingAudit(true)
    try {
      const params: Record<string, unknown> = { limit: auditLimit }
      if (auditSince) params.since = new Date(auditSince).toISOString()
      if (auditUntil) params.until = new Date(auditUntil).toISOString()
      setAudits((await api.get(`/api/resources/${id}/audit`, { params })).data || [])
    } catch (err: unknown) { toast.error('Audit load failed', apiError(err) || 'Unable to load audit history') }
    finally { setLoadingAudit(false) }
  }
  async function loadAccess() {
    if (!id) return
    try { setAccessRecords((await api.get(`/api/resources/${id}/access`)).data || []) }
    catch (err: unknown) { toast.error('Access load failed', apiError(err) || 'Unable to load access records') }
  }
  async function loadUsers() {
    if (!canManage) return
    try { setUsers((await api.get('/api/users')).data || []) }
    catch (err: unknown) { toast.error('User list failed', apiError(err) || 'Unable to load users') }
  }

  async function assignAccess() {
    if (!assignUserId) { toast.error('Select a user', 'Choose a user to grant access.'); return }
    setSavingAccess(true)
    try {
      await api.post(`/api/resources/${id}/access`, { user_id: assignUserId, access_level: assignLevel })
      toast.success('Access granted', 'User access assigned.')
      setAssignUserId(''); setAssignLevel('read')
      await Promise.all([loadAccess(), loadAudit()])
    } catch (err: unknown) { toast.error('Grant failed', apiError(err) || 'Unable to assign access') }
    finally { setSavingAccess(false) }
  }
  async function revokeAccess(accessId: number) {
    setRevokingId(accessId)
    try {
      await api.delete(`/api/resources/${id}/access/${accessId}`)
      toast.success('Access revoked', 'User access removed.')
      await Promise.all([loadAccess(), loadAudit()])
    } catch (err: unknown) { toast.error('Revoke failed', apiError(err) || 'Unable to revoke access') }
    finally { setRevokingId(null) }
  }

  const assignedUsers = accessRecords.length
  const st = statusMeta(live?.status || resource?.status)
  const Icon = protoIcon[resource?.protocol || ''] || Cpu

  const uptimePct = useMemo(() => {
    if (history.length === 0) return null
    const ok = history.filter(h => h.status === 'online').length
    return Math.round((ok / history.length) * 100)
  }, [history])

  // Per-metric numeric time-series parsed from probe history (+ latency), so any
  // gauge the probe records becomes a trend chart automatically.
  const series = useMemo(() => {
    const map: Record<string, { t: number; v: number }[]> = {}
    history.forEach(h => {
      const t = new Date(h.timestamp).getTime()
      ;(map.latency ||= []).push({ t, v: Math.round(h.latency_ms * 10) / 10 })
      let m: Record<string, unknown> = {}
      try { m = JSON.parse(h.metrics || '{}') } catch { /* skip bad row */ }
      Object.entries(m).forEach(([k, v]) => { if (typeof v === 'number') (map[k] ||= []).push({ t, v }) })
    })
    return map
  }, [history])

  // Which catalogued metrics actually have data (rates need ≥2 samples).
  const trendDefs = useMemo(
    () => TREND_CATALOG.filter(d => { const s = series[d.key]; return s && s.length >= (d.rate ? 2 : 1) }),
    [series]
  )

  // Remaining numeric metrics without a dedicated chart → compact snapshot chips.
  const extras = useMemo(() => {
    const m = live?.metrics || {}
    const out: [string, string][] = []
    Object.entries(m).forEach(([k, v]) => {
      if (typeof v !== 'number') return
      if (TREND_KEYS.has(k) || k === 'connections' || k === 'max_connections' || k === 'uptime_seconds') return
      const label = EXTRA_SPEC[k] || k.replace(/_/g, ' ')
      out.push([label, k === 'response_time_ms' ? fmtMs(v) : Number.isInteger(v) ? String(v) : v.toFixed(1)])
    })
    return out
  }, [live])

  const bucketNames: string[] = Array.isArray(live?.metrics?.bucket_names) ? live!.metrics.bucket_names : []

  // Connection utilization (used vs max) — rendered as a prominent gauge card.
  const connUtil = useMemo(() => {
    const m = live?.metrics || {}
    if (typeof m.connections !== 'number' || typeof m.max_connections !== 'number' || m.max_connections <= 0) return null
    return { used: m.connections, max: m.max_connections, pct: Math.round((m.connections / m.max_connections) * 100) }
  }, [live])

  const renderAuditDetails = (details: string) => {
    try { return JSON.parse(details).message || details } catch { return details }
  }

  if (loading && !resource) {
    return (
      <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Loading resource…</Typography>
      </div>
    )
  }

  const tabs = [
    { id: 'observability', label: 'Observability', icon: Gauge },
    { id: 'overview', label: 'Overview', icon: Database },
    ...(isSqlable ? [{ id: 'database', label: 'Database', icon: Code }] : []),
    ...(isRedis ? [{ id: 'redis', label: 'Keys', icon: KeyRound }] : []),
    ...(isKafka ? [{ id: 'kafka', label: 'Topics', icon: Layers }] : []),
    { id: 'access', label: 'Access', icon: Lock },
    { id: 'audit', label: 'Audit Log', icon: History },
  ]

  const label = (t: string) => (
    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{t}</Typography>
  )
  const panelTitle = (Ico: IconComponent, title: string, sub?: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <Box sx={{ color: 'primary.main', display: 'flex' }}><Ico size={16} /></Box>
      <Box>
        <Typography variant="subtitle1" component="h3">{title}</Typography>
        {sub && <Typography variant="body2" color="text.secondary">{sub}</Typography>}
      </Box>
    </Box>
  )

  return (
    <div className="page">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5 }}>
        <MuiTooltip title="Back to resources">
          <IconButton onClick={() => navigate('/resources')} aria-label="Back to resources"><ArrowLeft size={16} /></IconButton>
        </MuiTooltip>
        <Box sx={{ width: 46, height: 46, borderRadius: 1, border: 1, borderColor: 'divider', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'primary.main' }}>
          <Icon size={22} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" noWrap>{resource?.name || 'Resource'}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
            <Chip label={resource?.resource_type} variant="outlined" size="small" />
            <Chip label={st.label} color={st.chip} size="small" variant={st.chip === 'default' ? 'outlined' : 'filled'} />
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
              {resource?.protocol}://{resource?.host}:{resource?.port}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mb: 3 }}>
        <TabSwitcher
          tabs={tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
          active={activeTab}
          onChange={id => setActiveTab(id as ResourceTab)}
        />
      </Box>

      {/* ── Observability ── */}
      {activeTab === 'observability' && (
        <Box>
          <Card sx={{ px: 2.5, py: 2, mb: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 11, height: 11, borderRadius: '50%', bgcolor: st.color, boxShadow: 4 }} className={st.label === 'Online' ? 'pulse-dot' : ''} />
                <Typography variant="h6" sx={{ color: st.color }}>{st.label}</Typography>
              </Box>
              <Box sx={{ width: '1px', height: 22, bgcolor: 'divider' }} />
              <HeroStat label="Latency" value={live ? fmtMs(live.latency_ms) : '—'} />
              <HeroStat label="Avail 1h" value={uptimePct !== null ? `${uptimePct}%` : '—'} />
              {typeof live?.metrics?.uptime_seconds === 'number' && <HeroStat label="Uptime" value={fmtDuration(Number(live.metrics.uptime_seconds))} />}
              {Boolean(live?.metrics?.version) && <HeroStat label="Version" value={`v${String(live?.metrics?.version)}`} />}
              {Boolean(live?.metrics?.banner) && <HeroStat label="Banner" value={String(live?.metrics?.banner)} />}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <FormControlLabel
                control={<Checkbox checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />}
                label="Auto-refresh"
                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 13, color: 'text.secondary' } }}
              />
              <Button variant="secondary" size="sm" loading={probing} icon={<RefreshCw size={14} />} onClick={() => probe(true)}>Refresh</Button>
            </Box>
          </Card>

          {live?.error && (
            <Alert severity="error" icon={<AlertTriangle size={16} />} sx={{ mb: 2.5, '& .MuiAlert-message': { fontFamily: 'var(--font-mono)', wordBreak: 'break-word' } }}>
              {live.error}
            </Alert>
          )}

          {connUtil && (
            <Card sx={{ px: 2.5, py: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1.5 }}>
                {label('Connection pool')}
                <Typography variant="body1" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>
                  <Typography component="span" variant="h5" color="text.primary">{connUtil.used}</Typography> / {connUtil.max} · {connUtil.pct}%
                </Typography>
              </Box>
              <LinearProgress variant="determinate" value={Math.min(connUtil.pct, 100)}
                color={connUtil.pct >= 90 ? 'error' : connUtil.pct >= 70 ? 'warning' : 'success'} sx={{ height: 8, borderRadius: 1 }} />
            </Card>
          )}

          {trendDefs.length > 0 ? (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(258px, 100%), 1fr))', gap: 2, mb: extras.length ? 2 : 0 }}>
                {trendDefs.map(def => (
                  <TrendChart key={def.key} def={def} points={def.rate ? toRate(series[def.key]) : series[def.key]}
                    tooltipStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                ))}
              </Box>
              {extras.length > 0 && (
                <Card sx={{ px: 2.5, py: 2, mb: bucketNames.length ? 2 : 0 }}>
                  <Box sx={{ mb: 1.5 }}>{label('Current snapshot')}</Box>
                  <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {extras.map(([lbl, value]) => (
                      <Box key={lbl} sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.25 }}>
                        {label(lbl)}
                        <Typography variant="h6" sx={{ fontFamily: 'var(--font-mono)' }}>{value}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Card>
              )}
              {bucketNames.length > 0 && (
                <Card sx={{ px: 2.5, py: 2 }}>
                  <Box sx={{ mb: 1.5 }}>{label(`Buckets (${bucketNames.length})`)}</Box>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {bucketNames.map(name => <Chip key={name} label={name} variant="outlined" size="small" sx={{ fontFamily: 'var(--font-mono)' }} />)}
                  </Box>
                </Card>
              )}
            </>
          ) : !probing ? (
            <Card>
              <EmptyState
                icon={Gauge}
                title={st.label === 'Offline' ? 'Resource is unreachable' : 'Collecting metrics…'}
                description={st.label === 'Offline' ? 'Check host, port, and credentials — the error is shown above.' : 'Trend charts fill in as the collector samples every 60s.'}
              />
            </Card>
          ) : null}
        </Box>
      )}

      {/* ── Overview ── */}
      {activeTab === 'overview' && (
        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 3 }}>
            <StatCard icon={Globe} label="Host" value={resource?.host || '—'} />
            <StatCard icon={Shield} label="Protocol" value={resource?.protocol || '—'} />
            <StatCard icon={ShieldCheck} label="Gateway" value={resource?.use_gateway ? 'Enabled' : 'Direct'} />
            <StatCard icon={User} label="Users with access" value={String(assignedUsers)} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.5fr 1fr' }, gap: 2.5 }}>
            <Card sx={{ p: 2.5 }}>
              <Box sx={{ mb: 2 }}>{panelTitle(Activity, 'Configuration')}</Box>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <InfoBlock label="Type" value={resource?.resource_type} />
                <InfoBlock label="Protocol" value={resource?.protocol} />
                <InfoBlock label="Port" value={String(resource?.port)} mono />
                <InfoBlock label="Auth" value={resource?.auth_type} />
                <InfoBlock label="Username" value={resource?.username || 'anonymous'} />
                {isSqlable && <InfoBlock label="Database" value={resource?.database || 'postgres'} />}
              </Box>
              <Box sx={{ mt: 2.5 }}>
                <Box sx={{ mb: 1 }}>{label('Description')}</Box>
                <Paper variant="outlined" sx={{ p: 1.75 }}>
                  <Typography variant="body1" color="text.secondary">{resource?.description || 'No description provided.'}</Typography>
                </Paper>
              </Box>
            </Card>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Card sx={{ p: 2.5 }}>
                <Box sx={{ mb: 2 }}>{panelTitle(Layers, 'Tags')}</Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {resource?.tags ? resource.tags.split(',').filter(Boolean).map(tag => (
                    <Chip key={tag} label={tag.trim()} variant="outlined" size="small" />
                  )) : <Typography variant="body2" color="text.secondary">No tags.</Typography>}
                </Box>
              </Card>
              <Card sx={{ p: 2.5 }}>
                <Box sx={{ mb: 2 }}>{panelTitle(Clock3, 'Timeline')}</Box>
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                  <Box>
                    {label('Created')}
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>{resource?.created_at ? format(new Date(resource.created_at), 'PPP p') : '—'}</Typography>
                  </Box>
                  <Box>
                    {label('Last updated')}
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>{resource?.updated_at ? format(new Date(resource.updated_at), 'PPP p') : '—'}</Typography>
                  </Box>
                </Box>
              </Card>
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Database (schema tree + data grid / SQL console) ── */}
      {activeTab === 'database' && resource && (
        <Card sx={{ display: 'flex', height: 'calc(100vh - 280px)', minHeight: 500, overflow: 'hidden' }}>
          <Box sx={{ width: 220, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflow: 'hidden' }}>
            <SchemaTree
              resourceId={resource.id}
              selected={selectedTable}
              onSelect={(schema, table) => { setSelectedTable({ schema, table }); setDbView('browse') }}
            />
          </Box>
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <TabSwitcher
              tabs={[{ id: 'browse', label: 'Data' }, { id: 'console', label: 'SQL Console' }]}
              active={dbView}
              onChange={id => setDbView(id as 'browse' | 'console')}
            />
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              {dbView === 'console' ? (
                <SqlConsole resourceId={resource.id} />
              ) : selectedTable ? (
                <DataGrid
                  resourceId={resource.id}
                  schema={selectedTable.schema}
                  table={selectedTable.table}
                  canEdit={can('manage-resources')}
                />
              ) : (
                <EmptyState icon={TableIcon} title="Select a table from the schema tree to browse its rows." />
              )}
            </Box>
          </Box>
        </Card>
      )}

      {/* ── Redis keys ── */}
      {activeTab === 'redis' && resource && (
        <Card sx={{ height: 'calc(100vh - 280px)', minHeight: 500, overflow: 'hidden' }}>
          <RedisBrowser resourceId={resource.id} canEdit={can('manage-resources')} />
        </Card>
      )}

      {/* ── Kafka topics ── */}
      {activeTab === 'kafka' && resource && (
        <Card sx={{ height: 'calc(100vh - 280px)', minHeight: 500, overflow: 'hidden' }}>
          <KafkaBrowser resourceId={resource.id} />
        </Card>
      )}

      {/* ── Access ── */}
      {activeTab === 'access' && (
        <Card sx={{ p: 2.5 }}>
          <Box sx={{ mb: 2.5 }}>{panelTitle(Lock, 'Access control', 'Grant users read, write, or admin access to this resource.')}</Box>

          {canManage && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2.5, display: 'grid', gap: 1.75, gridTemplateColumns: { xs: '1fr', md: '1fr 200px 150px' }, alignItems: 'end' }}>
              <TextField select label="User" value={assignUserId} onChange={e => setAssignUserId(Number(e.target.value) || '')}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                <MenuItem value="">Select a user…</MenuItem>
                {users.filter(u => !accessRecords.some(a => a.user_id === u.id)).map(u => (
                  <MenuItem key={u.id} value={u.id}>{u.username} ({u.role})</MenuItem>
                ))}
              </TextField>
              <TextField select label="Access level" value={assignLevel} onChange={e => setAssignLevel(e.target.value)}>
                {accessLevels.map(l => <MenuItem key={l.value} value={l.value}>{l.label}</MenuItem>)}
              </TextField>
              <Button onClick={assignAccess} loading={savingAccess} icon={<Plus size={14} />}>Grant</Button>
            </Paper>
          )}

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell><TableCell>Role</TableCell><TableCell>Access</TableCell><TableCell>Granted</TableCell>{canManage && <TableCell />}
                </TableRow>
              </TableHead>
              <TableBody>
                {accessRecords.length === 0 ? (
                  <TableRow><TableCell colSpan={canManage ? 5 : 4} align="center" sx={{ py: 4, color: 'text.secondary' }}>No users have access yet.</TableCell></TableRow>
                ) : accessRecords.map(entry => (
                  <TableRow key={entry.id} hover>
                    <TableCell>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>{entry.user?.username || 'unknown'}</Typography>
                      {entry.user?.email && <Typography variant="body2" color="text.secondary">{entry.user.email}</Typography>}
                    </TableCell>
                    <TableCell><Chip label={entry.user?.role || '—'} variant="outlined" size="small" /></TableCell>
                    <TableCell>
                      <Chip label={entry.access_level} size="small"
                        color={entry.access_level === 'admin' ? 'info' : entry.access_level === 'write' ? 'warning' : 'default'}
                        variant={entry.access_level === 'read' ? 'outlined' : 'filled'} />
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{entry.created_at ? format(new Date(entry.created_at), 'PP') : '—'}</TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <MuiTooltip title="Revoke">
                          <span>
                            <IconButton color="error" onClick={() => revokeAccess(entry.id)} disabled={revokingId === entry.id} aria-label={`Revoke ${entry.user?.username || 'user'}`}>
                              {revokingId === entry.id ? <CircularProgress size={14} /> : <Trash2 size={14} />}
                            </IconButton>
                          </span>
                        </MuiTooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* ── Audit ── */}
      {activeTab === 'audit' && (
        <Card sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5, flexWrap: 'wrap', gap: 2 }}>
            {panelTitle(History, 'Audit log', 'Every access change and query on this resource.')}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <TextField label="Since" type="date" value={auditSince} onChange={e => setAuditSince(e.target.value)} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="Until" type="date" value={auditUntil} onChange={e => setAuditUntil(e.target.value)} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField select label="Rows" value={auditLimit} onChange={e => setAuditLimit(Number(e.target.value))} sx={{ width: 90 }}>
                {[10, 20, 50, 100].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
              </TextField>
              <MuiTooltip title="Refresh">
                <span>
                  <IconButton onClick={() => loadAudit()} disabled={loadingAudit} aria-label="Refresh audit log">
                    {loadingAudit ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
                  </IconButton>
                </span>
              </MuiTooltip>
            </Box>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow><TableCell>Time</TableCell><TableCell>Actor</TableCell><TableCell>Action</TableCell><TableCell>Details</TableCell></TableRow></TableHead>
              <TableBody>
                {loadingAudit && audits.length === 0 ? (
                  <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5 }}><CircularProgress size={22} /></TableCell></TableRow>
                ) : audits.length === 0 ? (
                  <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>No audit records.</TableCell></TableRow>
                ) : audits.map(entry => (
                  <TableRow key={entry.id} hover>
                    <TableCell sx={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{format(new Date(entry.created_at), 'MM/dd HH:mm:ss')}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{entry.performed_by || 'system'}</TableCell>
                    <TableCell><Chip label={entry.action.replace(/_/g, ' ')} variant="outlined" size="small" /></TableCell>
                    <TableCell sx={{ color: 'text.secondary', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{renderAuditDetails(entry.details)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <style>{`
        .pulse-dot { animation: pulseDot 2s ease-in-out infinite; }
        @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
      `}</style>
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</Typography>
      <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{value}</Typography>
    </Box>
  )
}

// A single small-multiple: metric label, current value, and a sparkline trend.
function TrendChart({ def, points, tooltipStyle }: { def: TrendDef; points: { t: number; v: number }[]; tooltipStyle: React.CSSProperties }) {
  if (!points || points.length === 0) return null
  const cur = points[points.length - 1].v
  const vals = points.map(p => p.v)
  let domain: [number, number | string] = [0, 'auto']
  if (def.domainMax) domain = [0, def.domainMax]
  else if (def.clamp) {
    const sorted = [...vals].sort((a, b) => a - b)
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]
    domain = [0, Math.max(Math.ceil((p95 * 1.5) / 10) * 10, 10)]
  }
  const id = `tg_${def.key}`
  return (
    <Card sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{def.label}</Typography>
      <Typography variant="h4" component="div" sx={{ fontFamily: 'var(--font-mono)', my: 0.75 }}>{trendFmt(def, cur)}</Typography>
      <Box sx={{ height: 64 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={def.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={def.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={domain} allowDataOverflow />
            <XAxis dataKey="t" hide />
            <Tooltip labelFormatter={(t) => format(new Date(t), 'HH:mm:ss')} formatter={(v) => [trendFmt(def, Number(v)), def.label]} contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="v" stroke={def.color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Card>
  )
}

function InfoBlock({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</Typography>
      <Typography variant="body1" sx={{ fontWeight: 600, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value || '—'}</Typography>
    </Paper>
  )
}
