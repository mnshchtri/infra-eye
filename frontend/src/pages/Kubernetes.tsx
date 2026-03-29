import { useEffect, useState } from 'react'
import { 
  Plus, LayoutGrid, Server, 
  Settings, RefreshCw, FileCode,
  Boxes, ChevronRight, Activity,
  Globe, X,
  Shield, Info
} from 'lucide-react'
import { api } from '../api/client'

interface Cluster {
  id: number;
  name: string;
  host: string;
}

type ResourceType = 'nodes' | 'pods' | 'deployments' | 'services' | 'events' | 'yaml';

export function Kubernetes() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)
  const [activeRes, setActiveRes] = useState<ResourceType>('nodes')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [yamlConfig, setYamlConfig] = useState('')

  useEffect(() => {
    loadClusters()
  }, [])

  async function loadClusters() {
    try {
      const res = await api.get('/api/servers')
      setClusters(res.data || [])
    } catch (e) {
      console.error('Failed to load clusters', e)
    }
  }

  async function fetchK8sData(clusterId: number, resource: ResourceType) {
    if (resource === 'yaml') return;
    setLoading(true)
    setError(null)
    try {
      let command = ''
      switch(resource) {
        case 'nodes': command = 'get nodes -o json'; break;
        case 'pods': command = 'get pods -A -o json'; break;
        case 'deployments': command = 'get deployments -A -o json'; break;
        case 'services': command = 'get services -A -o json'; break;
        case 'events': command = 'get events -A --sort-by=.metadata.creationTimestamp -o json'; break;
      }

      const res = await api.post(`/api/servers/${clusterId}/kubectl`, { command })
      if (res.data.success) {
        const parsed = JSON.parse(res.data.output)
        setData(parsed.items || [])
      } else {
        throw new Error(res.data.error || 'Command failed')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedCluster) {
      fetchK8sData(selectedCluster.id, activeRes)
    }
  }, [selectedCluster, activeRes])

  if (!selectedCluster) {
    return (
      <div className="page">
        <div className="page-header">
           <div>
            <h1 className="page-title">Kubernetes Dashboard</h1>
            <p className="page-subtitle">Multi-cluster cloud management explorer</p>
          </div>
        </div>

        <div className="grid-cards" style={{ marginTop: 32 }}>
          {clusters.map((cluster, i) => (
            <div 
              key={cluster.id} 
              className="card hover-lift fade-up" 
              style={{ animationDelay: `${i * 100}ms`, padding: 24, cursor: 'pointer' }}
              onClick={() => setSelectedCluster(cluster)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(79, 70, 229, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--brand-glow)' }}>
                  <LayoutGrid size={24} color="var(--brand-primary)" />
                </div>
                <div>
                  <h3 style={{ fontWeight: 800, fontSize: 18 }}>{cluster.name}</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cluster.host}</p>
                </div>
              </div>
              <div style={{ marginTop: 24, padding: '12px 16px', background: 'var(--bg-app)', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge badge-online">Connected</span>
                <ChevronRight size={16} color="var(--text-muted)" />
              </div>
            </div>
          ))}
          {clusters.length === 0 && (
             <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <LayoutGrid size={48} color="var(--text-muted)" />
                <p>No clusters configured</p>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => alert("Add a server with KubeConfig in Infrastructure section")}>Add Your First Cluster</button>
             </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ padding: 0, flexDirection: 'row', overflow: 'hidden' }}>
      {/* Internal Sidebar - Resource Explorer */}
      <div style={{ 
        width: 240, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', 
        display: 'flex', flexDirection: 'column', height: '100%' 
      }}>
        <div style={{ padding: 24, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => setSelectedCluster(null)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /></button>
          <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedCluster.name}</span>
        </div>

        <nav style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '12px 12px 4px', letterSpacing: '0.08em' }}>Resources</div>
          <ResLink active={activeRes === 'nodes'} onClick={() => setActiveRes('nodes')} icon={Server} label="Nodes" />
          <ResLink active={activeRes === 'pods'} onClick={() => setActiveRes('pods')} icon={Boxes} label="Pods" />
          <ResLink active={activeRes === 'deployments'} onClick={() => setActiveRes('deployments')} icon={LayoutGrid} label="Deployments" />
          <ResLink active={activeRes === 'services'} onClick={() => setActiveRes('services')} icon={Globe} label="Services" />
          
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '12px 12px 4px', letterSpacing: '0.08em', marginTop: 16 }}>Diagnostics</div>
          <ResLink active={activeRes === 'events'} onClick={() => setActiveRes('events')} icon={Activity} label="Events" />
          <ResLink active={activeRes === 'yaml'} onClick={() => setActiveRes('yaml')} icon={FileCode} label="Raw Config" />
        </nav>

        <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg-app)' }}>
           <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success-glow)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Live Monitoring</span>
           </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
        <header style={{ padding: '0 32px', height: 64, borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, textTransform: 'capitalize' }}>{activeRes}</h2>
            {loading && <RefreshCw size={14} className="spin" color="var(--brand-primary)" />}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => fetchK8sData(selectedCluster.id, activeRes)} disabled={loading}>
              <RefreshCw size={12} style={{ marginRight: 6 }} className={loading ? 'spin' : ''} /> Sync
            </button>
            <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12 }}>
              <Plus size={12} style={{ marginRight: 6 }} /> Create
            </button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
          {error && (
            <div className="card" style={{ border: '1px solid var(--danger)30', background: 'var(--danger)05', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <Shield size={24} color="var(--danger)" />
              <div>
                <p style={{ fontWeight: 800, color: 'var(--danger)' }}>Cluster Connection Error</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{error}</p>
              </div>
            </div>
          )}

          {activeRes === 'nodes' && <NodeTable data={data} />}
          {activeRes === 'pods' && <ResourceTable columns={['Name', 'Namespace', 'Status', 'Restarts', 'Age']} data={data} />}
          {activeRes === 'deployments' && <ResourceTable columns={['Name', 'Namespace', 'Replicas', 'Available', 'Strategy']} data={data} />}
          {activeRes === 'services' && <ResourceTable columns={['Name', 'Namespace', 'Type', 'Cluster-IP', 'Ports']} data={data} />}
          {activeRes === 'events' && <EventStream data={data} />}
          {activeRes === 'yaml' && (
             <div className="card" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
                <textarea
                  className="input"
                  value={yamlConfig || '# Select a resource or paste YAML spec here...'}
                  onChange={e => setYamlConfig(e.target.value)}
                  style={{
                    width: '100%', height: 'calc(100vh - 200px)', border: 'none', borderRadius: 0,
                    fontFamily: '"JetBrains Mono", monospace', fontSize: 13, padding: 32,
                    background: '#0a0c12', color: '#fbbf24', lineHeight: 1.6, resize: 'none'
                  }}
                />
             </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
        .res-link { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; color: var(--text-secondary); text-decoration: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .res-link:hover { background: #f1f5f9; color: var(--text-primary); }
        .res-link.active { background: #eff6ff; color: var(--brand-primary); }
        .k8s-table { width: 100%; border-collapse: collapse; background: var(--bg-card); border-radius: 14px; overflow: hidden; border: 1px solid var(--border); }
        .k8s-table th { padding: 16px 24px; text-align: left; font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; border-bottom: 1px solid var(--border); }
        .k8s-table td { padding: 16px 24px; font-size: 13px; border-bottom: 1px solid var(--border); }
        .k8s-table tr:last-child td { border-bottom: none; }
      `}</style>
    </div>
  )
}

function ResLink({ active, onClick, icon: Icon, label }: any) {
  return (
    <div className={`res-link ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon size={16} strokeWidth={active ? 2.5 : 2} />
      <span>{label}</span>
    </div>
  )
}

function NodeTable({ data }: { data: any[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 24 }}>
      {data.map((node) => (
        <div key={node.metadata.name} className="card fade-up" style={{ padding: 24 }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
               <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(16, 185, 129, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <Server size={20} color="#10b981" />
               </div>
               <div>
                 <h3 style={{ fontWeight: 800, fontSize: 16 }}>{node.metadata.name}</h3>
                 <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>READY</span>
               </div>
             </div>
             <Settings size={14} color="var(--text-muted)" />
           </div>
           <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800 }}>
                 <span style={{ color: 'var(--text-muted)' }}>OS / ARCH</span>
                 <span>{node.status.nodeInfo.osImage}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800 }}>
                 <span style={{ color: 'var(--text-muted)' }}>VERSION</span>
                 <span>{node.status.nodeInfo.kubeletVersion}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800 }}>
                 <span style={{ color: 'var(--text-muted)' }}>PODS</span>
                 <span>{node.status.capacity.pods} Max</span>
              </div>
           </div>
        </div>
      ))}
    </div>
  )
}

function ResourceTable({ columns, data }: { columns: string[], data: any[] }) {
  const getVal = (item: any, col: string) => {
    switch(col) {
      case 'Name': return item.metadata.name;
      case 'Namespace': return item.metadata.namespace;
      case 'Status': return item.status?.phase || 'Active';
      case 'Restarts': return item.status?.containerStatuses?.[0]?.restartCount ?? 0;
      case 'Age': return '2d';
      case 'Replicas': return `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`;
      case 'Available': return item.status?.availableReplicas || 0;
      case 'Strategy': return item.spec?.strategy?.type || 'RollingUpdate';
      case 'Type': return item.spec?.type || 'ClusterIP';
      case 'Cluster-IP': return item.spec?.clusterIP || 'None';
      case 'Ports': return item.spec?.ports?.map((p: any) => `${p.port}/${p.protocol}`).join(', ');
      default: return '—';
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="k8s-table">
        <thead>
          <tr>
            {columns.map(c => <th key={c}>{c}</th>)}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, i) => (
            <tr key={item.metadata.uid || i}>
              {columns.map(c => (
                <td key={c}>
                  {c === 'Name' ? <span style={{ fontWeight: 800, color: 'var(--brand-primary)' }}>{getVal(item, c)}</span> : getVal(item, c)}
                </td>
              ))}
              <td>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-icon" style={{ width: 28, height: 28 }}><FileCode size={12} /></button>
                  <button className="btn-icon danger" style={{ width: 28, height: 28 }}><X size={12} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EventStream({ data }: { data: any[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map((ev, i) => (
        <div key={ev.metadata.uid || i} className="card fade-up" style={{ padding: '12px 20px', borderLeft: `4px solid ${ev.type === 'Warning' ? 'var(--danger)' : 'var(--success)'}` }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                 <div style={{ width: 32, height: 32, borderRadius: 8, background: ev.type === 'Warning' ? 'var(--danger)10' : 'var(--success)10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Info size={14} color={ev.type === 'Warning' ? 'var(--danger)' : 'var(--success)'} />
                 </div>
                 <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{ev.reason}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ev.involvedObject.kind}/{ev.involvedObject.name}</div>
                 </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{ev.count} times</div>
           </div>
           <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ev.message}</p>
        </div>
      ))}
    </div>
  )
}
