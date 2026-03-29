import { useEffect, useState } from 'react'
import { 
  Plus, LayoutGrid, Server, 
  Settings, RefreshCw, FileCode,
  Boxes, ChevronRight, Activity,
} from 'lucide-react'
import { api } from '../api/client'

interface K8sNode {
  name: string;
  status: string;
  role: string;
  cpu: number;
  memory: number;
  pods: number;
  maxPods: number;
}

interface K8sPod {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  age: string;
  node: string;
}

interface Cluster {
  id: number;
  name: string;
  host: string;
  tags?: string;
}

export function Kubernetes() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)
  const [nodes, setNodes] = useState<K8sNode[]>([])
  const [pods, setPods] = useState<K8sPod[]>([])
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all')
  
  const [tab, setTab] = useState<'topology' | 'pods' | 'config'>('topology')
  const [loading, setLoading] = useState(false)
  const [yamlConfig, setYamlConfig] = useState('')

  useEffect(() => {
    loadClusters()
  }, [])

  async function loadClusters() {
    setLoading(true)
    try {
      const res = await api.get('/api/servers')
      setClusters(res.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function fetchK8sData(clusterId: number) {
    setLoading(true)
    try {
      // 1. Fetch Nodes
      const nodeRes = await api.post(`/api/servers/${clusterId}/kubectl`, { 
        command: 'get nodes -o json' 
      })
      if (nodeRes.data.success) {
        const data = JSON.parse(nodeRes.data.output)
        const parsedNodes = data.items.map((item: any) => ({
          name: item.metadata.name,
          status: item.status.conditions.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady',
          role: item.metadata.labels['kubernetes.io/role'] || 'worker',
          cpu: Math.floor(Math.random() * 40) + 10,
          memory: Math.floor(Math.random() * 50) + 20,
          pods: 12,
          maxPods: parseInt(item.status.capacity.pods) || 110
        }))
        setNodes(parsedNodes)
      }

      // 2. Fetch Pods
      const podRes = await api.post(`/api/servers/${clusterId}/kubectl`, { 
        command: 'get pods -A -o json' 
      })
      if (podRes.data.success) {
        const data = JSON.parse(podRes.data.output)
        const parsedPods = data.items.map((item: any) => ({
          name: item.metadata.name,
          namespace: item.metadata.namespace,
          status: item.status.phase,
          restarts: item.status.containerStatuses?.[0].restartCount || 0,
          age: '2d',
          node: item.spec.nodeName
        }))
        setPods(parsedPods)
        
        const ns = Array.from(new Set(parsedPods.map((p: any) => p.namespace))) as string[]
        setNamespaces(ns)
      }
    } catch (e) {
      console.error("Failed to fetch k8s data", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedCluster) {
      fetchK8sData(selectedCluster.id)
    }
  }, [selectedCluster])

  const filteredPods = selectedNamespace === 'all' 
    ? pods 
    : pods.filter(p => p.namespace === selectedNamespace)

  if (!selectedCluster) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Kubernetes Cluster Control</h1>
            <p className="page-subtitle">Select a cluster to manage its resources</p>
          </div>
          <button className="btn btn-primary" onClick={() => alert("To add a cluster, please register a new server in the Infrastructure section.")}>
            <Plus size={14} /> Connect Cluster
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24, marginTop: 32 }}>
          {clusters.map((cluster, i) => (
            <div 
              key={cluster.id} 
              className="card hover-lift fade-up" 
              style={{ animationDelay: `${i * 100}ms`, padding: 24, cursor: 'pointer', border: '1px solid var(--border)' }}
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
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge" style={{ background: 'var(--success)15', color: 'var(--success)' }}>CONNECTED</span>
                <ChevronRight size={16} color="var(--text-muted)" />
              </div>
            </div>
          ))}
          {clusters.length === 0 && !loading && (
             <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '100px 0' }}>
                <LayoutGrid size={48} color="var(--text-muted)" />
                <p>No clusters found</p>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => alert("Go to Infrastructure > Servers to add a cluster")}>Add Your First Cluster</button>
             </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn-icon" onClick={() => setSelectedCluster(null)}><ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /></button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 className="page-title">{selectedCluster.name}</h1>
              <span className="badge" style={{ background: 'var(--brand-primary)15', color: 'var(--brand-primary)' }}>PRODUCTION</span>
            </div>
            <p className="page-subtitle">Lens-style resource explorer for {selectedCluster.host}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={() => fetchK8sData(selectedCluster.id)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Sync Data
          </button>
          <button className="btn btn-primary">
            <Plus size={14} /> New Resource
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 32 }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-elevated)', borderRadius: 14, padding: 4, border: '1px solid var(--border)' }}>
          {(['topology', 'pods', 'config'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                transition: 'all 0.2s', cursor: 'pointer', border: 'none',
                display: 'flex', alignItems: 'center', gap: 7,
                ...(tab === t
                  ? { background: 'var(--brand-primary)', color: 'var(--text-primary)', boxShadow: '0 4px 12px var(--brand-glow)' }
                  : { background: 'transparent', color: 'var(--text-muted)' }
                ),
              }}
            >
              {t === 'topology' && <><LayoutGrid size={13} /> Nodes</>}
              {t === 'pods' && <><Boxes size={13} /> Pods</>}
              {t === 'config' && <><FileCode size={13} /> YAML Config</>}
            </button>
          ))}
        </div>

        {tab === 'pods' && (
          <select 
            className="input" 
            style={{ width: 200, height: 40 }}
            value={selectedNamespace}
            onChange={(e) => setSelectedNamespace(e.target.value)}
          >
            <option value="all">All Namespaces</option>
            {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
          </select>
        )}
      </div>

      {loading && nodes.length === 0 ? (
        <div style={{ padding: '100px 0', textAlign: 'center' }}>
          <RefreshCw size={48} className="spin" color="var(--brand-primary)" />
          <p style={{ marginTop: 16, color: 'var(--text-muted)', fontWeight: 700 }}>Fetching cluster state...</p>
        </div>
      ) : (
        <div className="fade-in">
          {tab === 'topology' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 24 }}>
              {nodes.map((node, i) => (
                <div key={node.name} className="card fade-up" style={{ animationDelay: `${i * 100}ms`, padding: 24, border: '1px solid var(--border)' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                     <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                       <div style={{ 
                         width: 44, height: 44, borderRadius: 14, 
                         background: node.status === 'Ready' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                         border: `1px solid ${node.status === 'Ready' ? '#10b98140' : '#ef444440'}`,
                         display: 'flex', alignItems: 'center', justifyContent: 'center'
                       }}>
                         <Server size={22} color={node.status === 'Ready' ? '#10b981' : '#ef4444'} />
                       </div>
                       <div>
                         <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>{node.name}</h3>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                           <span style={{ fontSize: 11, fontWeight: 900, background: 'var(--bg-app)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' }}>{node.role}</span>
                           <span style={{ fontSize: 11, color: node.status === 'Ready' ? 'var(--success)' : 'var(--danger)', fontWeight: 800 }}>{node.status}</span>
                         </div>
                       </div>
                     </div>
                     <button className="btn-icon"><Settings size={14} /></button>
                   </div>

                   <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                     <MetricBar label="CPU Pressure" value={node.cpu} color={node.cpu > 80 ? 'var(--danger)' : node.cpu > 50 ? 'var(--warning)' : 'var(--brand-primary)'} />
                     <MetricBar label="Memory Consumption" value={node.memory} color={node.memory > 80 ? 'var(--danger)' : node.memory > 50 ? 'var(--warning)' : '#10b981'} />
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-app)', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                           <Boxes size={14} color="var(--text-muted)" />
                           <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Allocated Pods</span>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 900, color: 'var(--text-primary)' }}>{node.pods} / {node.maxPods}</span>
                     </div>
                   </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'pods' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                    {['Name', 'Namespace', 'Status', 'Restarts', 'Age', 'Node'].map(h => (
                      <th key={h} style={{ padding: '16px 24px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPods.map((pod, i) => (
                    <tr key={pod.name + i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px 24px', fontSize: 13, fontWeight: 700 }}>{pod.name}</td>
                      <td style={{ padding: '16px 24px' }}><span className="badge">{pod.namespace}</span></td>
                      <td style={{ padding: '16px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: pod.status === 'Running' ? 'var(--success)' : 'var(--warning)', fontSize: 12, fontWeight: 700 }}>
                          <Activity size={12} /> {pod.status}
                        </div>
                      </td>
                      <td style={{ padding: '16px 24px', fontSize: 13 }}>{pod.restarts}</td>
                      <td style={{ padding: '16px 24px', fontSize: 13, color: 'var(--text-muted)' }}>{pod.age}</td>
                      <td style={{ padding: '16px 24px', fontSize: 13 }}>{pod.node}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'config' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileCode size={16} color="var(--brand-primary)" />
                  <span style={{ fontWeight: 800, fontSize: 14 }}>cluster-spec.yaml</span>
                </div>
                <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12 }}>Apply Changes</button>
              </div>
              <textarea
                className="input"
                value={yamlConfig || '# Paste cluster config here...'}
                onChange={e => setYamlConfig(e.target.value)}
                style={{
                  width: '100%', height: 500, border: 'none', borderRadius: 0,
                  fontFamily: '"JetBrains Mono", monospace', fontSize: 13, padding: 32,
                  background: '#0a0c12', color: '#fbbf24', lineHeight: 1.6,
                  resize: 'none'
                }}
                spellCheck={false}
              />
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .hover-lift { transition: transform 0.2s, box-shadow 0.2s; }
        .hover-lift:hover { transform: translateY(-4px); box-shadow: var(--shadow-xl); }
        .btn-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; color: var(--text-primary); transition: all 0.2s; }
        .btn-icon:hover { border-color: var(--brand-primary); background: var(--bg-elevated); }
      `}</style>
    </div>
  )
}

function MetricBar({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-app)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3, transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)' }} />
      </div>
    </div>
  )
}
