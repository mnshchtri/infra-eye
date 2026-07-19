import { useEffect, useState, useRef, useMemo, memo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Cpu, MemoryStick, HardDrive, Activity,
  ScrollText, Terminal as TerminalIcon, RefreshCw, Wifi, Shield,
  Search, Download, Power, Settings as SettingsIcon, Loader2,
  ChevronRight, Gauge, Layers, HelpCircle,
  Trash2, Maximize2, Minimize2, Network, Users, Plus, Globe
} from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../components/OSIcons'
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

const CHART_COLORS = {
  cpu:  { stroke: 'var(--info)',    fill: 'var(--info)' },
  mem:  { stroke: 'var(--success)', fill: 'var(--success)' },
  disk: { stroke: 'var(--warning)', fill: 'var(--warning)' },
}

const StatCard = memo(({ label, value, icon: Icon, color, unit }: any) => (
  <div className="card stat-card" style={{ padding: '20px 24px', border: '1px solid var(--border)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
      <div style={{ 
        width: 36, height: 36, borderRadius: 0, 
        background: 'transparent', border: `1px solid var(--border-bright)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0
      }}>
        <Icon size={16} color="var(--brand-primary)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ 
          fontSize: value.length > 8 ? 16 : 20, 
          fontWeight: 800, 
          color: 'var(--text-primary)', 
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.1 
        }}>
          {value}
          {unit && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>{unit}</span>}
        </div>
        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      </div>
    </div>
    <div style={{ height: 2, background: 'var(--bg-elevated)', borderRadius: 0, overflow: 'hidden' }}>
      <div style={{ 
        height: '100%', 
        width: typeof value === 'string' && value.includes('%') ? value : (label.includes('NET') ? '0%' : '50%'), 
        background: 'var(--brand-primary)',
        borderRadius: 0
      }} />
    </div>
  </div>
))

const LogLine = memo(({ log }: { log: LogEntry }) => (
  <div className="log-line" style={{ borderBottom: '1px solid var(--border)', padding: '10px 24px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
    <span className="log-ts" style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 85, fontFamily: 'var(--font-mono)' }}>{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
    <span className="log-badge" style={{ 
      borderRadius: 0, width: 50, textAlign: 'center', flexShrink: 0, padding: '2px 0', fontSize: 9, fontWeight: 900, fontFamily: 'var(--font-mono)',
      background: log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warning)' : 'var(--bg-elevated)',
      color: log.level === 'error' || log.level === 'warn' ? 'var(--text-inverse)' : 'var(--text-primary)',
      border: '1px solid var(--border)'
    }}>{log.level.toUpperCase()}</span>
    <span className="log-msg" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{log.message}</span>
  </div>
))

const SectionCard = ({ icon: Icon, title, count, children }: { icon: any, title: string, count?: number, children: React.ReactNode }) => (
  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon size={16} color="var(--brand-primary)" />
      <span style={{ fontWeight: 800, fontSize: 14 }}>{title}</span>
      {count !== undefined && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({count})</span>}
    </div>
    {children}
  </div>
)

const THead = ({ headers }: { headers: string[] }) => (
  <thead>
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {headers.map(h => (
        <th key={h} style={{ padding: '10px 16px', fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>{h}</th>
      ))}
    </tr>
  </thead>
)

const EmptyRow = ({ colSpan, label }: { colSpan: number, label: string }) => (
  <tr>
    <td colSpan={colSpan} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{label}</td>
  </tr>
)

function K8sNetworkingPanel({ info, loading, onRetry }: { info: K8sNetworkingInfo | null, loading: boolean, onRetry: () => void }) {
  if (loading && !info) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }
  if (!info) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Network size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
        <div style={{ fontSize: 13 }}>Unable to load cluster networking data</div>
        <button className="btn btn-secondary" onClick={onRetry} style={{ marginTop: 16 }}>Retry</button>
      </div>
    )
  }

  const svcTypeColor = (t: string) => t === 'LoadBalancer' ? 'var(--success)' : t === 'NodePort' ? 'var(--warning)' : t === 'ExternalName' ? 'var(--text-muted)' : 'var(--info)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary Stats */}
      <div className="grid-stats-4">
        <StatCard label="SERVICES" value={`${info.summary.services}`} icon={Network} color="var(--info)" />
        <StatCard label="INGRESSES" value={`${info.summary.ingresses}`} icon={Globe} color="var(--success)" />
        <StatCard label="NETWORK POLICIES" value={`${info.summary.network_policies}`} icon={Shield} color="var(--brand-primary)" />
        <StatCard label="NODES" value={`${info.summary.nodes}`} icon={Layers} color="var(--warning)" />
      </div>

      {/* Cluster network config */}
      <div className="grid-stats-4">
        <div className="card" style={{ padding: '16px 20px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>DNS Provider</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: 0, background: info.dns.deployment_ready ? 'var(--success)' : 'var(--danger)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14 }}>{info.dns.provider}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
            {info.dns.ready_replicas}/{info.dns.desired_replicas} ready{info.dns.cluster_ip ? ` · ${info.dns.cluster_ip}` : ''}
          </div>
        </div>
        <div className="card" style={{ padding: '16px 20px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>CNI Plugin</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: 0, background: info.cni.ready ? 'var(--success)' : 'var(--text-muted)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14 }}>{info.cni.provider}</span>
          </div>
          {info.cni.desired > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>{info.cni.scheduled}/{info.cni.desired} pods ready</div>
          )}
        </div>
        <div className="card" style={{ padding: '16px 20px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Service CIDR</div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: 'var(--brand-primary)' }}>{info.service_cidr || '—'}</span>
        </div>
        <div className="card" style={{ padding: '16px 20px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Pod CIDR(s)</div>
          {info.pod_cidrs.length === 0 ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: 'var(--text-muted)' }}>—</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {info.pod_cidrs.map(c => (
                <span key={c} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--brand-primary)' }}>{c}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Services */}
      <SectionCard icon={Network} title="Services" count={info.services.length}>
        <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Name', 'Namespace', 'Type', 'Cluster IP', 'Ports', 'External']} />
            <tbody>
              {info.services.length === 0 ? <EmptyRow colSpan={6} label="No services found" /> : info.services.map((s, i) => {
                const tc = svcTypeColor(s.type)
                return (
                  <tr key={`${s.namespace}/${s.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{s.name}</td>
                    <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{s.namespace}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: 0, fontSize: 9, fontWeight: 900, background: `${tc}18`, color: tc, border: `1px solid ${tc}30`, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{s.type}</span>
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.cluster_ip || '—'}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {s.ports.length === 0 ? '—' : s.ports.map(p => `${p.port}${p.node_port ? `:${p.node_port}` : ''}/${p.protocol}`).join(', ')}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {s.external_ips.length === 0 ? '—' : s.external_ips.join(', ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Ingresses */}
      <SectionCard icon={Globe} title="Ingresses" count={info.ingresses.length}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Name', 'Namespace', 'Class', 'Hosts', 'Address']} />
            <tbody>
              {info.ingresses.length === 0 ? <EmptyRow colSpan={5} label="No ingresses found" /> : info.ingresses.map((ing, i) => (
                <tr key={`${ing.namespace}/${ing.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{ing.name}</td>
                  <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{ing.namespace}</td>
                  <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{ing.class || '—'}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{ing.hosts.length === 0 ? '—' : ing.hosts.join(', ')}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{ing.addresses.length === 0 ? '—' : ing.addresses.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Network Policies */}
      <SectionCard icon={Shield} title="Network Policies" count={info.network_policies.length}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Name', 'Namespace', 'Pod Selector', 'Policy Types']} />
            <tbody>
              {info.network_policies.length === 0 ? <EmptyRow colSpan={4} label="No network policies found — traffic between pods is unrestricted" /> : info.network_policies.map((np, i) => (
                <tr key={`${np.namespace}/${np.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{np.name}</td>
                  <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{np.namespace}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{np.pod_selector}</td>
                  <td style={{ padding: '10px 16px', fontSize: 11 }}>
                    {np.policy_types.map(t => (
                      <span key={t} style={{ marginRight: 6, padding: '3px 8px', borderRadius: 0, fontSize: 9, fontWeight: 900, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{t}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Nodes */}
      <SectionCard icon={Layers} title="Node Networking" count={info.nodes.length}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Node', 'Internal IP', 'External IP', 'Pod CIDR', 'Kubelet']} />
            <tbody>
              {info.nodes.length === 0 ? <EmptyRow colSpan={5} label="No nodes found" /> : info.nodes.map((n, i) => (
                <tr key={`${n.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 0, background: n.ready ? 'var(--success)' : 'var(--danger)' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{n.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{n.internal_ip || '—'}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{n.external_ip || '—'}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--brand-primary)' }}>{n.pod_cidr || '—'}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{n.kubelet_version || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

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
  const [logSource, setLogSource] = useState('')
  const [logSources, setLogSources] = useState<{ id: string; label: string }[]>([])
  
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
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)

  // Accounts tab needs the admin/devops-gated list endpoint — hide it otherwise
  const canSeeAccounts = can('manage-servers')
  const tabs = canSeeAccounts
    ? ['Overview', 'Networking', 'Accounts', 'Logs', 'Terminal', 'Settings']
    : ['Overview', 'Networking', 'Logs', 'Terminal', 'Settings']

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
    } catch (e: any) {
      setOsAccounts(null)
      setOsAccountsError(e.response?.data?.error || e.message)
    } finally { setOsAccountsLoading(false) }
  }

  useEffect(() => {
    if (activeTab === 'Accounts' && canSeeAccounts && osAccounts === null && !osAccountsLoading) loadOsAccounts()
  }, [activeTab])

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
    } catch (e: any) {
      toast.error('Create failed', e.response?.data?.error || e.message)
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
    } catch (e: any) { toast.error('Update failed', e.response?.data?.error || e.message) }
  }

  async function deleteOsAccount(acc: OSAccount) {
    if (!window.confirm(`Delete OS user "${acc.username}" and their home directory from ${server?.name}? This cannot be undone.`)) return
    try {
      const res = await api.delete(`/api/servers/${id}/accounts/${acc.username}`)
      if (res.data.success) {
        toast.success('User deleted', `${acc.username} removed from the server`)
        loadOsAccounts()
      } else toast.error('Delete failed', res.data.error)
    } catch (e: any) { toast.error('Delete failed', e.response?.data?.error || e.message) }
  }

  // ── Access control (per-user grants; admin only) ──
  const canManageUsers = can('manage-users')
  const [accessList, setAccessList] = useState<any[]>([])
  const [allUsers, setAllUsers] = useState<any[]>([])
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
    } catch (e: any) {
      toast.error('Grant failed', e.response?.data?.error || e.message)
    } finally { setGrantSaving(false) }
  }

  async function changeAccessLevel(accessId: number, level: string) {
    try {
      await api.put(`/api/servers/${id}/access/${accessId}`, { access_level: level })
      loadAccess()
    } catch (e: any) { toast.error('Update failed', e.response?.data?.error || e.message) }
  }

  async function revokeAccess(accessId: number) {
    try {
      await api.delete(`/api/servers/${id}/access/${accessId}`)
      toast.success('Access revoked', 'User no longer sees this server')
      loadAccess()
    } catch (e: any) { toast.error('Revoke failed', e.response?.data?.error || e.message) }
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
    } catch (err: any) {
      setNetInfo(null)
      setK8sNetInfo(null)
      toast.error('Failed to load networking data', err.response?.data?.error || err.message)
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
      } catch {}
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
      } catch {}
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
      <div className="page-header server-detail-header" style={{ marginBottom: 32, flexWrap: 'wrap', gap: 20, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1, minWidth: 0 }}>
          <div className="server-icon-large" style={{ 
            width: 56, height: 56, borderRadius: 0, 
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>
            {server.is_k8s ? <KubernetesIcon size={30} /> :
             server.os === 'darwin' ? <AppleIcon size={28} color="var(--text-primary)" /> :
             server.os === 'windows' ? <WindowsIcon size={24} color="var(--text-primary)" /> :
             server.os === 'linux'  ? <LinuxIcon size={26} color="var(--text-primary)" /> :
             <HelpCircle size={28} color="var(--text-primary)" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{server.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className={`badge badge-${server.status}`} style={{ padding: '3px 12px', borderRadius: 0 }}>
                {server.status.toUpperCase()}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>
                {server.host ? `${server.ssh_user}@${server.host}` : 'Direct Cluster API'}
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
          borderBottom: '1px solid var(--border)',
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
              padding: '16px 24px',
              fontSize: 11,
              fontWeight: 800,
              transition: 'all 0.2s',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              position: 'relative',
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em'
            }}
          >
            {tab === 'Overview'   && <Gauge size={14} />}
            {tab === 'Networking' && <Network size={14} />}
            {tab === 'Accounts'   && <Users size={14} />}
            {tab === 'Logs'       && <ScrollText size={14} />}
            {tab === 'Terminal'   && <TerminalIcon size={14} />}
            {tab === 'Settings'   && <SettingsIcon size={14} />}
            <span>{tab}</span>
            {activeTab === tab && (
              <div style={{
                position: 'absolute', bottom: -1, left: 0, right: 0,
                height: 2, background: 'var(--brand-primary)',
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
            <StatCard label="CPU LOAD"   value={latest ? `${latest.cpu_percent.toFixed(1)}%`  : 'N/A'} icon={Cpu}        color="var(--info)" />
            <StatCard label="MEMORY"     value={latest ? `${latest.mem_percent.toFixed(1)}%`  : 'N/A'} icon={MemoryStick} color="var(--success)" />
            <StatCard label="DISK USAGE" value={latest ? `${latest.disk_percent.toFixed(1)}%` : 'N/A'} icon={HardDrive}   color="var(--warning)" />
            <StatCard label="NET RX / TX" value={latest ? `${latest.net_rx_mbps.toFixed(2)} / ${latest.net_tx_mbps.toFixed(2)}` : 'N/A'} icon={Wifi} color="var(--brand-primary)" unit="MB/s" />
          </div>

          <div className="grid-stats-4">
            <StatCard label="UPTIME" value={latest ? fmtUptime(latest.uptime_seconds) : 'N/A'} icon={Gauge} color="var(--brand-primary)" />
            <StatCard label="LOAD AVG (1M)" value={latest ? latest.load_avg_1.toFixed(2) : 'N/A'} icon={Activity} color="var(--info)" />
            <StatCard
              label="MEMORY USED / TOTAL"
              value={latest && latest.mem_total_mb > 0 ? `${(latest.mem_used_mb / 1024).toFixed(1)} / ${(latest.mem_total_mb / 1024).toFixed(1)}` : 'N/A'}
              unit={latest && latest.mem_total_mb > 0 ? 'GB' : undefined}
              icon={MemoryStick} color="var(--success)"
            />
            <StatCard
              label="DISK USED / TOTAL"
              value={latest && latest.disk_total_gb > 0 ? `${latest.disk_used_gb.toFixed(0)} / ${latest.disk_total_gb.toFixed(0)}` : 'N/A'}
              unit={latest && latest.disk_total_gb > 0 ? 'GB' : undefined}
              icon={HardDrive} color="var(--warning)"
            />
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
                  <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="t" stroke="#52525b" tick={{ fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="#52525b" tick={{ fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 0, fontSize: 10, fontFamily: 'var(--font-mono)' }}
                  />
                  <Legend iconType="square" wrapperStyle={{ paddingTop: 24, fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} />
                  <Line type="monotone" dataKey="CPU"    stroke={CHART_COLORS.cpu.stroke}  dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Memory" stroke={CHART_COLORS.mem.stroke}  dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Disk"   stroke={CHART_COLORS.disk.stroke} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Network throughput */}
          {netChartData.length > 1 && (
            <div className="card" style={{ marginBottom: 28 }}>
              <div style={{ marginBottom: 20, padding: '4px 8px' }}>
                <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>Network Throughput</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Receive / transmit — MB/s</p>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={netChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="t" stroke="#52525b" tick={{ fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#52525b" tick={{ fontSize: 9, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: any) => `${v} MB/s`}
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 0, fontSize: 10, fontFamily: 'var(--font-mono)' }}
                  />
                  <Legend iconType="plainline" wrapperStyle={{ paddingTop: 16, fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} />
                  <Line type="monotone" dataKey="RX" stroke="var(--info)" dot={false} strokeWidth={2} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="TX" stroke="var(--success)" dot={false} strokeWidth={2} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* System information */}
          <div className="card" style={{ marginBottom: 28, padding: '24px' }}>
            <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}>System Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px 32px' }}>
              {[
                { k: 'Operating System', v: server.os === 'darwin' ? 'macOS' : server.os === 'linux' ? 'Linux' : server.os === 'windows' ? 'Windows' : 'Unknown' },
                { k: 'Host', v: server.host ? `${server.host}:${server.port}` : 'Direct Cluster API' },
                { k: 'SSH User', v: server.ssh_user || '—' },
                { k: 'Auth Method', v: server.auth_type === 'password' ? 'Password' : 'SSH Key' },
                { k: 'Kubernetes', v: server.is_k8s ? 'Cluster attached' : 'No' },
                { k: 'Last Metric', v: latest ? format(new Date(latest.timestamp), 'HH:mm:ss') : 'Never' },
                { k: 'Tags', v: server.tags || '—' },
                { k: 'Description', v: server.description || '—' },
              ].map(({ k, v }) => (
                <div key={k} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{k}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Networking' && (
        <div className="fade-up">
          {server?.is_k8s ? (
            <K8sNetworkingPanel info={k8sNetInfo} loading={netLoading} onRetry={loadNetworking} />
          ) : netLoading && !netInfo ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : netInfo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Summary Stats */}
              <div className="grid-stats-4">
                <StatCard label="LISTENING" value={`${netInfo.ports.filter(p => p.state === 'LISTEN').length}`} icon={Network} color="var(--info)" />
                <StatCard label="SERVICES" value={`${netInfo.services.filter(s => s.active === 'active').length}`} icon={Activity} color="var(--success)" />
                <StatCard label="FAILED" value={`${netInfo.services.filter(s => s.active === 'failed').length}`} icon={Power} color="var(--danger)" />
                <StatCard label="INTERFACES" value={`${netInfo.interfaces.length}`} icon={Wifi} color="var(--brand-primary)" />
              </div>

              {/* Listening Ports */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Network size={16} color="var(--brand-primary)" />
                  <span style={{ fontWeight: 800, fontSize: 14 }}>Listening Ports</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({netInfo.ports.length})</span>
                </div>
                {netInfo.ports.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No listening ports detected</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Proto', 'State', 'Local Address', 'Program'].map(h => (
                            <th key={h} style={{ padding: '10px 16px', fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {netInfo.ports.map((p, i) => {
                          const protoColor = (p.protocol === 'tcp' || p.protocol === 'tcp6') ? 'var(--info)' : 'var(--warning)'
                          const stateColor = p.state === 'LISTEN' ? 'var(--success)' : p.state === 'ESTABLISHED' ? 'var(--brand-primary)' : 'var(--text-muted)'
                          const localParts = p.local.split(':')
                          const localPort = localParts[localParts.length - 1]
                          const localAddr = localParts.slice(0, -1).join(':') || '::'
                          return (
                            <tr key={`${p.local}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '10px 16px' }}>
                                <span style={{ padding: '3px 8px', borderRadius: 0, fontSize: 9, fontWeight: 900, background: `${protoColor}18`, color: protoColor, border: `1px solid ${protoColor}30`, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{p.protocol}</span>
                              </td>
                              <td style={{ padding: '10px 16px' }}>
                                <span style={{ padding: '3px 8px', borderRadius: 0, fontSize: 9, fontWeight: 900, background: `${stateColor}18`, color: stateColor, border: `1px solid ${stateColor}30`, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{p.state}</span>
                              </td>
                              <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{localAddr}</span>
                                <span style={{ fontWeight: 800, color: 'var(--brand-primary)' }}>:{localPort}</span>
                              </td>
                              <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                                {p.program || '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Services */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Activity size={16} color="var(--brand-primary)" />
                  <span style={{ fontWeight: 800, fontSize: 14 }}>System Services</span>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Name', 'Active', 'Sub', 'Description'].map(h => (
                          <th key={h} style={{ padding: '10px 16px', fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)', position: 'sticky', top: 0 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {netInfo.services.filter(s => s.active === 'active' || s.active === 'failed').slice(0, 30).map(s => {
                        const ac = s.active === 'active' ? 'var(--success)' : 'var(--danger)'
                        return (
                          <tr key={s.name} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 6, height: 6, borderRadius: 0, background: ac }} />
                                {s.name}
                              </div>
                            </td>
                            <td style={{ padding: '10px 16px' }}>
                              <span style={{ padding: '3px 8px', borderRadius: 0, fontSize: 9, fontWeight: 900, background: `${ac}18`, color: ac, border: `1px solid ${ac}30`, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{s.active}</span>
                            </td>
                            <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{s.sub}</td>
                            <td style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Network Interfaces */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Wifi size={16} color="var(--brand-primary)" />
                  <span style={{ fontWeight: 800, fontSize: 14 }}>Network Interfaces</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Interface', 'IP Address', 'MTU', 'Traffic'].map(h => (
                          <th key={h} style={{ padding: '10px 16px', fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {netInfo.interfaces.map(iface => {
                        const sc = iface.state === 'UP' ? 'var(--success)' : 'var(--text-muted)'
                        const fmtBytes = (b: string) => { const n = parseInt(b); if (isNaN(n) || n === 0) return '0 B'; const u = ['B','KB','MB','GB']; const i = Math.floor(Math.log(n)/Math.log(1024)); return (n/Math.pow(1024,i)).toFixed(i>0?1:0)+' '+u[i]; }
                        return (
                          <tr key={iface.name} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 6, height: 6, borderRadius: 0, background: sc }} />
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{iface.name}</span>
                              </div>
                            </td>
                            <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{iface.ipv4 || '—'}</td>
                            <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{iface.mtu}</td>
                            <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                              <span style={{ color: 'var(--success)' }}>RX {fmtBytes(iface.rx_bytes)}</span>
                              <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>/</span>
                              <span style={{ color: 'var(--info)' }}>TX {fmtBytes(iface.tx_bytes)}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <Network size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontSize: 13 }}>Unable to load networking data</div>
              <button className="btn btn-secondary" onClick={loadNetworking} style={{ marginTop: 16 }}>Retry</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'Accounts' && canSeeAccounts && (
        <div className="fade-up">
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Users size={16} color="var(--brand-primary)" />
                <span style={{ fontWeight: 800, fontSize: 14 }}>OS Accounts</span>
                {osAccounts && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({osAccounts.length})</span>}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary btn-sm" onClick={loadOsAccounts} disabled={osAccountsLoading}>
                  <RefreshCw size={13} style={osAccountsLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                </button>
                {canManageUsers && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowCreateAccount(v => !v)} style={{ gap: 6 }}>
                    <Plus size={13} /> Create User
                  </button>
                )}
              </div>
            </div>

            {showCreateAccount && canManageUsers && (
              <div style={{ padding: 20, borderBottom: '1px solid var(--border)', background: 'var(--bg-app)' }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 150px' }}>
                    <label className="input-label">Username</label>
                    <input className="input" placeholder="e.g. deploy" value={newAcc.username} onChange={e => setNewAcc(a => ({ ...a, username: e.target.value }))} />
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label className="input-label">Password</label>
                    <input className="input" type="password" placeholder="min 6 characters" value={newAcc.password} onChange={e => setNewAcc(a => ({ ...a, password: e.target.value }))} />
                    {newAcc.password.length > 0 && newAcc.password.length < 6 && (
                      <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700 }}>Password must be at least 6 characters</span>
                    )}
                  </div>
                  <div style={{ flex: '1 1 170px' }}>
                    <label className="input-label">Privilege</label>
                    <select className="input" value={newAcc.privilege} onChange={e => setNewAcc(a => ({ ...a, privilege: e.target.value }))}>
                      {PRIVILEGES.map(p => (
                        <option key={p.value} value={p.value} disabled={server.os === 'darwin' && !['admin', 'standard'].includes(p.value)}>
                          {p.label}{server.os === 'darwin' && !['admin', 'standard'].includes(p.value) ? ' (linux only)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: '2 1 220px' }}>
                    <label className="input-label">SSH Public Key (optional{server.os === 'darwin' ? ', linux only' : ''})</label>
                    <input className="input" placeholder="ssh-ed25519 AAAA…" value={newAcc.ssh_key} onChange={e => setNewAcc(a => ({ ...a, ssh_key: e.target.value }))} disabled={server.os === 'darwin'} />
                  </div>
                  <button className="btn btn-primary" onClick={createOsAccount} disabled={accBusy || !newAcc.username || newAcc.password.length < 6} style={{ height: 40 }}>
                    {accBusy ? 'Creating…' : 'Create on Server'}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: newAcc.privilege === 'admin' ? 'var(--warning)' : 'var(--text-muted)', marginTop: 12 }}>
                  {newAcc.privilege === 'admin' && '⚠ '}
                  {PRIVILEGES.find(p => p.value === newAcc.privilege)?.hint}
                </p>
              </div>
            )}

            {osAccountsLoading && !osAccounts ? (
              <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
                <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} color="var(--brand-primary)" />
              </div>
            ) : osAccountsError ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Users size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
                <div style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>{osAccountsError}</div>
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 14 }} onClick={loadOsAccounts}>Retry</button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="k-table" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>UID</th>
                      <th>Privilege</th>
                      <th>Shell</th>
                      <th>Home</th>
                      {canManageUsers && <th style={{ textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(osAccounts || []).map(acc => {
                      const isConnUser = acc.username === server.ssh_user
                      const isRoot = acc.username === 'root'
                      return (
                        <tr key={acc.username}>
                          <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                            {acc.username}
                            {isConnUser && <span style={{ marginLeft: 8, fontSize: 8, fontWeight: 900, color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)40', padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>CONNECTION</span>}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{acc.uid}</td>
                          <td>
                            {canManageUsers && !isRoot && !(isConnUser) ? (
                              <select
                                className="input"
                                style={{ height: 30, width: 150, fontSize: 11, fontWeight: 700 }}
                                value={acc.privilege}
                                onChange={e => setOsPrivilege(acc, e.target.value)}
                              >
                                {PRIVILEGES.map(p => (
                                  <option key={p.value} value={p.value} disabled={server.os === 'darwin' && !['admin', 'standard'].includes(p.value)}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 900, color: acc.is_admin ? 'var(--warning)' : 'var(--text-muted)' }}>
                                {acc.is_admin && <Shield size={11} />} {privLabel(acc.privilege).toUpperCase()}
                              </span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{acc.shell || '—'}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{acc.home || '—'}</td>
                          {canManageUsers && (
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 8 }}>
                                {!isRoot && !isConnUser && (
                                  <button className="btn-icon" title="Delete user" onClick={() => deleteOsAccount(acc)} style={{ color: 'var(--danger)' }}>
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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
                  {logSources.length > 0 && (
                    <select
                      className="input"
                      value={logSource}
                      onChange={e => switchLogSource(e.target.value)}
                      title="Log source"
                      style={{ height: 36, fontSize: 12, fontWeight: 700, width: 200, fontFamily: 'var(--font-mono)' }}
                    >
                      {logSources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  )}
                  <div className="search-box search-container" style={{ minWidth: 160, maxWidth: 240 }}>
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
           {canManageUsers && (
             <div className="card" style={{ marginBottom: 24 }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                 <Shield size={16} color="var(--brand-primary)" />
                 <h3 style={{ fontWeight: 800, fontSize: 16 }}>Access Control</h3>
               </div>
               <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
                 Grant trainee/intern users visibility of this {server.is_k8s ? 'cluster' : 'server'}. Admin and DevOps roles always have access. Users without a grant cannot see it anywhere in the app.
               </p>

               <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
                 <select className="input" style={{ flex: '1 1 200px', height: 38 }} value={grantUserId} onChange={e => setGrantUserId(e.target.value)}>
                   <option value="">Select a user…</option>
                   {allUsers
                     .filter(u => !['admin', 'devops'].includes(u.role) && !accessList.some(a => a.user_id === u.id))
                     .map(u => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
                 </select>
                 <select className="input" style={{ width: 130, height: 38 }} value={grantLevel} onChange={e => setGrantLevel(e.target.value)}>
                   <option value="read">Read</option>
                   <option value="operate">Operate</option>
                 </select>
                 <button className="btn btn-primary" style={{ height: 38 }} onClick={grantAccess} disabled={!grantUserId || grantSaving}>
                   {grantSaving ? 'Granting…' : 'Grant Access'}
                 </button>
               </div>

               {accessList.length === 0 ? (
                 <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                   No per-user grants yet — only Admin and DevOps can see this {server.is_k8s ? 'cluster' : 'server'}.
                 </div>
               ) : (
                 <div style={{ overflowX: 'auto' }}>
                   <table className="k-table" style={{ minWidth: 480 }}>
                     <thead>
                       <tr>
                         <th>User</th>
                         <th>Role</th>
                         <th>Access Level</th>
                         <th style={{ textAlign: 'right' }}>Actions</th>
                       </tr>
                     </thead>
                     <tbody>
                       {accessList.map(a => (
                         <tr key={a.id}>
                           <td style={{ fontWeight: 700 }}>{a.user?.username || `user #${a.user_id}`}</td>
                           <td style={{ textTransform: 'capitalize' }}>{a.user?.role || '—'}</td>
                           <td>
                             <select className="input" style={{ height: 32, width: 120, fontSize: 12 }} value={a.access_level} onChange={e => changeAccessLevel(a.id, e.target.value)}>
                               <option value="read">Read</option>
                               <option value="operate">Operate</option>
                             </select>
                           </td>
                           <td style={{ textAlign: 'right' }}>
                             <button className="btn-icon" title="Revoke access" onClick={() => revokeAccess(a.id)} style={{ color: 'var(--danger)' }}>
                               <Trash2 size={14} />
                             </button>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               )}
             </div>
           )}

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
