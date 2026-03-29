import { useState, useEffect } from 'react'
import { 
  Zap, Activity, 
  Trash2, Database, Globe, 
  ShieldCheck, Play, RefreshCw, BarChart3,
  TrendingUp, Settings, Cpu, Server, Lock
} from 'lucide-react'

interface DevLog {
  id: number; msg: string; time: string; type: 'debug' | 'warning' | 'error' | 'success';
}

export function DevTools() {
  const [logs, setLogs] = useState<DevLog[]>([])
  const [activeTab, setActiveTab] = useState<'all' | 'api' | 'db' | 'system'>('all')

  // Simulation of live event stream
  useEffect(() => {
    const events: {msg: string, type: DevLog['type']}[] = [
      { msg: 'Auth token refreshed: mnsh-infra-9281', type: 'success' },
      { msg: 'WebSocket connection established on fd-7', type: 'debug' },
      { msg: 'Database query: select * from servers limit 100 [2ms]', type: 'debug' },
      { msg: 'SSH Tunnel heartbeat acknowledged: cluster-01', type: 'debug' },
      { msg: 'Metric aggregation completed: 4.2MB processed', type: 'debug' },
      { msg: 'Alert rule evaluation: Critical CPU > 90% [False]', type: 'warning' },
      { msg: 'Permission check: manage-alerts -> Success', type: 'success' },
      { msg: 'API Request: GET /api/servers/4/metrics [200 OK]', type: 'debug' },
      { msg: 'Deployment sync detected in region us-east-1', type: 'warning' },
      { msg: 'Log rotation initiated for system.log', type: 'debug' }
    ]
    
    const interval = setInterval(() => {
      const event = events[Math.floor(Math.random() * events.length)]
      setLogs((prev: DevLog[]) => [
        { id: Date.now(), msg: event.msg, time: new Date().toLocaleTimeString(), type: event.type },
        ...prev.slice(0, 24)
      ])
    }, 2000)
    
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Developer Hub</h1>
          <p className="page-subtitle">Technical overview, system configuration, and live introspection.</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" style={{ height: 42, padding: '0 20px' }}>
            <Activity size={14} style={{ marginRight: 8 }} /> Debug Mode
          </button>
          <button className="btn btn-primary" style={{ height: 42, padding: '0 20px' }}>
            <Zap size={14} style={{ marginRight: 8 }} /> System Audit
          </button>
        </div>
      </div>

      {/* ── Dashboard Aligned Stats ── */}
      <div className="grid-stats" style={{ marginBottom: 40 }}>
          <StatCard label="API Requests (24h)" value="14.2k" icon={Globe} color="var(--brand-primary)" delta="+12% growth" />
          <StatCard label="Active Streams" value="52" icon={Activity} color="var(--info)" delta="Stable" />
          <StatCard label="DB Latency" value="1.8ms" icon={Database} color="var(--success)" delta="Optimal" />
          <StatCard label="System Load" value="12%" icon={Cpu} color="var(--warning)" delta="Low" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 480px', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* ── Service Monitors (Server Card Style) ── */}
          <div className="card" style={{ padding: 24 }}>
             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ 
                    width: 40, height: 40, borderRadius: 10, background: 'rgba(79, 70, 229, 0.08)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' 
                  }}>
                    <BarChart3 size={20} color="var(--brand-primary)" />
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>Internal Service Hub</h3>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Backend engine health and resource distribution</p>
                  </div>
                </div>
                <div className="badge badge-online">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)', marginRight: 6 }} />
                  Healthy
                </div>
             </div>
             
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
               <ServiceModule name="Core API Gateway" load={12} uptime="99.9%" icon={Globe} />
               <ServiceModule name="SSH Proxy Engine" load={44} uptime="98.2%" icon={ShieldCheck} />
               <ServiceModule name="PostgreSQL Cluster" load={8} uptime="100%" icon={Database} />
               <ServiceModule name="WebSocket Server" load={22} uptime="99.7%" icon={Zap} />
             </div>
          </div>

          {/* ── System Configuration (New technical module) ── */}
          <div className="card" style={{ padding: 24 }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ 
                  width: 40, height: 40, borderRadius: 10, background: 'rgba(245, 158, 11, 0.08)', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--warning-glow)' 
                }}>
                  <Settings size={20} color="var(--warning)" />
                </div>
                <div>
                  <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>Platform Configuration</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Environment variables and technical metadata</p>
                </div>
             </div>
             
             <div className="glass-panel" style={{ overflow: 'hidden', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                   <thead style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border)' }}>
                      <tr>
                         <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>PARAMETER</th>
                         <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>CURRENT VALUE</th>
                         <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: 'var(--text-secondary)' }}>STATUS</th>
                      </tr>
                   </thead>
                   <tbody>
                      <ConfigRow label="Environment" value="Development" status="Active" icon={Server} />
                      <ConfigRow label="API Base URL" value="http://localhost:8080" status="Reachable" icon={Globe} />
                      <ConfigRow label="Metrics Interval" value="10s" status="Optimal" icon={Activity} />
                      <ConfigRow label="Auth Method" value="JWT + HS256" status="Encrypted" icon={Lock} />
                      <ConfigRow label="Build Version" value="1.2.4-stable" status="Latest" icon={Settings} />
                   </tbody>
                </table>
             </div>
          </div>
        </div>

        {/* ── Terminal (Card Wrapped) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 700 }}>
            {/* Terminal Header */}
            <div style={{ padding: '0 20px', borderBottom: '1px solid #30363d', background: '#161b22', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 52 }}>
              <div style={{ display: 'flex', gap: 20, height: '100%', alignItems: 'center' }}>
                <TerminalTab active={activeTab === 'all'} label="ALL" onClick={() => setActiveTab('all')} />
                <TerminalTab active={activeTab === 'api'} label="API" onClick={() => setActiveTab('api')} />
                <TerminalTab active={activeTab === 'db'} label="DB" onClick={() => setActiveTab('db')} />
                <TerminalTab active={activeTab === 'system'} label="SYSTEM" onClick={() => setActiveTab('system')} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ color: '#8b949e', cursor: 'pointer', padding: 4 }} onClick={() => setLogs([])}>
                    <Trash2 size={14} />
                </button>
              </div>
            </div>
            
            {/* Terminal Body */}
            <div style={{ flex: 1, background: '#0d1117', padding: '24px', overflowY: 'auto' }}>
              {logs.length === 0 ? (
                <div style={{ color: '#484f58', fontStyle: 'italic', fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
                    waiting for logs...
                </div>
              ) : (
                logs.map((log: DevLog) => (
                  <div key={log.id} style={{ marginBottom: 6, display: 'flex', gap: 14, fontFamily: '"JetBrains Mono", monospace', fontSize: 12, lineHeight: '1.6' }}>
                    <span style={{ color: '#484f58' }}>{log.time}</span>
                    <span style={{ 
                      color: log.type === 'error' ? '#f85149' : 
                             log.type === 'warning' ? '#d29922' : 
                             log.type === 'success' ? '#3fb950' : '#58a6ff' 
                    }}>
                      {log.msg}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Terminal Input */}
            <div style={{ padding: '0 20px', background: '#161b22', borderTop: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: 12, height: 44 }}>
               <span style={{ color: 'var(--brand-primary)', fontWeight: 800, fontSize: 12 }}>➜</span>
               <input 
                  style={{ background: 'transparent', border: 'none', color: '#c9d1d9', fontSize: 12, fontFamily: '"JetBrains Mono", monospace', width: '100%', outline: 'none' }} 
                  placeholder="infra-devtools login as admin..."
                />
            </div>
          </div>

          {/* Utility Card */}
          <div className="card glass-panel-glow" style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                 <Play size={16} color="var(--brand-primary)" />
                 <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>SIMULATION TOOLS</h4>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <UtilBtn label="Purge Cache" icon={RefreshCw} />
                <UtilBtn label="Rotate Logs" icon={Activity} />
                <UtilBtn label="Audit RBAC" icon={Lock} />
                <UtilBtn label="Flush DB" icon={Trash2} color="var(--danger)" />
              </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color, delta }: any) {
    return (
      <div className="card stat-card" style={{ padding: 24 }}>
        <div className="stat-icon-wrapper" style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
          <Icon size={20} color={color} />
        </div>
        <div className="stat-val-group">
          <div className="stat-value" style={{ fontSize: 24 }}>{value}</div>
          <div className="stat-label">{label}</div>
          {delta && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <TrendingUp size={10} color={color} />
              <span style={{ fontSize: 10, color, fontWeight: 700 }}>{delta}</span>
            </div>
          )}
        </div>
      </div>
    )
}

function ServiceModule({ name, load, uptime, icon: Icon }: any) {
  return (
    <div style={{ padding: '16px 20px', borderRadius: 12, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-primary)' }}>
            <Icon size={16} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{name}</span>
        </div>
        <div className="status-dot status-dot-pulse" style={{ background: 'var(--success)' }} />
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
           <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 4 }}>UPTIME</div>
           <div style={{ fontSize: 13, fontWeight: 800 }}>{uptime}</div>
        </div>
        <div>
           <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 4 }}>LOAD</div>
           <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, height: 4, background: '#e2e8f0', borderRadius: 2 }}>
                <div style={{ width: `${load}%`, height: '100%', background: 'var(--brand-primary)', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{load}%</span>
           </div>
        </div>
      </div>
    </div>
  )
}

function ConfigRow({ label, value, status, icon: Icon }: any) {
    return (
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ color: 'var(--text-muted)' }}><Icon size={14} /></div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                </div>
            </td>
            <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>{value}</td>
            <td style={{ padding: '12px 16px' }}>
                <span style={{ fontSize: 10, fontWeight: 800, background: 'rgba(16, 185, 129, 0.08)', color: 'var(--success)', padding: '4px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {status}
                </span>
            </td>
        </tr>
    )
}

function TerminalTab({ active, label, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      style={{ 
        height: '100%', padding: '0 8px', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
        color: active ? '#fff' : '#8b949e', borderBottom: active ? '2px solid var(--brand-primary)' : '2px solid transparent',
        transition: 'all 0.2s ease'
      }}
    >
      {label}
    </button>
  )
}

function UtilBtn({ label, icon: Icon, color = 'var(--text-primary)' }: any) {
  return (
    <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start', fontSize: 11, padding: '10px 12px', color }}>
      <Icon size={14} style={{ marginRight: 8 }} />
      {label}
    </button>
  )
}
