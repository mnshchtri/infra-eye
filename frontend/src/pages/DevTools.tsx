import { useState, useEffect } from 'react'
import { 
  Zap, Activity, 
  Trash2, LayoutGrid,
  AlertCircle, CheckCircle
} from 'lucide-react'

interface DevLog {
  id: number; msg: string; time: string; type: string;
}

export function DevTools() {
  const [logs, setLogs] = useState<DevLog[]>([])

  // Simulation of live event stream
  useEffect(() => {
    const events = [
      'Auth token refreshed: mnsh-infra-9281',
      'WebSocket connection established on fd-7',
      'Database query: select * from servers limit 100 [2ms]',
      'SSH Tunnel heartbeat acknowledged: cluster-01',
      'Metric aggregation completed: 4.2MB processed',
      'Alert rule evaluation: Critical CPU > 90% [False]',
      'Permission check: manage-alerts -> Success',
      'API Request: GET /api/servers/4/metrics [200 OK]'
    ]
    
    const interval = setInterval(() => {
      const msg = events[Math.floor(Math.random() * events.length)]
      setLogs(prev => [
        { id: Date.now(), msg, time: new Date().toLocaleTimeString(), type: Math.random() > 0.8 ? 'warning' : 'debug' },
        ...prev.slice(0, 19)
      ])
    }, 2000)
    
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Developer Hub</h1>
          <p className="page-subtitle">Platform introspection, system health, and introspection tools</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={() => setLogs([])}>
            <Trash2 size={14} /> Clear Stream
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* ── System Status ── */}
          <div className="card">
             <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(79, 70, 229, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' }}>
                  <Zap size={20} color="var(--brand-primary)" />
                </div>
                <h3 style={{ fontWeight: 800, fontSize: 16 }}>Backend Services</h3>
             </div>
             
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
               <StatusCard label="Core API Gateway" status="Healthy" latency="12ms" />
               <StatusCard label="SSH Proxy Service" status="Degraded" latency="440ms" />
               <StatusCard label="TimescaleDB" status="Healthy" latency="2ms" />
               <StatusCard label="Redis Cache" status="Healthy" latency="0.8ms" />
             </div>
          </div>

          {/* ── Design Tokens ── */}
          <div className="card">
             <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(79, 70, 229, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' }}>
                  <LayoutGrid size={20} color="var(--brand-primary)" />
                </div>
                <h3 style={{ fontWeight: 800, fontSize: 16 }}>UI Foundation</h3>
             </div>
             
             <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <ColorBox color="var(--brand-primary)" label="Primary" />
                <ColorBox color="var(--brand-primary-light)" label="Primary Soft" />
                <ColorBox color="var(--bg-app)" label="App BG" />
                <ColorBox color="var(--bg-card)" label="Card BG" />
                <ColorBox color="var(--border)" label="Border" />
                <ColorBox color="var(--success)" label="Success" />
                <ColorBox color="var(--warning)" label="Warning" />
                <ColorBox color="var(--danger)" label="Danger" />
             </div>
          </div>
        </div>

        {/* ── WebSocket Feed ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
           <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
               <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: '0.02em' }}>LIVE EVENT STREAM</span>
             </div>
             <Activity size={12} color="var(--text-muted)" />
           </div>
           
           <div style={{ flex: 1, minHeight: 400, background: '#0a0c12', padding: '16px 20px', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
             {logs.length === 0 ? (
               <div style={{ color: 'var(--text-muted)', paddingTop: 20 }}>Waiting for events...</div>
             ) : (
               logs.map(log => (
                 <div key={log.id} style={{ marginBottom: 8, display: 'flex', gap: 12 }}>
                   <span style={{ color: 'rgba(255,255,255,0.2)' }}>[{log.time}]</span>
                   <span style={{ color: log.type === 'warning' ? '#f59e0b' : '#38bdf8' }}>{log.msg}</span>
                 </div>
               ))
             )}
           </div>
           
           <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              <input className="input" placeholder="Inject local event..." style={{ height: 32, fontSize: 11, background: 'var(--bg-card)' }} />
           </div>
        </div>
      </div>
    </div>
  )
}

function StatusCard({ label, status, latency }: { label: string, status: string, latency: string }) {
  const isHealthy = status === 'Healthy'
  return (
    <div style={{ padding: '16px 20px', borderRadius: 16, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 4 }}>{label.toUpperCase()}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isHealthy ? <CheckCircle size={14} color="var(--success)" /> : <AlertCircle size={14} color="var(--danger)" />}
          <span style={{ fontWeight: 800, fontSize: 14 }}>{status}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{latency}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>LATENCY</div>
      </div>
    </div>
  )
}

function ColorBox({ color, label }: { color: string, label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: 12, background: color, border: '1px solid var(--border)', marginBottom: 8, boxShadow: 'var(--shadow-sm)' }} />
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}
