import { useEffect, useState, useRef, useMemo, memo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Box, Card, CircularProgress, Divider, IconButton, TableCell, TableRow, TextField, Tooltip, Typography, useTheme,
} from '@mui/material'
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Activity,
  ScrollText, Terminal as TerminalIcon, RefreshCw, Wifi, Shield,
  Power, Settings as SettingsIcon,
  ChevronRight, Gauge, Layers, HelpCircle,
  Trash2, Maximize2, Minimize2, Network, Users, Plus, Globe
} from 'lucide-react'
import { WindowsIcon, AppleIcon, KubernetesIcon, DistroIcon } from '../components/OSIcons'
import { StoragePanel } from '../components/storage/StoragePanel'
import { K8sStoragePanel } from '../components/storage/K8sStoragePanel'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { api, buildWsUrl } from '../api/client'
import { format } from 'date-fns'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import { apiError, errMessage } from '../utils/errors'
import { Button, EmptyState, Input, Select, TabSwitcher, SearchInput } from '../components/ui'
import {
  ConfirmDialog, DataTable, Dot, EmptyRow, LoadFailed, MonoCell, SectionCard, Tile, TileGrid, ToneChip,
  CenteredSpinner, KeyValue,
} from '../components/server/ServerParts'
import { MONO } from '../components/server/tokens'
import type { Tone } from '../components/server/tokens'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

interface Server {
  id: number; name: string; host: string; port: number; ssh_user: string;
  status: string; tags: string; description: string; auth_type: string; os: string;
  distro?: string; distro_version?: string; distro_pretty_name?: string; kernel_version?: string;
  is_k8s?: boolean;
}
interface Metric {
  id: number; timestamp: string; cpu_percent: number; mem_percent: number;
  disk_percent: number; mem_used_mb: number; mem_total_mb: number;
  disk_used_gb: number; disk_total_gb: number;
  load_avg_1: number; uptime_seconds: number; net_rx_mbps: number; net_tx_mbps: number;
}

const fmtUptime = (secs: number) => {
  if (!secs || secs <= 0) return 'N/A'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
interface LogEntry {
  id: number; timestamp: string; level: 'info' | 'warn' | 'error' | 'debug'; message: string; stream: string;
}
interface NetworkingPort {
  protocol: string; state: string; local: string; remote: string; program: string; pid: string;
}
interface NetworkingService {
  name: string; active: string; sub: string; description: string;
}
interface NetworkingInterface {
  name: string; state: string; ipv4: string; ipv6: string; mtu: string;
  rx_bytes: string; tx_bytes: string;
}
interface NetworkingInfo {
  hostname: string; uptime: string;
  ports: NetworkingPort[]; services: NetworkingService[]; interfaces: NetworkingInterface[];
}
interface K8sServicePort {
  name: string; protocol: string; port: number; target_port: string; node_port?: number;
}
interface K8sServiceInfo {
  name: string; namespace: string; type: string; cluster_ip: string; external_ips: string[]; ports: K8sServicePort[];
}
interface K8sIngressInfo {
  name: string; namespace: string; class: string; hosts: string[]; addresses: string[];
}
interface K8sNetworkPolicyInfo {
  name: string; namespace: string; pod_selector: string; policy_types: string[];
}
interface K8sNodeNetworkInfo {
  name: string; internal_ip: string; external_ip: string; pod_cidr: string; ready: boolean; kubelet_version: string;
}
interface K8sDNSInfo {
  provider: string; deployment_ready: boolean; ready_replicas: number; desired_replicas: number; cluster_ip: string;
}
interface K8sCNIInfo {
  provider: string; ready: boolean; desired: number; scheduled: number;
}
interface K8sNetworkingSummary {
  services: number; cluster_ip_services: number; node_port_services: number; load_balancer_services: number;
  ingresses: number; network_policies: number; nodes: number;
}
interface K8sNetworkingInfo {
  pod_cidrs: string[]; service_cidr: string; dns: K8sDNSInfo; cni: K8sCNIInfo;
  nodes: K8sNodeNetworkInfo[]; services: K8sServiceInfo[]; ingresses: K8sIngressInfo[];
  network_policies: K8sNetworkPolicyInfo[]; summary: K8sNetworkingSummary;
}

const fmtNetBytes = (b: string) => {
  const n = parseInt(b)
  if (isNaN(n) || n === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return (n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i]
}

const LOG_TONE: Record<LogEntry['level'], Tone> = { error: 'error', warn: 'warning', info: 'info', debug: 'default' }

const LogLine = memo(({ log }: { log: LogEntry }) => (
  <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2.5, py: 0.75, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
    <Typography component="span" color="text.secondary" sx={{ fontSize: 12, minWidth: 64, fontFamily: MONO, lineHeight: '20px' }}>
      {format(new Date(log.timestamp), 'HH:mm:ss')}
    </Typography>
    <Box sx={{ width: 56, flexShrink: 0 }}><ToneChip label={log.level} tone={LOG_TONE[log.level] ?? 'default'} /></Box>
    <Typography component="span" sx={{ fontFamily: MONO, fontSize: 13, wordBreak: 'break-all', lineHeight: '20px' }}>{log.message}</Typography>
  </Box>
))

const statusTone = (status: string): Tone => (status === 'online' ? 'success' : status === 'offline' ? 'error' : 'default')

/** Small card showing a labelled value (DNS provider, service CIDR, ...). */
function InfoTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card sx={{ p: 1.5, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, mb: 0.75 }}>{label}</Typography>
      {children}
    </Card>
  )
}

function K8sNetworkingPanel({ info, loading, onRetry }: { info: K8sNetworkingInfo | null, loading: boolean, onRetry: () => void }) {
  if (loading && !info) return <CenteredSpinner />
  if (!info) return <LoadFailed icon={Network} message="Unable to load cluster networking data" onRetry={onRetry} />

  const svcTone = (t: string): Tone => t === 'LoadBalancer' ? 'success' : t === 'NodePort' ? 'warning' : t === 'ExternalName' ? 'default' : 'info'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TileGrid>
        <Tile label="Services" value={`${info.summary.services}`} icon={Network} accent="info.main" />
        <Tile label="Ingresses" value={`${info.summary.ingresses}`} icon={Globe} accent="success.main" />
        <Tile label="Network policies" value={`${info.summary.network_policies}`} icon={Shield} />
        <Tile label="Nodes" value={`${info.summary.nodes}`} icon={Layers} accent="warning.main" />
      </TileGrid>

      {/* Cluster network config */}
      <TileGrid>
        <InfoTile label="DNS provider">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Dot tone={info.dns.deployment_ready ? 'success' : 'error'} />
            <Typography sx={{ fontFamily: MONO, fontWeight: 700 }}>{info.dns.provider}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontFamily: MONO }}>
            {info.dns.ready_replicas}/{info.dns.desired_replicas} ready{info.dns.cluster_ip ? ` · ${info.dns.cluster_ip}` : ''}
          </Typography>
        </InfoTile>
        <InfoTile label="CNI plugin">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Dot tone={info.cni.ready ? 'success' : 'default'} />
            <Typography sx={{ fontFamily: MONO, fontWeight: 700 }}>{info.cni.provider}</Typography>
          </Box>
          {info.cni.desired > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontFamily: MONO }}>{info.cni.scheduled}/{info.cni.desired} pods ready</Typography>
          )}
        </InfoTile>
        <InfoTile label="Service CIDR">
          <Typography sx={{ fontFamily: MONO, fontWeight: 700, color: 'primary.main' }}>{info.service_cidr || '—'}</Typography>
        </InfoTile>
        <InfoTile label="Pod CIDR(s)">
          {info.pod_cidrs.length === 0 ? (
            <Typography color="text.secondary" sx={{ fontFamily: MONO }}>—</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {info.pod_cidrs.map(c => (
                <Typography key={c} variant="body2" sx={{ fontFamily: MONO, fontWeight: 600, color: 'primary.main' }}>{c}</Typography>
              ))}
            </Box>
          )}
        </InfoTile>
      </TileGrid>

      <SectionCard icon={Network} title="Services" count={info.services.length}>
        <DataTable label="Services" headers={['Name', 'Namespace', 'Type', 'Cluster IP', 'Ports', 'External']} maxHeight={400}>
          {info.services.length === 0 ? <EmptyRow colSpan={6} label="No services found" /> : info.services.map((s, i) => (
            <TableRow key={`${s.namespace}/${s.name}-${i}`} hover>
              <MonoCell bold>{s.name}</MonoCell>
              <MonoCell muted>{s.namespace}</MonoCell>
              <TableCell><ToneChip label={s.type} tone={svcTone(s.type)} /></TableCell>
              <MonoCell>{s.cluster_ip || '—'}</MonoCell>
              <MonoCell muted>{s.ports.length === 0 ? '—' : s.ports.map(p => `${p.port}${p.node_port ? `:${p.node_port}` : ''}/${p.protocol}`).join(', ')}</MonoCell>
              <MonoCell muted>{s.external_ips.length === 0 ? '—' : s.external_ips.join(', ')}</MonoCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard icon={Globe} title="Ingresses" count={info.ingresses.length}>
        <DataTable label="Ingresses" headers={['Name', 'Namespace', 'Class', 'Hosts', 'Address']}>
          {info.ingresses.length === 0 ? <EmptyRow colSpan={5} label="No ingresses found" /> : info.ingresses.map((ing, i) => (
            <TableRow key={`${ing.namespace}/${ing.name}-${i}`} hover>
              <MonoCell bold>{ing.name}</MonoCell>
              <MonoCell muted>{ing.namespace}</MonoCell>
              <MonoCell muted>{ing.class || '—'}</MonoCell>
              <MonoCell>{ing.hosts.length === 0 ? '—' : ing.hosts.join(', ')}</MonoCell>
              <MonoCell muted>{ing.addresses.length === 0 ? '—' : ing.addresses.join(', ')}</MonoCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard icon={Shield} title="Network policies" count={info.network_policies.length}>
        <DataTable label="Network policies" headers={['Name', 'Namespace', 'Pod selector', 'Policy types']}>
          {info.network_policies.length === 0 ? <EmptyRow colSpan={4} label="No network policies found. Traffic between pods is unrestricted." /> : info.network_policies.map((np, i) => (
            <TableRow key={`${np.namespace}/${np.name}-${i}`} hover>
              <MonoCell bold>{np.name}</MonoCell>
              <MonoCell muted>{np.namespace}</MonoCell>
              <MonoCell muted>{np.pod_selector}</MonoCell>
              <TableCell>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {np.policy_types.map(t => <ToneChip key={t} label={t} />)}
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard icon={Layers} title="Node networking" count={info.nodes.length}>
        <DataTable label="Node networking" headers={['Node', 'Internal IP', 'External IP', 'Pod CIDR', 'Kubelet']}>
          {info.nodes.length === 0 ? <EmptyRow colSpan={5} label="No nodes found" /> : info.nodes.map((n, i) => (
            <TableRow key={`${n.name}-${i}`} hover>
              <MonoCell bold>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Dot tone={n.ready ? 'success' : 'error'} />
                  {n.name}
                </Box>
              </MonoCell>
              <MonoCell>{n.internal_ip || '—'}</MonoCell>
              <MonoCell>{n.external_ip || '—'}</MonoCell>
              <MonoCell sx={{ color: 'primary.main' }}>{n.pod_cidr || '—'}</MonoCell>
              <MonoCell muted>{n.kubelet_version || '—'}</MonoCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
    </Box>
  )
}

function HostNetworkingPanel({ netInfo }: { netInfo: NetworkingInfo }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TileGrid>
        <Tile label="Listening" value={`${netInfo.ports.filter(p => p.state === 'LISTEN').length}`} icon={Network} accent="info.main" />
        <Tile label="Services" value={`${netInfo.services.filter(s => s.active === 'active').length}`} icon={Activity} accent="success.main" />
        <Tile label="Failed" value={`${netInfo.services.filter(s => s.active === 'failed').length}`} icon={Power} accent="error.main" />
        <Tile label="Interfaces" value={`${netInfo.interfaces.length}`} icon={Wifi} />
      </TileGrid>

      <SectionCard icon={Network} title="Listening ports" count={netInfo.ports.length}>
        {netInfo.ports.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No listening ports detected</Box>
        ) : (
          <DataTable label="Listening ports" headers={['Proto', 'State', 'Local address', 'Program']}>
            {netInfo.ports.map((p, i) => {
              const protoTone: Tone = (p.protocol === 'tcp' || p.protocol === 'tcp6') ? 'info' : 'warning'
              const stateTone: Tone = p.state === 'LISTEN' ? 'success' : p.state === 'ESTABLISHED' ? 'primary' : 'default'
              const localParts = p.local.split(':')
              const localPort = localParts[localParts.length - 1]
              const localAddr = localParts.slice(0, -1).join(':') || '::'
              return (
                <TableRow key={`${p.local}-${i}`} hover>
                  <TableCell><ToneChip label={p.protocol} tone={protoTone} /></TableCell>
                  <TableCell><ToneChip label={p.state} tone={stateTone} /></TableCell>
                  <MonoCell>
                    <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>{localAddr}</Box>
                    <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>:{localPort}</Box>
                  </MonoCell>
                  <MonoCell bold>{p.program || '—'}</MonoCell>
                </TableRow>
              )
            })}
          </DataTable>
        )}
      </SectionCard>

      <SectionCard icon={Activity} title="System services">
        <DataTable label="System services" headers={['Name', 'Active', 'Sub', 'Description']} maxHeight={400}>
          {netInfo.services.filter(s => s.active === 'active' || s.active === 'failed').slice(0, 30).map(s => {
            const tone: Tone = s.active === 'active' ? 'success' : 'error'
            return (
              <TableRow key={s.name} hover>
                <MonoCell bold>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Dot tone={tone} />
                    {s.name}
                  </Box>
                </MonoCell>
                <TableCell><ToneChip label={s.active} tone={tone} /></TableCell>
                <MonoCell muted>{s.sub}</MonoCell>
                <MonoCell muted sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</MonoCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>

      <SectionCard icon={Wifi} title="Network interfaces">
        <DataTable label="Network interfaces" headers={['Interface', 'IP address', 'MTU', 'Traffic']}>
          {netInfo.interfaces.map(iface => (
            <TableRow key={iface.name} hover>
              <MonoCell bold>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Dot tone={iface.state === 'UP' ? 'success' : 'default'} />
                  {iface.name}
                </Box>
              </MonoCell>
              <MonoCell bold>{iface.ipv4 || '—'}</MonoCell>
              <MonoCell muted>{iface.mtu}</MonoCell>
              <MonoCell>
                <Box component="span" sx={{ color: 'success.main' }}>RX {fmtNetBytes(iface.rx_bytes)}</Box>
                <Box component="span" sx={{ mx: 0.75, color: 'text.secondary' }}>/</Box>
                <Box component="span" sx={{ color: 'info.main' }}>TX {fmtNetBytes(iface.tx_bytes)}</Box>
              </MonoCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
    </Box>
  )
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const toast = useToastStore()
  const theme = useTheme()
  const [confirmDeleteServer, setConfirmDeleteServer] = useState(false)
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
  const [logSource, setLogSource] = useState('')
  const [logSources, setLogSources] = useState<{ id: string; label: string; group?: string }[]>([])
  
  // Preferences form
  const [prefName, setPrefName] = useState('')
  const [prefTags, setPrefTags] = useState('')
  const [prefDesc, setPrefDesc] = useState('')
  const [prefSaving, setPrefSaving] = useState(false)
  const [purgingMetrics, setPurgingMetrics] = useState(false)
  const [netInfo, setNetInfo] = useState<NetworkingInfo | null>(null)
  const [k8sNetInfo, setK8sNetInfo] = useState<K8sNetworkingInfo | null>(null)
  const [netLoading, setNetLoading] = useState(false)
  
  const terminalRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const logWsRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Accounts tab needs the admin/devops-gated list endpoint — hide it otherwise
  const canSeeAccounts = can('manage-servers')
  const tabs = canSeeAccounts
    ? ['Overview', 'Networking', 'Storage', 'Accounts', 'Logs', 'Terminal', 'Settings']
    : ['Overview', 'Networking', 'Storage', 'Logs', 'Terminal', 'Settings']

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
      } catch {
        // Polling for the first metrics to arrive: a failed round is expected while the collector spins up, and the next tick retries.
      }
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
    } catch {
      // Charts stay on their last values rather than the tab erroring out.
    }
  }

  async function loadLogs() {
    try {
      // Scope history to the selected source; live-only sources (pod logs) have
      // no stored history, so the live tail is their whole view.
      const res = await api.get(`/api/servers/${id}/logs?limit=100${logSource ? `&stream=${encodeURIComponent(logSource)}` : ''}`)
      setLogs(res.data?.data || [])
    } catch {
      // History is best-effort; the live tail below is the primary view.
    }
  }

  // Load the selectable log sources for this server's OS (journalctl/syslog/…)
  useEffect(() => {
    if (activeTab !== 'Logs' || logSources.length > 0) return
    api.get(`/api/servers/${id}/log-sources`)
      .then(res => {
        const list = res.data?.sources || []
        setLogSources(list)
        if (!logSource && list.length > 0) setLogSource(list[0].id)
      })
      .catch(() => {})
  }, [activeTab, id])

  // ── OS accounts on the target server (Cockpit-style) ──
  interface OSAccount { username: string; uid: number; home: string; shell: string; is_admin: boolean; privilege: string }
  const [osAccounts, setOsAccounts] = useState<OSAccount[] | null>(null)
  const [osAccountsLoading, setOsAccountsLoading] = useState(false)
  const [osAccountsError, setOsAccountsError] = useState('')
  const [showCreateAccount, setShowCreateAccount] = useState(false)
  const [newAcc, setNewAcc] = useState({ username: '', password: '', privilege: 'standard', ssh_key: '' })
  const [accBusy, setAccBusy] = useState(false)
  const [pendingOsDelete, setPendingOsDelete] = useState<OSAccount | null>(null)

  const PRIVILEGES: { value: string; label: string; hint: string }[] = [
    { value: 'admin', label: 'Admin (sudo)', hint: 'Full root access via sudo' },
    { value: 'standard', label: 'Read / Write', hint: 'Normal user — full access within their own home' },
    { value: 'logs', label: 'Log Viewer', hint: 'Read /var/log and journalctl only (adm + systemd-journal groups)' },
    { value: 'readonly', label: 'Read Only', hint: 'Restricted shell (rbash) — no cd, no writes, PATH commands only' },
  ]
  const privLabel = (p: string) => PRIVILEGES.find(x => x.value === p)?.label || p

  async function loadOsAccounts() {
    setOsAccountsLoading(true)
    setOsAccountsError('')
    try {
      const res = await api.get(`/api/servers/${id}/accounts`)
      setOsAccounts(res.data?.accounts || [])
    } catch (e: unknown) {
      setOsAccounts(null)
      setOsAccountsError(errMessage(e))
    } finally { setOsAccountsLoading(false) }
  }

  useEffect(() => {
    if (activeTab === 'Accounts' && canSeeAccounts && osAccounts === null && !osAccountsLoading) loadOsAccounts()
  }, [activeTab])

  // ── Kubernetes service accounts (read-only, K8s clusters only) ──
  interface K8sAccount { name: string; namespace: string; created_at: string; roles: string[] }
  const [k8sAccounts, setK8sAccounts] = useState<K8sAccount[] | null>(null)
  const [k8sAccountsLoading, setK8sAccountsLoading] = useState(false)
  const [k8sAccountsError, setK8sAccountsError] = useState('')
  const [k8sAccountsSearch, setK8sAccountsSearch] = useState('')

  async function loadK8sAccounts() {
    setK8sAccountsLoading(true)
    setK8sAccountsError('')
    try {
      const res = await api.get(`/api/servers/${id}/k8s-accounts`)
      setK8sAccounts(res.data?.accounts || [])
    } catch (e: unknown) {
      setK8sAccounts(null)
      setK8sAccountsError(errMessage(e))
    } finally { setK8sAccountsLoading(false) }
  }

  useEffect(() => {
    if (activeTab === 'Accounts' && canSeeAccounts && server?.is_k8s && k8sAccounts === null && !k8sAccountsLoading) loadK8sAccounts()
  }, [activeTab, server?.is_k8s])

  const filteredK8sAccounts = useMemo(() => {
    if (!k8sAccounts) return []
    const q = k8sAccountsSearch.trim().toLowerCase()
    if (!q) return k8sAccounts
    return k8sAccounts.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.namespace.toLowerCase().includes(q) ||
      a.roles.some(r => r.toLowerCase().includes(q))
    )
  }, [k8sAccounts, k8sAccountsSearch])

  async function createOsAccount() {
    setAccBusy(true)
    try {
      const res = await api.post(`/api/servers/${id}/accounts`, newAcc)
      if (res.data.success) {
        toast.success('User created', res.data.message || `${newAcc.username} added as ${privLabel(newAcc.privilege)}`)
        setShowCreateAccount(false)
        setNewAcc({ username: '', password: '', privilege: 'standard', ssh_key: '' })
        loadOsAccounts()
      } else {
        toast.error('Create failed', res.data.error || 'Command failed on the server')
      }
    } catch (e: unknown) {
      toast.error('Create failed', errMessage(e))
    } finally { setAccBusy(false) }
  }

  async function setOsPrivilege(acc: OSAccount, privilege: string) {
    if (privilege === acc.privilege) return
    try {
      const res = await api.put(`/api/servers/${id}/accounts/${acc.username}`, { privilege })
      if (res.data.success) {
        toast.success('Privilege updated', `${acc.username} → ${privLabel(privilege)}`)
        loadOsAccounts()
      } else toast.error('Update failed', res.data.error)
    } catch (e: unknown) { toast.error('Update failed', errMessage(e)) }
  }

  async function deleteOsAccount(acc: OSAccount) {
    try {
      const res = await api.delete(`/api/servers/${id}/accounts/${acc.username}`)
      if (res.data.success) {
        toast.success('User deleted', `${acc.username} removed from the server`)
        loadOsAccounts()
      } else toast.error('Delete failed', res.data.error)
    } catch (e: unknown) { toast.error('Delete failed', errMessage(e)) }
  }

  // ── Access control (per-user grants; admin only) ──
  const canManageUsers = can('manage-users')
  const [accessList, setAccessList] = useState<{ id: number; user_id: number; access_level: string; user?: { username: string; role?: string } }[]>([])
  const [allUsers, setAllUsers] = useState<{ id: number; username: string; role: string }[]>([])
  const [grantUserId, setGrantUserId] = useState('')
  const [grantLevel, setGrantLevel] = useState('read')
  const [grantSaving, setGrantSaving] = useState(false)

  async function loadAccess() {
    try {
      const [a, u] = await Promise.all([
        api.get(`/api/servers/${id}/access`),
        api.get('/api/users'),
      ])
      setAccessList(Array.isArray(a.data) ? a.data : [])
      setAllUsers(Array.isArray(u.data) ? u.data : (u.data?.data || []))
    } catch { /* not permitted */ }
  }

  useEffect(() => {
    if (activeTab === 'Settings' && canManageUsers) loadAccess()
  }, [activeTab, canManageUsers])

  async function grantAccess() {
    if (!grantUserId) return
    setGrantSaving(true)
    try {
      await api.post(`/api/servers/${id}/access`, { user_id: parseInt(grantUserId, 10), access_level: grantLevel })
      toast.success('Access granted', 'User can now see this server')
      setGrantUserId('')
      loadAccess()
    } catch (e: unknown) {
      toast.error('Grant failed', errMessage(e))
    } finally { setGrantSaving(false) }
  }

  async function changeAccessLevel(accessId: number, level: string) {
    try {
      await api.put(`/api/servers/${id}/access/${accessId}`, { access_level: level })
      loadAccess()
    } catch (e: unknown) { toast.error('Update failed', errMessage(e)) }
  }

  async function revokeAccess(accessId: number) {
    try {
      await api.delete(`/api/servers/${id}/access/${accessId}`)
      toast.success('Access revoked', 'User no longer sees this server')
      loadAccess()
    } catch (e: unknown) { toast.error('Revoke failed', errMessage(e)) }
  }

  async function loadNetworking() {
    setNetLoading(true)
    try {
      if (server?.is_k8s) {
        const res = await api.get(`/api/servers/${id}/k8s-networking`)
        setK8sNetInfo({
          ...res.data,
          pod_cidrs: res.data?.pod_cidrs || [],
          nodes: res.data?.nodes || [],
          services: res.data?.services || [],
          ingresses: res.data?.ingresses || [],
          network_policies: res.data?.network_policies || [],
          dns: res.data?.dns || {},
          cni: res.data?.cni || {},
          summary: res.data?.summary || {},
        })
      } else {
        const res = await api.get(`/api/servers/${id}/networking`)
        setNetInfo({
          ...res.data,
          ports: res.data?.ports || [],
          services: res.data?.services || [],
          interfaces: res.data?.interfaces || [],
        })
      }
    } catch (err: unknown) {
      setNetInfo(null)
      setK8sNetInfo(null)
      toast.error('Failed to load networking data', errMessage(err))
    } finally {
      setNetLoading(false)
    }
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
      } catch {
        // Ignore a malformed frame rather than tearing down a live stream.
      }
    }
  }

  function startLogsWs(source?: string) {
    if (logWsRef.current) logWsRef.current.close()
    const src = source ?? logSource
    const ws = new WebSocket(buildWsUrl(`/ws/servers/${id}/logs${src ? `?source=${encodeURIComponent(src)}` : ''}`))
    logWsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'log') {
          setLogs(prev => [msg.payload, ...prev].slice(0, 500))
        }
      } catch {
        // Ignore a malformed frame rather than tearing down a live stream.
      }
    }
  }

  function switchLogSource(source: string) {
    setLogSource(source)
    setLogs([])            // drop the previous source's lines
    startLogsWs(source)    // reconnect the live tail to the new source
  }

  // Initialize xterm terminal when tab becomes active
  useEffect(() => {
    if (activeTab === 'Terminal' && terminalRef.current && !xtermRef.current) {
      initTerminal()
    }
  }, [activeTab])

  // Load networking data when tab becomes active
  useEffect(() => {
    if (activeTab === 'Networking' && server && !netInfo && !k8sNetInfo && !netLoading) {
      loadNetworking()
    }
  }, [activeTab, server])

  async function initTerminal() {
    const { Terminal: XTerm } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    await import('@xterm/xterm/css/xterm.css')

    const xterm = new XTerm({
      theme: { 
        background: '#020617', 
        foreground: '#f8fafc', 
        cursor: 'var(--brand-primary)', 
        selectionBackground: 'var(--brand-glow)' 
      },
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
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
    } catch (err: unknown) {
      toast.error('Diagnostic failed', apiError(err) || 'Unknown error')
    }
  }

  const clearLogs = async () => {
    try {
      await api.delete(`/api/servers/${id}/logs`)
      setLogs([])
      toast.success('Logs cleared', 'All historical log entries removed.')
    } catch (err: unknown) {
      toast.error('Clear failed', apiError(err) || 'Failed to clear logs')
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

  const netChartData = useMemo(() => {
    return metrics.slice(-30).map(m => ({
      t: format(new Date(m.timestamp), 'HH:mm'),
      RX: parseFloat((m.net_rx_mbps || 0).toFixed(2)),
      TX: parseFloat((m.net_tx_mbps || 0).toFixed(2)),
    }))
  }, [metrics])
  
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
    } catch (err: unknown) {
      toast.error('Delete failed', apiError(err) || 'Delete failed')
    }
  }

  async function handleReboot() {
    setRebooting(true)
    try {
      await api.post(`/api/servers/${id}/reboot`)
      setServer(prev => prev ? { ...prev, status: 'offline' } : null)
      toast.warning('Reboot initiated', `${server?.name} is restarting.`)
      navigate('/servers')
    } catch (err: unknown) {
      toast.error('Reboot failed', apiError(err) || 'Reboot command failed')
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
    } catch (err: unknown) {
      toast.error('Save failed', apiError(err) || 'Could not save preferences.')
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
    } catch (err: unknown) {
      toast.error('Purge failed', apiError(err) || 'Could not purge metrics.')
    } finally {
      setPurgingMetrics(false)
    }
  }


  if (loading && !server) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress aria-label="Loading server" />
      </div>
    )
  }
  if (!server) return <div className="page"><EmptyState icon={HelpCircle} title="Server not found" /></div>

  const axisTick = { fontSize: 11, fontFamily: MONO, fill: theme.palette.text.secondary }
  const tooltipStyle = {
    background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 4,
    fontSize: 12, fontFamily: MONO, color: theme.palette.text.primary,
  }
  const legendStyle = { paddingTop: 16, fontSize: 12, fontFamily: MONO }
  const tabDefs = tabs.map(t => ({
    id: t,
    label: t,
    icon: ({ Overview: Gauge, Networking: Network, Storage: HardDrive, Accounts: Users, Logs: ScrollText, Terminal: TerminalIcon, Settings: SettingsIcon } as Record<string, typeof Gauge>)[t],
  }))
  const isDarwin = server.os === 'darwin'
  const rolePill = (role: string) => (
    <Box key={role} component="span" sx={{
      fontSize: 12, fontWeight: 600, fontFamily: MONO, border: 1, borderColor: 'divider', px: 0.875, py: 0.125, borderRadius: 1,
      color: role.startsWith('ClusterRole/') ? 'warning.main' : 'text.secondary',
    }}>{role}</Box>
  )
  const refreshIcon = (busy: boolean) => (busy ? <CircularProgress size={14} /> : <RefreshCw size={14} />)

  return (
    <Box className="page" sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', pb: 0 }}>
      {/* Breadcrumbs */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap', flexShrink: 0 }}>
        <Tooltip title="Back to servers">
          <IconButton onClick={() => navigate('/servers')} aria-label="Back to servers" sx={{ border: 1, borderColor: 'divider' }}>
            <ArrowLeft size={16} />
          </IconButton>
        </Tooltip>
        <Box component="nav" aria-label="Breadcrumb" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary', flexWrap: 'wrap', fontSize: 13 }}>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Infrastructure</Box>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}><ChevronRight size={14} /></Box>
          <span>Servers</span>
          <ChevronRight size={14} />
          <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>{server.name}</Box>
        </Box>
      </Box>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0 }}>
          <Box sx={{ width: 52, height: 52, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'text.primary' }}>
            {server.is_k8s ? <KubernetesIcon size={30} /> :
             server.os === 'darwin' ? <AppleIcon size={28} color="currentColor" /> :
             server.os === 'windows' ? <WindowsIcon size={24} color="currentColor" /> :
             server.os === 'linux'  ? <DistroIcon distro={server.distro} size={26} color="currentColor" /> :
             <HelpCircle size={28} />}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" component="h1" noWrap>{server.name}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}>
              <ToneChip label={server.status} tone={statusTone(server.status)} />
              <Typography variant="body2" color="text.secondary" noWrap sx={{ fontFamily: MONO }}>
                {server.host ? `${server.ssh_user}@${server.host}` : 'Direct cluster API'}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
          {server.is_k8s && (
            <Button variant="outline" icon={<Layers size={14} />} onClick={() => navigate('/kubernetes')}>Open cluster</Button>
          )}
          <Button variant="secondary" icon={<Power size={14} />} onClick={handleReboot} loading={rebooting} disabled={server.status !== 'online'}>Restart</Button>
          {server.host && (
            <Button icon={<TerminalIcon size={14} />} onClick={() => setActiveTab('Terminal')}>Connect SSH</Button>
          )}
        </Box>
      </Box>

      <Box sx={{ flexShrink: 0 }}>
        <TabSwitcher tabs={tabDefs} active={activeTab} onChange={setActiveTab} />
      </Box>

      {/* Scrollable tab content */}
      <Box sx={{ flex: 1, overflowY: 'auto', pt: 2.5, pb: 6 }}>

      {activeTab === 'Overview' && (
        <Box>
          <TileGrid mb={1.5}>
            <Tile label="CPU load" value={latest ? `${latest.cpu_percent.toFixed(1)}%` : 'N/A'} icon={Cpu} accent="info.main" />
            <Tile label="Memory" value={latest ? `${latest.mem_percent.toFixed(1)}%` : 'N/A'} icon={MemoryStick} accent="success.main" />
            <Tile label="Disk usage" value={latest ? `${latest.disk_percent.toFixed(1)}%` : 'N/A'} icon={HardDrive} accent="warning.main" />
            <Tile label="Net RX / TX" value={latest ? `${latest.net_rx_mbps.toFixed(2)} / ${latest.net_tx_mbps.toFixed(2)}` : 'N/A'} icon={Wifi} unit="MB/s" />
          </TileGrid>
          <TileGrid mb={2}>
            <Tile label="Uptime" value={latest ? fmtUptime(latest.uptime_seconds) : 'N/A'} icon={Gauge} />
            <Tile label="Load avg (1m)" value={latest ? latest.load_avg_1.toFixed(2) : 'N/A'} icon={Activity} accent="info.main" />
            <Tile
              label="Memory used / total"
              value={latest && latest.mem_total_mb > 0 ? `${(latest.mem_used_mb / 1024).toFixed(1)} / ${(latest.mem_total_mb / 1024).toFixed(1)}` : 'N/A'}
              unit={latest && latest.mem_total_mb > 0 ? 'GB' : undefined}
              icon={MemoryStick} accent="success.main"
            />
            <Tile
              label="Disk used / total"
              value={latest && latest.disk_total_gb > 0 ? `${latest.disk_used_gb.toFixed(0)} / ${latest.disk_total_gb.toFixed(0)}` : 'N/A'}
              unit={latest && latest.disk_total_gb > 0 ? 'GB' : undefined}
              icon={HardDrive} accent="warning.main"
            />
          </TileGrid>

          <SectionCard
            icon={Activity}
            title="Performance analytics"
            sx={{ mb: 2 }}
            action={<Button variant="secondary" size="sm" onClick={loadMetrics} icon={<RefreshCw size={14} />}>Sync data</Button>}
          >
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Real-time resource utilization</Typography>
              {chartData.length === 0 ? (
                <EmptyState icon={Wifi} title="No metrics available" />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="t" stroke={theme.palette.divider} tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} stroke={theme.palette.divider} tick={axisTick} axisLine={false} tickLine={false} unit="%" />
                    <ChartTooltip contentStyle={tooltipStyle} />
                    <Legend iconType="square" wrapperStyle={{ ...legendStyle, paddingTop: 24 }} />
                    <Line type="monotone" dataKey="CPU" stroke={theme.palette.info.main} dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="Memory" stroke={theme.palette.success.main} dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="Disk" stroke={theme.palette.warning.main} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Box>
          </SectionCard>

          {/* Network throughput */}
          {netChartData.length > 1 && (
            <SectionCard icon={Wifi} title="Network throughput" sx={{ mb: 2 }}>
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Receive / transmit in MB/s</Typography>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={netChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" vertical={false} stroke={theme.palette.divider} />
                    <XAxis dataKey="t" stroke={theme.palette.divider} tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis stroke={theme.palette.divider} tick={axisTick} axisLine={false} tickLine={false} />
                    <ChartTooltip formatter={(v) => `${v} MB/s`} contentStyle={tooltipStyle} />
                    <Legend iconType="plainline" wrapperStyle={legendStyle} />
                    <Line type="monotone" dataKey="RX" stroke={theme.palette.info.main} dot={false} strokeWidth={2} activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="TX" stroke={theme.palette.success.main} dot={false} strokeWidth={2} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </SectionCard>
          )}

          {/* System information */}
          <SectionCard icon={Cpu} title="System information">
            <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px 32px' }}>
              {[
                { k: 'Operating system', v: server.os === 'darwin' ? 'macOS' : server.os === 'linux' ? 'Linux' : server.os === 'windows' ? 'Windows' : 'Unknown' },
                ...(server.os === 'linux' && (server.distro_pretty_name || server.distro)
                  ? [{ k: 'Distribution', v: server.distro_pretty_name || server.distro || '—' }]
                  : []),
                ...(server.os === 'darwin' && (server.distro_pretty_name || server.distro_version)
                  ? [{ k: 'macOS version', v: server.distro_pretty_name || server.distro_version || '—' }]
                  : []),
                ...(server.kernel_version ? [{ k: 'Kernel', v: server.kernel_version }] : []),
                { k: 'Host', v: server.host ? `${server.host}:${server.port}` : 'Direct cluster API' },
                { k: 'SSH user', v: server.ssh_user || '—' },
                { k: 'Auth method', v: server.auth_type === 'password' ? 'Password' : 'SSH key' },
                { k: 'Kubernetes', v: server.is_k8s ? 'Cluster attached' : 'No' },
                { k: 'Last metric', v: latest ? format(new Date(latest.timestamp), 'HH:mm:ss') : 'Never' },
                { k: 'Tags', v: server.tags || '—' },
                { k: 'Description', v: server.description || '—' },
              ].map(({ k, v }) => (
                <Box key={k} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.25 }}>
                  <KeyValue label={k}>{v}</KeyValue>
                </Box>
              ))}
            </Box>
          </SectionCard>
        </Box>
      )}

      {activeTab === 'Networking' && (
        <Box>
          {server?.is_k8s ? (
            <K8sNetworkingPanel info={k8sNetInfo} loading={netLoading} onRetry={loadNetworking} />
          ) : netLoading && !netInfo ? (
            <CenteredSpinner />
          ) : netInfo ? (
            <HostNetworkingPanel netInfo={netInfo} />
          ) : (
            <LoadFailed icon={Network} message="Unable to load networking data" onRetry={loadNetworking} />
          )}
        </Box>
      )}

      {/* Storage mounts its own panel: it owns two independent fetches (a cheap
          df/lsblk inventory and an on-demand du/find walk) whose state has no
          overlap with the rest of this page. */}
      {activeTab === 'Storage' && id && (
        <Box>
          {server?.is_k8s
            ? <K8sStoragePanel serverId={id} />
            : <StoragePanel serverId={id} os={server?.os} />}
        </Box>
      )}

      {activeTab === 'Accounts' && canSeeAccounts && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SectionCard
            icon={Users}
            title="OS accounts"
            count={osAccounts ? osAccounts.length : undefined}
            action={
              <>
                <Button variant="secondary" size="sm" onClick={loadOsAccounts} disabled={osAccountsLoading} icon={refreshIcon(osAccountsLoading)} aria-label="Refresh OS accounts" />
                {canManageUsers && (
                  <Button size="sm" onClick={() => setShowCreateAccount(v => !v)} icon={<Plus size={14} />}>Create user</Button>
                )}
              </>
            }
          >
            {showCreateAccount && canManageUsers && (
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <Box sx={{ flex: '1 1 150px' }}>
                    <Input label="Username" placeholder="e.g. deploy" value={newAcc.username} onChange={e => setNewAcc(a => ({ ...a, username: e.target.value }))} />
                  </Box>
                  <Box sx={{ flex: '1 1 150px' }}>
                    <Input
                      label="Password" type="password" placeholder="min 6 characters" value={newAcc.password}
                      onChange={e => setNewAcc(a => ({ ...a, password: e.target.value }))}
                      error={newAcc.password.length > 0 && newAcc.password.length < 6 ? 'Password must be at least 6 characters' : undefined}
                    />
                  </Box>
                  <Box sx={{ flex: '1 1 170px' }}>
                    <Select
                      label="Privilege"
                      value={newAcc.privilege}
                      onChange={e => setNewAcc(a => ({ ...a, privilege: e.target.value }))}
                      options={PRIVILEGES.map(p => ({
                        value: p.value,
                        label: `${p.label}${isDarwin && !['admin', 'standard'].includes(p.value) ? ' (linux only)' : ''}`,
                      }))}
                    />
                  </Box>
                  <Box sx={{ flex: '2 1 220px' }}>
                    <Input
                      label={`SSH public key (optional${isDarwin ? ', linux only' : ''})`}
                      placeholder="ssh-ed25519 AAAA…"
                      value={newAcc.ssh_key}
                      onChange={e => setNewAcc(a => ({ ...a, ssh_key: e.target.value }))}
                      disabled={isDarwin}
                    />
                  </Box>
                  <Button onClick={createOsAccount} loading={accBusy} disabled={!newAcc.username || newAcc.password.length < 6}>
                    {accBusy ? 'Creating…' : 'Create on server'}
                  </Button>
                </Box>
                <Typography variant="body2" sx={{ mt: 1.5, color: newAcc.privilege === 'admin' ? 'warning.main' : 'text.secondary' }}>
                  {newAcc.privilege === 'admin' && 'Warning: '}
                  {PRIVILEGES.find(p => p.value === newAcc.privilege)?.hint}
                </Typography>
              </Box>
            )}

            {osAccountsLoading && !osAccounts ? (
              <CenteredSpinner size={22} py={4} />
            ) : osAccountsError ? (
              <LoadFailed icon={Users} message={osAccountsError} onRetry={loadOsAccounts} />
            ) : (
              <DataTable
                label="OS accounts"
                minWidth={640}
                headers={['Username', 'UID', 'Privilege', 'Shell', 'Home', ...(canManageUsers ? [{ label: 'Actions', align: 'right' as const }] : [])]}
              >
                {(osAccounts || []).map(acc => {
                  const isConnUser = acc.username === server.ssh_user
                  const isRoot = acc.username === 'root'
                  return (
                    <TableRow key={acc.username} hover>
                      <MonoCell bold>
                        {acc.username}
                        {isConnUser && <Box component="span" sx={{ ml: 1 }}><ToneChip label="connection" tone="primary" /></Box>}
                      </MonoCell>
                      <MonoCell>{acc.uid}</MonoCell>
                      <TableCell>
                        {canManageUsers && !isRoot && !isConnUser ? (
                          <Box sx={{ width: 160 }}>
                            <Select
                              aria-label={`Privilege for ${acc.username}`}
                              value={acc.privilege}
                              onChange={e => setOsPrivilege(acc, e.target.value)}
                              options={PRIVILEGES.map(p => ({ value: p.value, label: p.label }))}
                            />
                          </Box>
                        ) : (
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600, color: acc.is_admin ? 'warning.main' : 'text.secondary' }}>
                            {acc.is_admin && <Shield size={12} />} {privLabel(acc.privilege)}
                          </Box>
                        )}
                      </TableCell>
                      <MonoCell muted>{acc.shell || '—'}</MonoCell>
                      <MonoCell muted>{acc.home || '—'}</MonoCell>
                      {canManageUsers && (
                        <TableCell align="right">
                          {!isRoot && !isConnUser && (
                            <Tooltip title="Delete user">
                              <IconButton color="error" aria-label={`Delete user ${acc.username}`} onClick={() => setPendingOsDelete(acc)}>
                                <Trash2 size={14} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </DataTable>
            )}
          </SectionCard>

          {server.is_k8s && (
            <SectionCard
              icon={KubernetesIcon}
              title="Kubernetes service accounts"
              count={k8sAccounts ? k8sAccounts.length : undefined}
              action={
                <>
                  {k8sAccounts && k8sAccounts.length > 0 && (
                    <Box sx={{ minWidth: 160, maxWidth: 220 }}>
                      <SearchInput value={k8sAccountsSearch} onChange={setK8sAccountsSearch} placeholder="Filter…" />
                    </Box>
                  )}
                  <Button variant="secondary" size="sm" onClick={loadK8sAccounts} disabled={k8sAccountsLoading} icon={refreshIcon(k8sAccountsLoading)} aria-label="Refresh service accounts" />
                </>
              }
            >
              {k8sAccountsLoading && !k8sAccounts ? (
                <CenteredSpinner size={22} py={4} />
              ) : k8sAccountsError ? (
                <LoadFailed icon={Users} message={k8sAccountsError} onRetry={loadK8sAccounts} />
              ) : (
                <DataTable label="Kubernetes service accounts" minWidth={640} headers={['Name', 'Namespace', 'Bound roles', 'Created']}>
                  {filteredK8sAccounts.length === 0 ? (
                    <EmptyRow colSpan={4} label={k8sAccountsSearch ? 'No service accounts match the filter' : 'No service accounts found'} />
                  ) : filteredK8sAccounts.map(acc => (
                    <TableRow key={`${acc.namespace}/${acc.name}`} hover>
                      <MonoCell bold>{acc.name}</MonoCell>
                      <MonoCell muted>{acc.namespace}</MonoCell>
                      <TableCell>
                        {acc.roles.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        ) : (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.625 }}>{acc.roles.map(rolePill)}</Box>
                        )}
                      </TableCell>
                      <MonoCell muted sx={{ whiteSpace: 'nowrap' }}>{acc.created_at}</MonoCell>
                    </TableRow>
                  ))}
                </DataTable>
              )}
            </SectionCard>
          )}
        </Box>
      )}

      {activeTab === 'Logs' && (
        <Box sx={isLogsFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, bgcolor: 'background.default', p: 2 } : undefined}>
          <Card sx={{ overflow: 'hidden', height: isLogsFullscreen ? '100%' : 'auto', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, flexShrink: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ display: 'inline-flex', color: 'primary.main' }}><ScrollText size={16} /></Box>
                <Typography variant="subtitle1" component="h3">Explorer</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
                {logSources.length > 0 && (
                  <Box sx={{ width: 240, maxWidth: '100%' }}>
                    <LogSourceSelect sources={logSources} value={logSource} onChange={switchLogSource} />
                  </Box>
                )}
                <Box sx={{ minWidth: 160, maxWidth: 240 }}>
                  <SearchInput value={logSearch} onChange={setLogSearch} placeholder="Search logs…" />
                </Box>
                <Tooltip title="Run diagnostics">
                  <span><Button variant="secondary" size="sm" onClick={runDiagnostics} icon={<Activity size={14} />}>Diagnose</Button></span>
                </Tooltip>
                <Tooltip title="Clear logs">
                  <IconButton color="error" onClick={clearLogs} aria-label="Clear logs"><Trash2 size={14} /></IconButton>
                </Tooltip>
                <Tooltip title="Refresh logs">
                  <IconButton onClick={loadLogs} aria-label="Refresh logs"><RefreshCw size={14} /></IconButton>
                </Tooltip>
                <Tooltip title="Toggle fullscreen (Space / Esc)">
                  <IconButton onClick={toggleLogsFullscreen} aria-label="Toggle fullscreen">
                    {isLogsFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            <Box sx={{ height: isLogsFullscreen ? '100%' : 500, bgcolor: 'background.default', overflowY: 'auto', flex: 1 }}>
              {filteredLogs.length === 0
                ? <EmptyState title="No log entries found" />
                : filteredLogs.map((log, i) => <LogLine key={log.id ? `${log.id}` : `live-${i}-${log.timestamp}`} log={log} />)
              }
            </Box>
          </Card>
        </Box>
      )}

      {activeTab === 'Terminal' && (
        <Box sx={isTerminalFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, bgcolor: '#0a0c12' } : undefined}>
          <Card sx={{ overflow: 'hidden', height: isTerminalFullscreen ? '100%' : 'auto', borderRadius: isTerminalFullscreen ? 0 : 1, bgcolor: '#0a0c12', borderColor: '#1e293b' }}>
            <Box sx={{ px: 2.5, py: 0.5, bgcolor: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>
                <TerminalIcon size={13} />
                SSH terminal: {server.ssh_user}@{server.host}
              </Box>
              <Button variant="ghost" size="sm" onClick={toggleTerminalFullscreen} style={{ color: '#94a3b8' }}>
                {isTerminalFullscreen ? 'Minimize (Space / Esc)' : 'Maximize (Space)'}
              </Button>
            </Box>
            <div ref={terminalRef} style={{ height: isTerminalFullscreen ? 'calc(100vh - 40px)' : 600, padding: '16px 4px', background: '#0a0c12' }} className="terminal-container" />
          </Card>
        </Box>
      )}

      {activeTab === 'Settings' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {canManageUsers && (
            <SectionCard icon={Shield} title="Access control">
              <Box sx={{ p: 2 }}>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                  Grant trainee/intern users visibility of this {server.is_k8s ? 'cluster' : 'server'}. Admin and DevOps roles always have access. Users without a grant cannot see it anywhere in the app.
                </Typography>

                <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'flex-start', mb: 2 }}>
                  <Box sx={{ flex: '1 1 200px' }}>
                    <Select
                      label="User"
                      value={grantUserId}
                      onChange={e => setGrantUserId(e.target.value)}
                      options={[
                        { value: '', label: 'Select a user…' },
                        ...allUsers
                          .filter(u => !['admin', 'devops'].includes(u.role) && !accessList.some(a => a.user_id === u.id))
                          .map(u => ({ value: String(u.id), label: `${u.username} (${u.role})` })),
                      ]}
                    />
                  </Box>
                  <Box sx={{ width: 140 }}>
                    <Select
                      label="Access level"
                      value={grantLevel}
                      onChange={e => setGrantLevel(e.target.value)}
                      options={[{ value: 'read', label: 'Read' }, { value: 'operate', label: 'Operate' }]}
                    />
                  </Box>
                  <Button onClick={grantAccess} disabled={!grantUserId} loading={grantSaving}>
                    {grantSaving ? 'Granting…' : 'Grant access'}
                  </Button>
                </Box>

                {accessList.length === 0 ? (
                  <Box sx={{ py: 2.5, color: 'text.secondary', textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
                    No per-user grants yet. Only Admin and DevOps can see this {server.is_k8s ? 'cluster' : 'server'}.
                  </Box>
                ) : (
                  <DataTable label="Access grants" minWidth={480} headers={['User', 'Role', 'Access level', { label: 'Actions', align: 'right' }]}>
                    {accessList.map(a => (
                      <TableRow key={a.id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{a.user?.username || `user #${a.user_id}`}</TableCell>
                        <TableCell sx={{ textTransform: 'capitalize' }}>{a.user?.role || '—'}</TableCell>
                        <TableCell>
                          <Box sx={{ width: 130 }}>
                            <Select
                              aria-label={`Access level for ${a.user?.username || a.user_id}`}
                              value={a.access_level}
                              onChange={e => changeAccessLevel(a.id, e.target.value)}
                              options={[{ value: 'read', label: 'Read' }, { value: 'operate', label: 'Operate' }]}
                            />
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="Revoke access">
                            <IconButton color="error" aria-label={`Revoke access for ${a.user?.username || a.user_id}`} onClick={() => revokeAccess(a.id)}>
                              <Trash2 size={14} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                )}
              </Box>
            </SectionCard>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
            <SectionCard title="Preferences">
              <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Input label="Display name" value={prefName} onChange={e => setPrefName(e.target.value)} />
                <Input label="Tags" value={prefTags} onChange={e => setPrefTags(e.target.value)} />
                <Input label="Description" value={prefDesc} onChange={e => setPrefDesc(e.target.value)} />
                <Button onClick={handleSavePreferences} loading={prefSaving}>{prefSaving ? 'Saving…' : 'Save changes'}</Button>
              </Box>
            </SectionCard>

            <SectionCard title="Danger zone" sx={{ borderColor: 'error.main' }}>
              <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                  <Box>
                    <Typography variant="subtitle2">Purge metrics</Typography>
                    <Typography variant="body2" color="text.secondary">Remove all stored performance history for this {server.is_k8s ? 'cluster' : 'server'}.</Typography>
                  </Box>
                  <Button variant="secondary" onClick={handlePurgeMetrics} loading={purgingMetrics} style={{ color: theme.palette.error.main }}>Purge</Button>
                </Box>
                <Divider />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                  <Box>
                    <Typography variant="subtitle2" color="error">Remove server</Typography>
                    <Typography variant="body2" color="text.secondary">Permanently delete this {server.is_k8s ? 'cluster' : 'server'} and all its data.</Typography>
                  </Box>
                  <Button variant="danger" onClick={() => setConfirmDeleteServer(true)}>Delete</Button>
                </Box>
              </Box>
            </SectionCard>
          </Box>
        </Box>
      )}
      </Box>{/* end scrollable tab content */}

      <ConfirmDialog
        open={!!pendingOsDelete}
        title="Delete OS user"
        message={`Delete OS user "${pendingOsDelete?.username}" and their home directory from ${server.name}? This cannot be undone.`}
        confirmLabel="Delete user"
        onCancel={() => setPendingOsDelete(null)}
        onConfirm={() => {
          const acc = pendingOsDelete
          setPendingOsDelete(null)
          if (acc) deleteOsAccount(acc)
        }}
      />
      <ConfirmDialog
        open={confirmDeleteServer}
        title="Delete server"
        message={`Permanently delete ${server.name} and all of its data? This cannot be undone.`}
        confirmLabel="Delete server"
        onCancel={() => setConfirmDeleteServer(false)}
        onConfirm={() => { setConfirmDeleteServer(false); handleDeleteServer() }}
      />
    </Box>
  )
}

/** Log source picker; native <select> so grouped sources keep their <optgroup> headings. */
function LogSourceSelect({ sources, value, onChange }: {
  sources: { id: string; label: string; group?: string }[]; value: string; onChange: (v: string) => void
}) {
  const flat = sources.filter(s => !s.group)
  const grouped: Record<string, typeof sources> = {}
  sources.forEach(s => { if (s.group) (grouped[s.group] = grouped[s.group] || []).push(s) })
  return (
    <TextField
      select
      fullWidth
      value={value}
      onChange={e => onChange(e.target.value)}
      slotProps={{ select: { native: true }, htmlInput: { 'aria-label': 'Log source', title: 'Log source', style: { fontFamily: MONO } } }}
    >
      {flat.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      {Object.entries(grouped).map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </optgroup>
      ))}
    </TextField>
  )
}
