import { useEffect, useState, useMemo, memo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, RefreshCw, Search,
  Wifi, Globe, Server, Activity, Power,
  Loader2, HelpCircle, Network,
  ChevronDown, ChevronUp
} from 'lucide-react'
import { api } from '../api/client'
import { LinuxIcon, AppleIcon } from '../components/OSIcons'
import { useToastStore } from '../store/toastStore'
import { apiError } from '../utils/errors'
import type { IconComponent } from '../types/k8s'

interface Server {
  id: number; name: string; host: string; status: string; os: string; ssh_user: string;
}
interface ListeningPort {
  protocol: string; state: string; recv_q: string; send_q: string;
  local: string; remote: string; program: string; pid: string;
}
interface SystemService {
  name: string; load: string; active: string; sub: string; description: string;
}
interface NetworkInterface {
  name: string; flags: string; mtu: string; state: string;
  ipv4: string; ipv6: string;
  rx_bytes: string; tx_bytes: string; rx_packets: string; tx_packets: string;
}
interface NetworkingInfo {
  hostname: string;
  ports: ListeningPort[];
  services: SystemService[];
  interfaces: NetworkInterface[];
  uptime: string;
}

const PROTO_COLORS: Record<string, string> = {
  tcp: 'var(--info)', tcp6: 'var(--info)',
  udp: 'var(--warning)', udp6: 'var(--warning)',
}
const STATE_COLORS: Record<string, string> = {
  LISTEN: 'var(--success)',
  ESTABLISHED: 'var(--brand-primary)',
  'TIME-WAIT': 'var(--text-muted)',
  'CLOSE-WAIT': 'var(--danger)',
  'SYN-SENT': 'var(--warning)',
  'SYN-RECV': 'var(--warning)',
}

function formatBytes(b: string): string {
  const n = parseInt(b)
  if (isNaN(n) || n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return (n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

const StatCard = memo(({ label, value, icon: Icon, color }: { label: string; value: string; icon: IconComponent; color: string }) => (
  <div className="card" style={{ padding: '20px 24px', border: '1px solid var(--border)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 0,
        background: 'transparent', border: `1px solid var(--border-bright)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        <Icon size={16} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>{label}</div>
      </div>
    </div>
  </div>
))

function PortRow({ port }: { port: ListeningPort }) {
  const protoColor = PROTO_COLORS[port.protocol] || 'var(--text-muted)'
  const stateColor = STATE_COLORS[port.state] || 'var(--text-muted)'
  const localParts = port.local.split(':')
  const localPort = localParts[localParts.length - 1]
  const localAddr = localParts.slice(0, -1).join(':') || '::'

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 800 }}>
        <span style={{
          padding: '3px 8px', borderRadius: 0, fontSize: 11, fontWeight: 900,
          background: `${protoColor}18`, color: protoColor,
          border: `1px solid ${protoColor}30`, textTransform: 'uppercase', letterSpacing: '0.05em'
        }}>
          {port.protocol}
        </span>
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 800 }}>
        <span style={{
          padding: '3px 8px', borderRadius: 0, fontSize: 11, fontWeight: 900,
          background: `${stateColor}18`, color: stateColor,
          border: `1px solid ${stateColor}30`, textTransform: 'uppercase', letterSpacing: '0.05em'
        }}>
          {port.state}
        </span>
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{localAddr}</span>
          <span style={{ fontWeight: 800, color: 'var(--brand-primary)' }}>:{localPort}</span>
        </div>
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {port.remote && port.remote !== '*' && port.remote !== '0.0.0.0:*' && port.remote !== '[::]:*' && port.remote !== '*:*' ? port.remote : '—'}
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        {port.program ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Server size={12} color="var(--text-muted)" />
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{port.program}</span>
            {port.pid && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>PID {port.pid}</span>}
          </div>
        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
    </tr>
  )
}

function ServiceRow({ svc }: { svc: SystemService }) {
  const activeColor = svc.active === 'active' ? 'var(--success)' : svc.active === 'failed' ? 'var(--danger)' : 'var(--text-muted)'
  const subColor = svc.sub === 'running' ? 'var(--success)' : svc.sub === 'dead' ? 'var(--text-muted)' : svc.sub === 'exited' ? 'var(--warning)' : 'var(--text-muted)'

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: 0, background: activeColor, flexShrink: 0 }} />
          {svc.name}
        </div>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <span style={{
          padding: '3px 8px', borderRadius: 0, fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)',
          background: `${activeColor}18`, color: activeColor,
          border: `1px solid ${activeColor}30`, textTransform: 'uppercase', letterSpacing: '0.05em'
        }}>
          {svc.active}
        </span>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <span style={{
          padding: '3px 8px', borderRadius: 0, fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)',
          background: `${subColor}18`, color: subColor,
          border: `1px solid ${subColor}30`, textTransform: 'uppercase', letterSpacing: '0.05em'
        }}>
          {svc.sub}
        </span>
      </td>
      <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {svc.description}
      </td>
    </tr>
  )
}

function InterfaceRow({ iface }: { iface: NetworkInterface }) {
  const stateColor = iface.state === 'UP' ? 'var(--success)' : 'var(--text-muted)'
  const isUp = iface.state === 'UP'

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: 0, background: stateColor, flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{iface.name}</span>
          <span style={{
            padding: '2px 6px', borderRadius: 0, fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)',
            background: `${stateColor}18`, color: stateColor,
            border: `1px solid ${stateColor}30`, textTransform: 'uppercase'
          }}>
            {iface.state}
          </span>
        </div>
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 700, color: isUp ? 'var(--text-primary)' : 'var(--text-muted)' }}>{iface.ipv4 || '—'}</span>
          {iface.ipv6 && iface.ipv6 !== '—' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{iface.ipv6}</span>}
        </div>
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
        {iface.mtu}
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>RX {formatBytes(iface.rx_bytes)}</span>
          <span style={{ color: 'var(--info)', fontWeight: 600 }}>TX {formatBytes(iface.tx_bytes)}</span>
        </div>
      </td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--text-muted)' }}>RX {iface.rx_packets}</span>
          <span style={{ color: 'var(--text-muted)' }}>TX {iface.tx_packets}</span>
        </div>
      </td>
    </tr>
  )
}

type Tab = 'ports' | 'services' | 'interfaces'

export function Networking() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const [server, setServer] = useState<Server | null>(null)
  const [info, setInfo] = useState<NetworkingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('ports')
  const [serviceFilter, setServiceFilter] = useState<'all' | 'active' | 'failed'>('all')
  const [portsExpanded, setPortsExpanded] = useState(true)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [serverRes, netRes] = await Promise.all([
        api.get(`/api/servers/${id}`),
        api.get(`/api/servers/${id}/networking`)
      ])
      setServer(serverRes.data)
      setInfo({
        ...netRes.data,
        ports: netRes.data?.ports || [],
        services: netRes.data?.services || [],
        interfaces: netRes.data?.interfaces || [],
      })
    } catch (err: unknown) {
      toast.error('Failed to load', apiError(err) || 'Could not fetch networking data')
    } finally {
      setLoading(false)
    }
  }

  const filteredPorts = useMemo(() => {
    if (!info) return []
    if (!search) return info.ports
    const q = search.toLowerCase()
    return info.ports.filter(p =>
      p.protocol.toLowerCase().includes(q) ||
      p.state.toLowerCase().includes(q) ||
      p.local.toLowerCase().includes(q) ||
      p.remote.toLowerCase().includes(q) ||
      (p.program || '').toLowerCase().includes(q) ||
      p.pid.includes(q)
    )
  }, [info, search])

  const filteredServices = useMemo(() => {
    if (!info) return []
    let list = info.services
    if (serviceFilter !== 'all') list = list.filter(s => s.active === serviceFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.active.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      )
    }
    return list
  }, [info, search, serviceFilter])

  const filteredInterfaces = useMemo(() => {
    if (!info) return []
    if (!search) return info.interfaces
    const q = search.toLowerCase()
    return info.interfaces.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.ipv4.toLowerCase().includes(q) ||
      i.ipv6.toLowerCase().includes(q) ||
      i.state.toLowerCase().includes(q)
    )
  }, [info, search])

  const activeCount = info?.services.filter(s => s.active === 'active').length || 0
  const failedCount = info?.services.filter(s => s.active === 'failed').length || 0
  const listenCount = info?.ports.filter(p => p.state === 'LISTEN').length || 0

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => navigate(`/servers/${id}`)} style={{ padding: '8px 10px', borderRadius: 10 }}>
          <ArrowLeft size={16} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span className="hidden-mobile">Infrastructure</span>
          <ChevronRight size={14} className="hidden-mobile" />
          <span>Servers</span>
          <ChevronRight size={14} />
          <span style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>{server.name}</span>
          <ChevronRight size={14} />
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Networking</span>
        </div>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 32, flexWrap: 'wrap', gap: 20, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 0,
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            {server.os === 'darwin' ? <AppleIcon size={28} color="var(--text-primary)" /> :
             server.os === 'linux' ? <LinuxIcon size={26} color="var(--text-primary)" /> :
             <HelpCircle size={28} color="var(--text-primary)" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontSize: 24, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {server.name}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className={`badge badge-${server.status}`} style={{ padding: '3px 12px', borderRadius: 'var(--radius-sm)' }}>
                {server.status.toUpperCase()}
              </span>
              {info && (
                <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {info.uptime}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button className="btn btn-primary" onClick={loadData} disabled={loading} style={{ gap: 8 }}>
            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
            <span className="hidden-mobile">Refresh</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid-stats-4" style={{ marginBottom: 32 }}>
        <StatCard label="LISTENING PORTS" value={`${listenCount}`} icon={Network} color="var(--info)" />
        <StatCard label="ACTIVE SERVICES" value={`${activeCount}`} icon={Activity} color="var(--success)" />
        <StatCard label="FAILED SERVICES" value={`${failedCount}`} icon={Power} color={failedCount > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
        <StatCard label="INTERFACES" value={`${info?.interfaces.length || 0}`} icon={Globe} color="var(--brand-primary)" />
      </div>

      {/* Search & Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap', flexShrink: 0 }}>
        <div className="search-box" style={{ position: 'relative', flex: 1, maxWidth: 360, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Filter ports, services, interfaces..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 34, height: 36, fontSize: 13, width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 0, overflow: 'hidden' }}>
          {([
            { key: 'ports' as Tab, label: 'Ports', icon: Network },
            { key: 'services' as Tab, label: 'Services', icon: Activity },
            { key: 'interfaces' as Tab, label: 'Interfaces', icon: Wifi },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setSearch(''); }}
              style={{
                padding: '8px 16px', fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                background: activeTab === key ? 'var(--brand-primary)' : 'transparent',
                color: activeTab === key ? 'var(--text-inverse)' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s'
              }}
            >
              <Icon size={13} /> {label}
              {key === 'services' && failedCount > 0 && (
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)',
                  display: 'inline-block', marginLeft: 2
                }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="fade-up" style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }}>
        {/* ── Ports Tab ── */}
        {activeTab === 'ports' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Network size={16} color="var(--brand-primary)" />
                <span style={{ fontWeight: 800, fontSize: 14 }}>Listening Ports</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({filteredPorts.length})</span>
              </div>
              <button onClick={() => setPortsExpanded(!portsExpanded)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                {portsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            {portsExpanded && (
              filteredPorts.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Network size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
                  <div style={{ fontSize: 13 }}>{search ? 'No ports match the filter' : 'No listening ports detected'}</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Protocol', 'State', 'Local Address', 'Remote Address', 'Program'].map(h => (
                          <th key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPorts.map((p, i) => <PortRow key={`${p.local}-${p.protocol}-${i}`} port={p} />)}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        )}

        {/* ── Services Tab ── */}
        {activeTab === 'services' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Activity size={16} color="var(--brand-primary)" />
                <span style={{ fontWeight: 800, fontSize: 14 }}>System Services</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({filteredServices.length})</span>
              </div>
              <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 0, overflow: 'hidden' }}>
                {(['all', 'active', 'failed'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setServiceFilter(f)}
                    style={{
                      padding: '4px 12px', fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono)',
                      textTransform: 'uppercase',
                      background: serviceFilter === f ? 'var(--brand-primary)' : 'transparent',
                      color: serviceFilter === f ? 'var(--text-inverse)' : 'var(--text-muted)',
                      border: 'none', cursor: 'pointer', transition: 'all 0.15s'
                    }}
                  >
                    {f === 'failed' ? `FAILED (${info?.services.filter(s => s.active === 'failed').length || 0})` : f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {filteredServices.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Activity size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>{search ? 'No services match the filter' : 'No services found'}</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Name', 'Active', 'Sub', 'Description'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredServices.map(s => <ServiceRow key={s.name} svc={s} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Interfaces Tab ── */}
        {activeTab === 'interfaces' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Wifi size={16} color="var(--brand-primary)" />
              <span style={{ fontWeight: 800, fontSize: 14 }}>Network Interfaces</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>({filteredInterfaces.length})</span>
            </div>
            {filteredInterfaces.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Wifi size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>{search ? 'No interfaces match the filter' : 'No network interfaces found'}</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Interface', 'IP Address', 'MTU', 'Traffic', 'Packets'].map(h => (
                        <th key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInterfaces.map(i => <InterfaceRow key={i.name} iface={i} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
