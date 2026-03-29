import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Cpu, MemoryStick, HardDrive, Wifi, Plus, RefreshCw, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'

interface ServerData {
  id: number;  name: string; host: string; status: string;
  tags: string; description: string; port: number; ssh_user: string;
}
interface MetricData {
  cpu_percent: number; mem_percent: number; disk_percent: number;
  net_rx_mbps: number; net_tx_mbps: number; load_avg_1: number;
}

function MetricBar({ value, danger = 80, warn = 60 }: { value: number; danger?: number; warn?: number }) {
  const color = value >= danger ? 'var(--danger)' : value >= warn ? 'var(--warning)' : 'var(--success)'
  return (
    <div className="metric-bar">
      <div className="metric-bar-fill" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
    </div>
  )
}

function ServerCard({ server, metric }: { server: ServerData; metric?: MetricData }) {
  const navigate = useNavigate()
  return (
    <div className="server-card fade-in" onClick={() => navigate(`/servers/${server.id}`)}>
      <div className="server-card-header">
        <div className="server-card-icon"><Server size={18} /></div>
        <div>
          <h3 className="server-card-name">{server.name}</h3>
          <span className="server-card-host">{server.host}</span>
        </div>
        <span className={`badge badge-${server.status}`}>{server.status}</span>
      </div>

      {metric ? (
        <div className="server-card-metrics">
          <div className="metric-row">
            <div className="metric-label"><Cpu size={12} /> CPU</div>
            <MetricBar value={metric.cpu_percent} />
            <span className="metric-value">{metric.cpu_percent.toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <div className="metric-label"><MemoryStick size={12} /> MEM</div>
            <MetricBar value={metric.mem_percent} />
            <span className="metric-value">{metric.mem_percent.toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <div className="metric-label"><HardDrive size={12} /> DISK</div>
            <MetricBar value={metric.disk_percent} />
            <span className="metric-value">{metric.disk_percent.toFixed(1)}%</span>
          </div>
        </div>
      ) : (
        <div className="server-card-no-metrics">
          <Wifi size={14} /> No metrics yet
        </div>
      )}

      {server.tags && (
        <div className="server-card-tags">
          {server.tags.split(',').map(t => (
            <span key={t} className="server-tag">{t.trim()}</span>
          ))}
        </div>
      )}
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
      // Fetch latest metric for each server
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Real-time overview of all connected servers</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/servers?add=1')}>
            <Plus size={14} /> Add Server
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {[
          { label: 'Total Servers', value: total, icon: Server, color: 'var(--accent)' },
          { label: 'Online',        value: online,  icon: Wifi,   color: 'var(--success)' },
          { label: 'Offline',       value: offline, icon: AlertTriangle, color: 'var(--danger)' },
          { label: 'Avg CPU',
            value: metrics && Object.values(metrics).length > 0
              ? (Object.values(metrics).reduce((a, m) => a + m.cpu_percent, 0) / Object.values(metrics).length).toFixed(1) + '%'
              : '—',
            icon: Cpu, color: 'var(--warning)' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card stat-card">
            <div className="stat-icon" style={{ background: color + '22', color }}><Icon size={20} /></div>
            <div>
              <div className="stat-value">{loading ? '—' : value}</div>
              <div className="stat-label">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : servers.length === 0 ? (
        <div className="empty-state">
          <Server size={48} />
          <p>No servers connected</p>
          <span>Add your first server to start monitoring</span>
          <button className="btn btn-primary" onClick={() => navigate('/servers?add=1')}>
            <Plus size={14} /> Add Server
          </button>
        </div>
      ) : (
        <div className="grid-auto">
          {servers.map(s => (
            <ServerCard key={s.id} server={s} metric={metrics[s.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
