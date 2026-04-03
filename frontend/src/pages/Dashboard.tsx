import { useEffect, useState, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, Cpu, MemoryStick, HardDrive, Wifi,
  Plus, RefreshCw, AlertTriangle, ArrowRight, TrendingUp, Activity, HelpCircle,
  Boxes, Search, X, Terminal, Settings
} from 'lucide-react'
import { useUIStore } from '../store/uiStore'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { api, buildWsUrl } from '../api/client'

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

const StatCard = memo(({
  label, value, icon: Icon, color, delta
}: {
  label: string; value: string | number; icon: any;
  color: string; delta?: string
}) => {
  return (
    <div className="card stat-card fade-up" style={{ padding: '16px 20px' }}>
      <div
        className="stat-icon-wrapper"
        style={{ background: `${color}10`, border: `1px solid ${color}25`, width: 36, height: 36, borderRadius: 10 }}
      >
        <Icon size={18} color={color} />
      </div>
      <div className="stat-val-group">
        <div className="stat-value" style={{ fontSize: 20 }}>{value}</div>
        <div className="stat-label" style={{ fontSize: 11 }}>{label}</div>
        {delta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <TrendingUp size={10} color={color} />
            <span style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: '0.02em' }}>{delta}</span>
          </div>
        )}
      </div>
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
      <div className="server-card-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: `${statusColor}10`, border: `1px solid ${statusColor}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {server.is_k8s ? <KubernetesIcon size={22} /> :
             server.os === 'darwin' ? <AppleIcon size={18} color={statusColor} /> :
             server.os === 'windows'? <WindowsIcon size={16} color={statusColor} /> :
             server.os === 'linux'  ? <LinuxIcon size={16} color={statusColor} /> :
             <HelpCircle size={18} color={statusColor} />}
          </div>
          <div className="server-info-top" style={{ flex: 1, minWidth: 0 }}>
            {/* Name + OS pill on one line, truncated */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <div className="server-name" style={{ 
                fontSize: 15, fontWeight: 700, 
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: '100%'
              }}>
                {server.name}
              </div>
              <span style={{
                fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 4,
                background: server.os === 'darwin' ? 'rgba(255,255,255,0.1)' : 'rgba(129,140,248,0.15)',
                color: server.os === 'darwin' ? '#fff' : 'var(--brand-primary)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
                border: '1px solid rgba(255,255,255,0.05)',
                flexShrink: 0,
              }}>
                {server.os?.toUpperCase() || 'HOST'}
              </span>
            </div>
            {/* Status badge + host on second line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <span className={`badge badge-${server.status}`} style={{ fontSize: 10, padding: '2px 8px' }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', background: statusColor,
                  display: 'inline-block', marginRight: 4,
                  boxShadow: server.status === 'online' ? `0 0 6px ${statusColor}` : undefined,
                }} />
                {server.status.toUpperCase()}
              </span>
              <div className="server-host" style={{ fontSize: 11 }}>
                {server.host ? `${server.ssh_user}@${server.host}` : 'Direct API Only'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {metric ? (
        <div className="server-metric-stack" style={{ margin: '20px 0' }}>
          {[
            { label: 'CPU', value: metric.cpu_percent, icon: <Cpu size={12} /> },
            { label: 'MEM', value: metric.mem_percent, icon: <MemoryStick size={12} /> },
            { label: 'DISK', value: metric.disk_percent, icon: <HardDrive size={12} /> },
            { label: 'NET', value: 0, icon: <Wifi size={12} />, display: `${metric.net_rx_mbps.toFixed(2)} / ${metric.net_tx_mbps.toFixed(2)} MB/s` },
          ].map(({ label, value, icon, display }) => (
            <div key={label} className="metric-row">
              <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {icon} {label}
              </div>
              {label === 'NET' ? (
                <div style={{ flex: 1, textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {display}
                </div>
              ) : (
                <>
                  <MetricBar value={value} />
                  <span className="metric-percent" style={{
                    color: value >= 80 ? 'var(--danger)' : value >= 60 ? 'var(--warning)' : 'var(--text-secondary)',
                    fontWeight: 600,
                  }}>
                    {value.toFixed(0)}%
                  </span>
                </>
              )}
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
                <span key={t} className="server-tag" style={{ fontSize: 10, padding: '2px 6px' }}>{t.trim()}</span>
              ))
            : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>No tags</span>
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
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  async function loadData() {
    setLoading(true)
    try {
      const serversRes = await api.get('/api/servers')
      const list = Array.isArray(serversRes.data) ? serversRes.data : []
      setServers(list)
      
      // Stop full-page loading once servers are listed
      setLoading(false)

      // Fetch metrics in parallel but update state incrementally
      list.forEach(async (s: ServerData) => {
        try {
          const m = await api.get(`/api/servers/${s.id}/metrics/latest`)
          setMetrics(prev => ({ ...prev, [s.id]: m.data }))
        } catch { /* no metrics yet */ }
      })
    } catch (err) {
      console.error('Failed to load servers', err)
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
          <div className="search-container">
            <Search 
              size={14} 
              color="var(--text-muted)" 
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} 
            />
            <input
              type="text"
              placeholder="Search..."
              className="input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 38, height: 40 }}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                style={{ 
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
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

      <div className="grid-stats" style={{ marginBottom: 48 }}>
        <StatCard label="Total Servers" value={loading ? 'N/A' : (total - k8sServers)} icon={Server} color="var(--brand-primary)" />
        <StatCard label="K8s Clusters" value={loading ? 'N/A' : k8sServers} icon={Boxes} color="var(--info)" />
        <StatCard label="Status Online" value={loading ? 'N/A' : online} icon={Wifi} color="var(--success)" delta={total > 0 ? `${((online / total) * 100).toFixed(0)}% uptime` : undefined} />
        <StatCard label="Status Offline" value={loading ? 'N/A' : offline} icon={AlertTriangle} color={offline > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
        <StatCard label="Global Avg CPU" value={loading ? 'N/A' : avgCpu} icon={TrendingUp} color="var(--warning)" />
      </div>

      {!loading && servers.length > 0 && (
        <div className="card fade-up" style={{ marginBottom: 48, padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(79, 70, 229, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' }}>
              <Activity size={20} color="var(--brand-primary)" />
            </div>
            <div>
              <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>Performance Analytics</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>Resource utilization across connected nodes</p>
            </div>
          </div>
          <div style={{ height: 300, marginTop: 32 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analyticsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} />
                <XAxis dataKey="name" stroke="var(--text-muted)" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} stroke="var(--text-muted)" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '12px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: 20, fontSize: 11 }} />
                <Bar dataKey="CPU" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Memory" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Disk" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
          
          {/* Managed Clusters Section */}
          {filteredServers.filter(s => s.is_k8s).length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(79, 70, 229, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' }}>
                  <KubernetesIcon size={18} />
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Managed Clusters</h2>
                <div className="badge hidden-mobile" style={{ marginLeft: 'auto', background: 'var(--brand-glow)', color: 'var(--brand-primary)', border: '1px solid var(--brand-primary)20' }}>
                  {filteredServers.filter(s => s.is_k8s).length} ACTIVE
                </div>
              </div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(79, 70, 229, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' }}>
                  <Server size={18} color="var(--brand-primary)" />
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Resource Fleet</h2>
                <div className="badge hidden-mobile" style={{ marginLeft: 'auto', background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  {filteredServers.filter(s => !s.is_k8s).length} NODES
                </div>
              </div>
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
