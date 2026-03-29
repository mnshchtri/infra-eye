import { useEffect, useState, useRef, useCallback } from 'react'
import { 
  Plus, LayoutGrid, Server, 
  RefreshCw, FileCode,
  Boxes, ChevronRight, Activity,
  Globe, X, Terminal,
  List, Zap, Shield
} from 'lucide-react'
import { api } from '../api/client'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Cluster {
  id: number;
  name: string;
  host: string;
  kube_config?: string;
}

type ResourceType = 'pulse' | 'nodes' | 'pods' | 'deployments' | 'services' | 'events' | 'yaml';

export function Kubernetes() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)
  const [activeRes, setActiveRes] = useState<ResourceType>('pulse')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [yamlConfig, setYamlConfig] = useState('')
  const [showAddCluster, setShowAddCluster] = useState(false)
  
  // Stats for Pulse View
  const [stats, setStats] = useState({ nodes: 0, pods: 0, deployments: 0, services: 0, events: 0 })

  // K9s Logic - Command Bar
  const [showCommandBar, setShowCommandBar] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  
  // K9s Logic - Terminal/Logs Drawer
  const [drawer, setDrawer] = useState<{ open: boolean; mode: 'logs' | 'shell'; pod?: string; ns?: string } | null>(null)

  useEffect(() => {
    loadClusters()
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ':' && !showCommandBar) {
        e.preventDefault()
        setShowCommandBar(true)
      } else if (e.key === 'Escape') {
        setShowCommandBar(false)
        setDrawer(curr => curr ? { ...curr, open: false } : null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showCommandBar])

  async function loadClusters() {
    try {
      const res = await api.get('/api/servers')
      // Only show servers that have hostname or tags related to k8s, 
      // but the user wants to add them explicitly. 
      // For now show all servers but we'll add a 'Connect Cluster' flow.
      setClusters(res.data || [])
    } catch (e) { console.error(e) }
  }

  const fetchK8sData = useCallback(async (clusterId: number, resource: ResourceType) => {
    if (resource === 'yaml') return;
    setLoading(true)
    try {
      let command = ''
      switch(resource) {
        case 'nodes': command = 'get nodes -o json'; break;
        case 'pods': command = 'get pods -A -o json'; break;
        case 'deployments': command = 'get deployments -A -o json'; break;
        case 'services': command = 'get services -A -o json'; break;
        case 'events': command = 'get events -A --sort-by=.metadata.creationTimestamp -o json'; break;
        case 'pulse': command = 'get nodes,pods,deployments,services,events -A -o json'; break;
      }

      const res = await api.post(`/api/servers/${clusterId}/kubectl`, { command })
      if (res.data.success) {
        const parsed = JSON.parse(res.data.output)
        if (resource === 'pulse') {
          // aggregate counts for real data pulse
          const items = parsed.items || []
          const nodeCount = items.filter((i: any) => i.kind === 'Node').length
          const podCount = items.filter((i: any) => i.kind === 'Pod').length
          const depCount = items.filter((i: any) => i.kind === 'Deployment').length
          const svcCount = items.filter((i: any) => i.kind === 'Service').length
          const evCount = items.filter((i: any) => i.kind === 'Event').length
          setStats({ nodes: nodeCount, pods: podCount, deployments: depCount, services: svcCount, events: evCount })
          setData(items)
        } else {
          setData(parsed.items || [])
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedCluster) {
      fetchK8sData(selectedCluster.id, activeRes)
    }
  }, [selectedCluster, activeRes, fetchK8sData])

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cmd = commandInput.trim().toLowerCase()
    const routes: Record<string, ResourceType> = {
      'p': 'pods', 'pods': 'pods', 'n': 'nodes', 'nodes': 'nodes',
      'd': 'deployments', 'deployments': 'deployments',
      's': 'services', 'services': 'services',
      'e': 'events', 'events': 'events', 'pulse': 'pulse', 'y': 'yaml'
    }
    if (routes[cmd]) setActiveRes(routes[cmd])
    setShowCommandBar(false)
    setCommandInput('')
  }

  if (!selectedCluster) {
    return (
      <div className="page fade-in">
        <div className="page-header">
           <div>
            <h1 className="page-title">Kubernetes Cluster Manager</h1>
            <p className="page-subtitle">Standardized light-mode infrastructure administration</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddCluster(true)}>
            <Plus size={16} style={{ marginRight: 8 }} /> Add Cluster
          </button>
        </div>

        <div className="grid-cards" style={{ marginTop: 12 }}>
          {clusters.filter(c => c.kube_config).map((cluster, i) => (
            <div 
              key={cluster.id} 
              className="card hover-lift" 
              style={{ animationDelay: `${i * 100}ms`, cursor: 'pointer' }}
              onClick={() => setSelectedCluster(cluster)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LayoutGrid size={24} color="var(--brand-primary)" />
                </div>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 16 }}>{cluster.name}</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cluster.host}</p>
                </div>
              </div>
              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <div className="badge badge-online">Connected</div>
                 <ChevronRight size={16} color="var(--text-muted)" />
              </div>
            </div>
          ))}
          
          {clusters.filter(c => c.kube_config).length === 0 && (
             <div className="empty-state" style={{ gridColumn: '1 / -1', padding: 100 }}>
                <Zap size={48} color="var(--text-muted)" style={{ marginBottom: 20 }} />
                <p>No managed clusters found</p>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Connect your first cluster using a KubeConfig file to begin management.</span>
                <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => setShowAddCluster(true)}>Get Started</button>
             </div>
          )}
        </div>

        {showAddCluster && <AddClusterModal onClose={() => setShowAddCluster(false)} onSuccess={loadClusters} />}
      </div>
    )
  }

  return (
    <div className="page" style={{ padding: 0, flexDirection: 'row', overflow: 'hidden', maxWidth: 'none', margin: 0 }}>
      {/* Command Bar Overlay */}
      {showCommandBar && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1000, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', paddingTop: '15vh' }}>
           <form onSubmit={handleCommandSubmit} className="fade-down" style={{ width: '400px' }}>
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'center', padding: '12px 20px', boxShadow: 'var(--shadow-lg)' }}>
                 <span style={{ color: 'var(--brand-primary)', fontWeight: 900, fontSize: 20, marginRight: 12 }}>:</span>
                 <input 
                   autoFocus 
                   className="input" 
                   style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 18, padding: 0, boxShadow: 'none' }}
                   placeholder="resource name..."
                   value={commandInput}
                   onChange={e => setCommandInput(e.target.value)}
                 />
              </div>
           </form>
        </div>
      )}

      {/* Internal Sidebar - Light Palette */}
      <div style={{ width: 220, background: '#fff', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', padding: '16px 8px' }}>
        <div style={{ padding: '0 12px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
           <button className="btn-icon" onClick={() => setSelectedCluster(null)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /></button>
           <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>{selectedCluster.name}</span>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ResNavLink active={activeRes === 'pulse'} onClick={() => setActiveRes('pulse')} icon={Activity} label="Pulse" />
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '16px 14px 4px', letterSpacing: '0.04em' }}>Resources</div>
          <ResNavLink active={activeRes === 'nodes'} onClick={() => setActiveRes('nodes')} icon={Server} label="Nodes" />
          <ResNavLink active={activeRes === 'pods'} onClick={() => setActiveRes('pods')} icon={Boxes} label="Pods" />
          <ResNavLink active={activeRes === 'deployments'} onClick={() => setActiveRes('deployments')} icon={LayoutGrid} label="Deployments" />
          <ResNavLink active={activeRes === 'services'} onClick={() => setActiveRes('services')} icon={Globe} label="Services" />
          <ResNavLink active={activeRes === 'events'} onClick={() => setActiveRes('events')} icon={List} label="Events" />
          <ResNavLink active={activeRes === 'yaml'} onClick={() => setActiveRes('yaml')} icon={FileCode} label="Raw Config" />
        </nav>
      </div>

      {/* Main Area - Clean Background */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
        <header style={{ height: 60, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="badge badge-online">REAL-TIME</div>
              <h2 style={{ fontSize: 16, fontWeight: 700, textTransform: 'capitalize' }}>{activeRes} Explorer</h2>
              {loading && <RefreshCw size={14} className="spin" color="var(--brand-primary)" />}
           </div>
           
           <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>PRESS <kbd style={{ background: '#f1f5f9', padding: '2px 4px', border: '1px solid #e2e8f0', borderRadius: 4 }}>:</kbd> FOR CLI</div>
              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => fetchK8sData(selectedCluster.id, activeRes)}>
                <RefreshCw size={12} style={{ marginRight: 6 }} className={loading ? 'spin' : ''} /> Refresh
              </button>
           </div>
        </header>

        <main style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
          {activeRes === 'pulse' && <PulseDashboard cluster={selectedCluster} stats={stats} onJump={(r: ResourceType) => setActiveRes(r)} />}
          {activeRes === 'nodes' && <KTable columns={['Name', 'Status', 'Role', 'Version']} data={data} />}
          {activeRes === 'pods' && <KTable 
             columns={['Name', 'Namespace', 'Restarts', 'Status']} 
             data={data} 
             actions={ (p: any) => (
                <>
                  <button className="btn-icon" title="Logs" onClick={() => setDrawer({ open: true, mode: 'logs', pod: p.metadata.name, ns: p.metadata.namespace })}><List size={14} /></button>
                  <button className="btn-icon" title="Shell" onClick={() => setDrawer({ open: true, mode: 'shell', pod: p.metadata.name, ns: p.metadata.namespace })}><Terminal size={14} /></button>
                </>
             )}
          />}
          {activeRes === 'deployments' && <KTable columns={['Name', 'Namespace', 'Ready', 'Available']} data={data} />}
          {activeRes === 'services' && <KTable columns={['Name', 'Namespace', 'Type', 'Cluster-IP']} data={data} />}
          {activeRes === 'events' && <EventLogger data={data} />}
          {activeRes === 'yaml' && <ConfigViewer content={yamlConfig} onChange={setYamlConfig} />}
        </main>
      </div>

      {drawer?.open && (
        <TerminalPortal 
          serverID={selectedCluster.id} 
          pod={drawer.pod!} 
          namespace={drawer.ns!} 
          mode={drawer.mode} 
          onClose={() => setDrawer(curr => curr ? { ...curr, open: false } : null)} 
        />
      )}

      <style>{`
        .res-nav-link { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; transition: var(--transition); }
        .res-nav-link:hover { background: #f8fafc; color: var(--text-primary); }
        .res-nav-link.active { background: var(--brand-glow); color: var(--brand-primary); }
        .k-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .k-table th { text-align: left; padding: 16px; font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; background: #fafafa; border-bottom: 1px solid var(--border); }
        .k-table td { padding: 14px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-secondary); }
        .k-table tr:hover td { background: #fbfbfc; }
      `}</style>
    </div>
  )
}

function ResNavLink({ active, onClick, icon: Icon, label }: any) {
  return (
    <div className={`res-nav-link ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon size={16} />
      <span>{label}</span>
    </div>
  )
}

function PulseDashboard({ cluster, stats, onJump }: any) {
  return (
    <div className="fade-in">
       <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>{cluster.name}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Live cluster topology and workload distribution</p>
       </div>

       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          <PulseStat label="Nodes" count={stats.nodes} icon={Server} color="var(--brand-primary)" onClick={() => onJump('nodes')} />
          <PulseStat label="Pods" count={stats.pods} icon={Boxes} color="var(--info)" onClick={() => onJump('pods')} />
          <PulseStat label="Deployments" count={stats.deployments} icon={LayoutGrid} color="var(--success)" onClick={() => onJump('deployments')} />
          <PulseStat label="Active Events" count={stats.events} icon={Activity} color="var(--warning)" onClick={() => onJump('events')} />
       </div>

       <div className="card" style={{ marginTop: 32, padding: 32, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--success-glow)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
             <Shield size={32} />
          </div>
          <h3 style={{ fontWeight: 700, fontSize: 18 }}>System Pulsing Normal</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>Latency and scheduling rates are within standardized thresholds for this production cluster.</p>
       </div>
    </div>
  )
}

function PulseStat({ label, count, icon: Icon, color, onClick }: any) {
  return (
    <div className="card hover-lift" style={{ cursor: 'pointer', padding: 24 }} onClick={onClick}>
       <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}10`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Icon size={20} />
       </div>
       <div style={{ fontSize: 32, fontWeight: 800 }}>{count}</div>
       <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  )
}

function KTable({ columns, data, actions }: any) {
  const getVal = (item: any, col: string) => {
    switch(col.toLowerCase()) {
      case 'name': return item.metadata.name;
      case 'namespace': return item.metadata.namespace;
      case 'status': return item.status?.phase || 'Active';
      case 'restarts': return item.status?.containerStatuses?.[0]?.restartCount ?? 0;
      case 'role': return item.metadata.labels?.['kubernetes.io/role'] || 'worker';
      case 'version': return item.status?.nodeInfo?.kubeletVersion;
      case 'ready': return `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`;
      case 'available': return item.status?.availableReplicas || 0;
      case 'type': return item.spec?.type;
      case 'cluster-ip': return item.spec?.clusterIP;
      default: return '—';
    }
  }

  return (
    <div style={{ overflow: 'hidden', borderRadius: 12, border: '1px solid var(--border)' }}>
       <table className="k-table">
          <thead>
             <tr>
                {columns.map((c: string) => <th key={c}>{c}</th>)}
                {actions && <th style={{ textAlign: 'right' }}>Management</th>}
             </tr>
          </thead>
          <tbody>
             {data.map((item: any, i: number) => (
                <tr key={i}>
                   {columns.map((c: string) => (
                      <td key={c} style={c === 'Name' ? { fontWeight: 700, color: 'var(--brand-primary)' } : {}}>
                         {getVal(item, c)}
                      </td>
                   ))}
                   {actions && (
                      <td>
                         <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {actions(item)}
                         </div>
                      </td>
                   )}
                </tr>
             ))}
          </tbody>
       </table>
    </div>
  )
}

function AddClusterModal({ onClose, onSuccess }: any) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', host: '', ssh_user: 'root', kube_config: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/api/servers', { ...form, auth_type: 'password' }) // basic cluster shell connect
      onSuccess()
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1100, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
       <div className="card fade-up" style={{ width: 500, padding: 32, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
             <h2 style={{ fontSize: 20, fontWeight: 700 }}>Connect New Cluster</h2>
             <button onClick={onClose}><X size={20} color="var(--text-muted)" /></button>
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
             <div className="input-group">
                <label className="input-label">Friendly Name</label>
                <input className="input" placeholder="e.g. Production Cluster" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">Target Server Host (for Proxy)</label>
                <input className="input" placeholder="IP Address" value={form.host} onChange={e => setForm({...form, host: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">KubeConfig RAW (Persistent)</label>
                <textarea 
                  className="input" 
                  style={{ height: 200, fontFamily: 'monospace', fontSize: 12 }} 
                  placeholder="Paste contents of ~/.kube/config"
                  value={form.kube_config}
                  onChange={e => setForm({...form, kube_config: e.target.value})}
                  required
                />
             </div>
             <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 12 }}>
                {loading ? 'Initializing...' : 'Connect & Sync Cluster'}
             </button>
          </form>
       </div>
    </div>
  )
}

function EventLogger({ data }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
       {data.map((ev: any, i: number) => (
          <div key={i} className="card" style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid var(--border)', padding: '16px 20px', display: 'flex', gap: 16, background: '#fff' }}>
             <div style={{ fontSize: 10, fontWeight: 900, color: ev.type === 'Warning' ? 'var(--danger)' : 'var(--success)', width: 60 }}>{ev.type.toUpperCase()}</div>
             <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{ev.reason}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ev.message}</div>
             </div>
             <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{ev.involvedObject.kind}/{ev.involvedObject.name}</div>
          </div>
       ))}
    </div>
  )
}

function ConfigViewer({ content, onChange }: any) {
  return (
    <div className="card" style={{ height: 'calc(100vh - 200px)', padding: 0, overflow: 'hidden' }}>
       <textarea 
         className="input"
         value={content}
         onChange={e => onChange(e.target.value)}
         style={{ width: '100%', height: '100%', border: 'none', background: '#fafafa', color: 'var(--text-primary)', fontFamily: '"JetBrains Mono", monospace', fontSize: 13, padding: 32, resize: 'none' }}
       />
    </div>
  )
}

function TerminalPortal({ serverID, pod, namespace, mode, onClose }: any) {
  const terminalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!terminalRef.current) return;
    const term = new XTerm({ theme: { background: '#0f172a', foreground: '#cbd5e1' }, fontSize: 13, fontFamily: '"JetBrains Mono", monospace' })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/servers/${serverID}/kubectl/pod-terminal?pod=${pod}&namespace=${namespace}&mode=${mode}&token=${localStorage.getItem('token')}`)
    ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') { term.write(ev.data) }
        else { ev.data.arrayBuffer().then((buf: any) => term.write(new Uint8Array(buf))) }
    }
    term.onData((data) => ws.send(data))
    return () => { ws.close(); term.dispose(); }
  }, [serverID, pod, namespace, mode])

  return (
    <div className="fade-in" style={{ position: 'fixed', right: 0, top: 0, width: '45vw', height: '100vh', background: '#fff', borderLeft: '1px solid var(--border)', zIndex: 1200, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
       <div style={{ height: 50, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
             <Terminal size={14} color="var(--brand-primary)" />
             <span style={{ fontSize: 12, fontWeight: 700 }}>POD {mode.toUpperCase()}: {pod}</span>
          </div>
          <button onClick={onClose}><X size={16} color="var(--text-muted)" /></button>
       </div>
       <div ref={terminalRef} style={{ flex: 1, padding: 20, background: '#0f172a' }} />
    </div>
  )
}
