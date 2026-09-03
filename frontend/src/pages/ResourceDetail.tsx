import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Database, Shield, CheckCircle2, ShieldCheck, Trash2, Plus, Clock3,
  Play, Table, Loader2, Globe, Activity, User, Lock, History, Code, RefreshCw,
  Gauge, Zap, Layers, Cpu, CircleDot, AlertTriangle, HardDrive
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from 'recharts'
import { api } from '../api/client'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import { format } from 'date-fns'
import { apiError } from '../utils/errors'
import type { IconComponent } from '../types/k8s'

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
type ResourceTab = 'observability' | 'overview' | 'query' | 'access' | 'audit'

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

function statusMeta(status?: string) {
  switch (status) {
    case 'online': return { color: 'var(--success)', label: 'Online', badge: 'badge-online' }
    case 'degraded': return { color: 'var(--warning)', label: 'Degraded', badge: 'badge-warning' }
    case 'offline': return { color: 'var(--danger)', label: 'Offline', badge: 'badge-offline' }
    default: return { color: 'var(--text-muted)', label: 'Unknown', badge: 'badge-neutral' }
  }
}

export function ResourceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const { can } = usePermission()
  const canManage = can('manage-resources')

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

  // Query state
  const [sql, setSql] = useState('SELECT * FROM users LIMIT 10;')
  const [queryResult, setQueryResult] = useState<{ type?: string; columns?: string[]; rows?: Record<string, unknown>[]; rows_affected?: number } | null>(null)
  const [runningQuery, setRunningQuery] = useState(false)

  const isSqlable = resource?.protocol === 'postgres'

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
  async function runQuery() {
    if (!sql.trim()) return
    setRunningQuery(true); setQueryResult(null)
    try {
      setQueryResult((await api.post(`/api/resources/${id}/query`, { sql })).data)
      toast.success('Query executed', 'The operation completed.')
      loadAudit()
    } catch (err: unknown) { toast.error('Query failed', apiError(err) || 'Unable to execute SQL') }
    finally { setRunningQuery(false) }
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
        <Loader2 size={32} className="spin" color="var(--brand-primary)" />
        <span style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>Loading resource…</span>
      </div>
    )
  }

  const tabs = [
    { id: 'observability', label: 'Observability', icon: Gauge },
    { id: 'overview', label: 'Overview', icon: Database },
    ...(isSqlable ? [{ id: 'query', label: 'SQL Console', icon: Code }] : []),
    { id: 'access', label: 'Access', icon: Lock },
    { id: 'audit', label: 'Audit Log', icon: History },
  ]

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn-icon-sm" onClick={() => navigate('/resources')} title="Back"><ArrowLeft size={14} /></button>
          <div style={{ width: 46, height: 46, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={22} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title">{resource?.name || 'Resource'}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
              <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{resource?.resource_type}</span>
              <span className={`badge ${st.badge}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CircleDot size={11} /> {st.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{resource?.protocol}://{resource?.host}:{resource?.port}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tabs-container tabs-scroll-x" style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as ResourceTab)}
            style={{
              border: 'none', background: 'transparent', margin: 0, padding: '11px 20px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--brand-primary)' : '2px solid transparent',
            }}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Observability ── */}
      {activeTab === 'observability' && (
        <div>
          {/* Status hero */}
          <div className="card" style={{ padding: '18px 22px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span className={st.label === 'Online' ? 'pulse-dot' : ''} style={{ width: 11, height: 11, borderRadius: '50%', background: st.color, boxShadow: `0 0 0 4px ${st.color}22` }} />
                <span style={{ fontSize: 16, fontWeight: 700, color: st.color }}>{st.label}</span>
              </span>
              <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
              <HeroStat label="Latency" value={live ? fmtMs(live.latency_ms) : '—'} />
              <HeroStat label="Avail 1h" value={uptimePct !== null ? `${uptimePct}%` : '—'} />
              {typeof live?.metrics?.uptime_seconds === 'number' && <HeroStat label="Uptime" value={fmtDuration(Number(live.metrics.uptime_seconds))} />}
              {Boolean(live?.metrics?.version) && <HeroStat label="Version" value={`v${String(live?.metrics?.version)}`} />}
              {Boolean(live?.metrics?.banner) && <HeroStat label="Banner" value={String(live?.metrics?.banner)} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Auto-refresh
              </label>
              <button className="btn btn-secondary btn-sm" onClick={() => probe(true)} disabled={probing} style={{ height: 34 }}>
                {probing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                <span style={{ marginLeft: 6 }}>Refresh</span>
              </button>
            </div>
          </div>

          {live?.error && (
            <div className="card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-glow)', display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 20, padding: 16 }}>
              <AlertTriangle size={16} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13.5, color: 'var(--danger)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>{live.error}</span>
            </div>
          )}

          {/* Connection utilization gauge */}
          {connUtil && (
            <div className="card" style={{ padding: '18px 22px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Connection pool</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{connUtil.used}</span> / {connUtil.max} · {connUtil.pct}%
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(connUtil.pct, 100)}%`, height: '100%', background: connUtil.pct >= 90 ? 'var(--danger)' : connUtil.pct >= 70 ? 'var(--warning)' : 'var(--success)', transition: 'width .4s' }} />
              </div>
            </div>
          )}

          {/* Trends — small multiples built from probe history */}
          {trendDefs.length > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(258px, 100%), 1fr))', gap: 16, marginBottom: extras.length ? 16 : 0 }}>
                {trendDefs.map(def => (
                  <TrendChart key={def.key} def={def} points={def.rate ? toRate(series[def.key]) : series[def.key]} />
                ))}
              </div>
              {extras.length > 0 && (
                <div className="card" style={{ padding: '16px 20px', marginBottom: bucketNames.length ? 16 : 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 12 }}>Current snapshot</div>
                  <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
                    {extras.map(([label, value]) => (
                      <span key={label} style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</span>
                        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {bucketNames.length > 0 && (
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 12 }}>Buckets ({bucketNames.length})</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {bucketNames.map(name => (
                      <span key={name} className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{name}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : !probing ? (
            <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <Gauge size={36} style={{ opacity: 0.25, marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>{st.label === 'Offline' ? 'Resource is unreachable' : 'Collecting metrics…'}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{st.label === 'Offline' ? 'Check host, port, and credentials — the error is shown above.' : 'Trend charts fill in as the collector samples every 60s.'}</div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Overview ── */}
      {activeTab === 'overview' && (
        <div>
          <div className="grid-stats-4" style={{ marginBottom: 24 }}>
            <MiniStat icon={Globe} label="Host" value={resource?.host || '—'} mono />
            <MiniStat icon={Shield} label="Protocol" value={resource?.protocol || '—'} />
            <MiniStat icon={ShieldCheck} label="Gateway" value={resource?.use_gateway ? 'Enabled' : 'Direct'} />
            <MiniStat icon={User} label="Users with access" value={String(assignedUsers)} />
          </div>
          <div className="resource-overview-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 }}>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <Activity size={16} color="var(--brand-primary)" />
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>Configuration</h3>
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <InfoBlock label="Type" value={resource?.resource_type} />
                <InfoBlock label="Protocol" value={resource?.protocol} />
                <InfoBlock label="Port" value={String(resource?.port)} mono />
                <InfoBlock label="Auth" value={resource?.auth_type} />
                <InfoBlock label="Username" value={resource?.username || 'anonymous'} />
                {isSqlable && <InfoBlock label="Database" value={resource?.database || 'postgres'} />}
              </div>
              <div style={{ marginTop: 20 }}>
                <div className="input-label" style={{ marginBottom: 8 }}>Description</div>
                <div style={{ padding: 14, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 13.5, color: 'var(--text-secondary)' }}>
                  {resource?.description || 'No description provided.'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <Layers size={16} color="var(--brand-primary)" />
                  <h3 style={{ fontSize: 13, fontWeight: 700 }}>Tags</h3>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {resource?.tags ? resource.tags.split(',').filter(Boolean).map(tag => (
                    <span key={tag} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>{tag.trim()}</span>
                  )) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No tags.</span>}
                </div>
              </div>
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <Clock3 size={16} color="var(--brand-primary)" />
                  <h3 style={{ fontSize: 13, fontWeight: 700 }}>Timeline</h3>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <div className="input-label">Created</div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{resource?.created_at ? format(new Date(resource.created_at), 'PPP p') : '—'}</div>
                  </div>
                  <div>
                    <div className="input-label">Last updated</div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{resource?.updated_at ? format(new Date(resource.updated_at), 'PPP p') : '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SQL Console ── */}
      {activeTab === 'query' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Code size={16} color="var(--brand-primary)" />
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>SQL Console</h3>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>Run ad-hoc queries. Every query is recorded in the audit log.</p>
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={runQuery} disabled={runningQuery} style={{ height: 34 }}>
              {runningQuery ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              <span style={{ marginLeft: 6 }}>{runningQuery ? 'Running…' : 'Run'}</span>
            </button>
          </div>
          <textarea className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5, minHeight: 150, background: 'var(--bg-app)', border: '1px solid var(--border)', padding: 14 }}
            value={sql} onChange={(e) => setSql(e.target.value)} placeholder="SELECT * FROM table LIMIT 10;" />

          {queryResult && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Table size={14} color="var(--brand-primary)" />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Result</span>
                </div>
                <span className="badge badge-neutral">
                  {queryResult.type === 'select' ? `${queryResult.rows?.length || 0} rows` : `${queryResult.rows_affected || 0} rows affected`}
                </span>
              </div>
              {queryResult.type === 'select' ? (
                <div className="table-container">
                  <table className="k-table">
                    <thead><tr>{queryResult.columns?.map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {queryResult.rows?.length === 0 ? (
                        <tr><td colSpan={queryResult.columns?.length} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No rows returned</td></tr>
                      ) : queryResult.rows?.map((row: Record<string, unknown>, i: number) => (
                        <tr key={i}>{queryResult.columns?.map((c: string) => <td key={c} style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{String(row[c])}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 28, background: 'var(--bg-elevated)', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <CheckCircle2 size={28} style={{ color: 'var(--success)', margin: '0 auto 10px' }} />
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Success</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{queryResult.rows_affected} rows modified</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Access ── */}
      {activeTab === 'access' && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <Lock size={16} color="var(--brand-primary)" />
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>Access control</h3>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>Grant users read, write, or admin access to this resource.</p>
            </div>
          </div>

          {canManage && (
            <div className="resource-access-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr 200px 150px', alignItems: 'end', padding: 18, background: 'var(--bg-elevated)', border: '1px solid var(--border)', marginBottom: 20 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">User</label>
                <select className="input" value={assignUserId} onChange={(e) => setAssignUserId(Number(e.target.value) || '')}>
                  <option value="">Select a user…</option>
                  {users.filter(u => !accessRecords.some(a => a.user_id === u.id)).map(u => (
                    <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                  ))}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Access level</label>
                <select className="input" value={assignLevel} onChange={(e) => setAssignLevel(e.target.value)}>
                  {accessLevels.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" onClick={assignAccess} disabled={savingAccess} style={{ height: 40 }}>
                {savingAccess ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                <span style={{ marginLeft: 6 }}>Grant</span>
              </button>
            </div>
          )}

          <div className="table-container">
            <table className="k-table">
              <thead><tr>
                <th>User</th><th>Role</th><th>Access</th><th>Granted</th>{canManage && <th></th>}
              </tr></thead>
              <tbody>
                {accessRecords.length === 0 ? (
                  <tr><td colSpan={canManage ? 5 : 4} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No users have access yet.</td></tr>
                ) : accessRecords.map(entry => (
                  <tr key={entry.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{entry.user?.username || 'unknown'}</div>
                      {entry.user?.email && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{entry.user.email}</div>}
                    </td>
                    <td><span className="badge badge-neutral">{entry.user?.role || '—'}</span></td>
                    <td><span className={`badge ${entry.access_level === 'admin' ? 'badge-info' : entry.access_level === 'write' ? 'badge-warning' : 'badge-neutral'}`}>{entry.access_level}</span></td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{entry.created_at ? format(new Date(entry.created_at), 'PP') : '—'}</td>
                    {canManage && (
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn-icon-sm danger" title="Revoke" onClick={() => revokeAccess(entry.id)} disabled={revokingId === entry.id}>
                          {revokingId === entry.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Audit ── */}
      {activeTab === 'audit' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <History size={16} color="var(--brand-primary)" />
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>Audit log</h3>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>Every access change and query on this resource.</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                Since <input type="date" className="input" style={{ height: 32, fontSize: 12, width: 130, padding: '0 8px' }} value={auditSince} onChange={(e) => setAuditSince(e.target.value)} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                Until <input type="date" className="input" style={{ height: 32, fontSize: 12, width: 130, padding: '0 8px' }} value={auditUntil} onChange={(e) => setAuditUntil(e.target.value)} />
              </label>
              <select className="input" style={{ height: 32, fontSize: 12, width: 80, padding: '0 8px' }} value={auditLimit} onChange={(e) => setAuditLimit(Number(e.target.value))}>
                <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
              </select>
              <button className="btn-icon-sm" onClick={() => loadAudit()} disabled={loadingAudit} title="Refresh">
                {loadingAudit ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              </button>
            </div>
          </div>
          <div className="table-container">
            <table className="k-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {loadingAudit && audits.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 48, textAlign: 'center' }}><Loader2 size={22} className="spin" style={{ margin: '0 auto' }} /></td></tr>
                ) : audits.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No audit records.</td></tr>
                ) : audits.map(entry => (
                  <tr key={entry.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{format(new Date(entry.created_at), 'MM/dd HH:mm:ss')}</td>
                    <td style={{ fontWeight: 600 }}>{entry.performed_by || 'system'}</td>
                    <td><span className="badge badge-neutral">{entry.action.replace(/_/g, ' ')}</span></td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{renderAuditDetails(entry.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .info-block { padding: 14px; border: 1px solid var(--border); background: var(--bg-elevated); display: flex; flex-direction: column; gap: 4px; }
        .pulse-dot { animation: pulseDot 2s ease-in-out infinite; }
        @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        @media (max-width: 900px) { .resource-overview-grid { grid-template-columns: 1fr !important; } .resource-access-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</span>
    </span>
  )
}

// A single small-multiple: metric label, current value, and a sparkline trend.
function TrendChart({ def, points }: { def: TrendDef; points: { t: number; v: number }[] }) {
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
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{def.label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', margin: '6px 0 10px' }}>{trendFmt(def, cur)}</div>
      <div style={{ height: 64 }}>
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
            <Tooltip labelFormatter={(t) => format(new Date(t), 'HH:mm:ss')} formatter={(v) => [trendFmt(def, Number(v)), def.label]}
              contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 0, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
            <Area type="monotone" dataKey="v" stroke={def.color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function MiniStat({ icon: Icon, label, value, mono }: { icon: IconComponent; label: string; value: string; mono?: boolean }) {
  return (
    <div className="card stat-card">
      <div className="stat-icon-wrapper"><Icon size={18} /></div>
      <div className="stat-val-group">
        <div className="stat-value" style={{ fontSize: 13, fontFamily: mono ? 'var(--font-mono)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

function InfoBlock({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="info-block">
      <strong style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</strong>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value || '—'}</span>
    </div>
  )
}
