import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, Cpu, MemoryStick, HardDrive, Wifi,
  Plus, RefreshCw, AlertTriangle, ArrowRight, TrendingUp,
} from 'lucide-react'
import { api } from '../api/client'

interface ServerData {
  id: number; name: string; host: string; status: string;
  tags: string; description: string; port: number; ssh_user: string;
}
interface MetricData {
  cpu_percent: number; mem_percent: number; disk_percent: number;
  net_rx_mbps: number; net_tx_mbps: number; load_avg_1: number;
}

function MetricBar({ value, danger = 80, warn = 60 }: { value: number; danger?: number; warn?: number }) {
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
}

function StatCard({
  label, value, icon: Icon, color, delta
}: {
  label: string; value: string | number; icon: any;
  color: string; delta?: string
}) {
  return (
    <div className="card stat-card fade-up">
      <div
        className="stat-icon-wrapper"
        style={{ background: `${color}10`, border: `1px solid ${color}25` }}
      >
        <Icon size={20} color={color} />
      </div>
      <div className="stat-val-group">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {delta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <TrendingUp size={10} color={color} />
            <span style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: '0.02em' }}>{delta}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function ServerCard({ server, metric }: { server: ServerData; metric?: MetricData }) {
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
      style={{ cursor: 'pointer', padding: 24 }}
    >
      {/* Header */}
      <div className="server-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: `${statusColor}10`, border: `1px solid ${statusColor}25`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Server size={18} color={statusColor} />
          </div>
          <div className="server-info-top">
            <div className="server-name">{server.name}</div>
            <div className="server-host">{server.ssh_user}@{server.host}</div>
          </div>
        </div>
        <span className={`badge badge-${server.status}`}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: statusColor,
            boxShadow: server.status === 'online' ? `0 0 8px ${statusColor}` : undefined,
          }} />
          {server.status}
        </span>
      </div>

      {/* Metrics */}
      {metric ? (
        <div className="server-metric-stack" style={{ margin: '24px 0' }}>
          {[
            { label: 'CPU', value: metric.cpu_percent, icon: <Cpu size={12} /> },
            { label: 'MEM', value: metric.mem_percent, icon: <MemoryStick size={12} /> },
            { label: 'DISK', value: metric.disk_percent, icon: <HardDrive size={12} /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="metric-row">
              <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {icon} {label}
              </div>
              <MetricBar value={value} />
              <span className="metric-percent" style={{
                color: value >= 80 ? 'var(--danger)' : value >= 60 ? 'var(--warning)' : 'var(--text-secondary)',
                fontWeight: 600,
              }}>
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

      {/* Footer */}
      <div className="server-card-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <div className="server-tag-group">
          {server.tags
            ? server.tags.split(',').map(t => (
                <span key={t} className="server-tag">{t.trim()}</span>
              ))
            : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tags</span>
          }
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--brand-primary)', fontWeight: 700 }}>
          Manage <ArrowRight size={13} />
        </div>
      </div>
    </div>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const [servers, setServers] = useState<ServerData[]>([])
  const [metrics, setMetrics] = useState<Record<number, MetricData>>({})
  const [loading, setLoading] = useState(true)

  async function loadData() {
    setLoading(true)
    try {
      const serversRes = await api.get('/api/servers')
      setServers(serversRes.data)
      const metricMap: Record<number, MetricData> = {}
      await Promise.all(
        serversRes.data.map(async (s: ServerData) => {
          try {
            const m = await api.get(`/api/servers/${s.id}/metrics/latest`)
            metricMap[s.id] = m.data
          } catch { /* no metrics yet */ }
        })
      )
      setMetrics(metricMap)
    } catch (err) {
      console.error('Failed to load servers', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const online  = servers.filter(s => s.status === 'online').length
  const offline = servers.filter(s => s.status === 'offline').length
  const total   = servers.length
  const metricValues = Object.values(metrics)
  const avgCpu = metricValues.length > 0
    ? (metricValues.reduce((a, m) => a + m.cpu_percent, 0) / metricValues.length).toFixed(1) + '%'
    : '—'

  return (
    <div className="page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Command Center</h1>
          <p className="page-subtitle">Infrastructure Overview — {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={loadData} disabled={loading} style={{ height: 42, padding: '0 20px' }}>
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/servers?add=1')} style={{ height: 42, padding: '0 20px' }}>
            <Plus size={16} /> Add Server
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid-stats" style={{ marginBottom: 48 }}>
        <StatCard
          label="Total Servers"
          value={loading ? '—' : total}
          icon={Server}
          color="var(--brand-primary)"
        />
        <StatCard
          label="Status Online"
          value={loading ? '—' : online}
          icon={Wifi}
          color="var(--success)"
          delta={total > 0 ? `${((online / total) * 100).toFixed(0)}% uptime` : undefined}
        />
        <StatCard
          label="Status Offline"
          value={loading ? '—' : offline}
          icon={AlertTriangle}
          color={offline > 0 ? 'var(--danger)' : 'var(--text-muted)'}
        />
        <StatCard
          label="Global Avg CPU"
          value={loading ? '—' : avgCpu}
          icon={TrendingUp}
          color="var(--warning)"
        />
      </div>

      {/* Server Grid / Empty State */}
      {loading ? (
        <div className="empty-state">
           <div style={{
            width: 48, height: 48, borderRadius: '50%',
            border: '3px solid var(--border)',
            borderTopColor: 'var(--brand-primary)',
            animation: 'spin 0.8s linear infinite',
          }} />
        </div>
      ) : servers.length === 0 ? (
        <div className="empty-state fade-up">
          <div style={{
            width: 100, height: 100, borderRadius: 32,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <Server size={44} color="var(--brand-primary)" />
          </div>
          <p>No servers connected</p>
          <span>Get started by adding your first server to the platform for monitoring.</span>
          <button className="btn btn-primary" style={{ height: 48, padding: '0 32px', fontSize: 15 }} onClick={() => navigate('/servers?add=1')}>
            <Plus size={18} /> Add Your First Server
          </button>
        </div>
      ) : (
        <div className="grid-cards">
          {servers.map((s, i) => (
            <div key={s.id} style={{ animationDelay: `${i * 50}ms` }}>
              <ServerCard server={s} metric={metrics[s.id]} />
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
