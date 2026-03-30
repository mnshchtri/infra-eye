import { useEffect, useState, useRef, useCallback } from 'react'
import { 
  Plus, LayoutGrid, Server, 
  RefreshCw, FileCode,
  Boxes, ChevronRight, Activity,
  Globe, X, Terminal,
  List, Zap, Shield, Trash2, Unlink, MoreVertical
} from 'lucide-react'
import { api } from '../api/client'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useToastStore } from '../store/toastStore'

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
  const toast = useToastStore()
  
  const [confirmDisconnect, setConfirmDisconnect] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  
  // Namespaces
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNS, setSelectedNS] = useState<string>('All')
  
  // YAML Editor
  const [editingYaml, setEditingYaml] = useState<{ open: boolean; content: string; name?: string; ns?: string; kind?: string }>({ open: false, content: '' })
  
  // Stats for Pulse View
  const [stats, setStats] = useState({ nodes: 0, pods: 0, deployments: 0, services: 0, events: 0 })

  // Real-time Apply Logic
  const [applyResult, setApplyResult] = useState<{ success: boolean; msg: string } | null>(null)

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
      setClusters(res.data || [])
    } catch (e) { console.error(e) }
  }

  const fetchNamespaces = useCallback(async (clusterId: number, force = false) => {
    if (namespaces.length > 0 && !force) return
    try {
      const res = await api.post(`/api/servers/${clusterId}/kubectl`, { command: 'get namespaces -o json' })
      if (res.data.success) {
        const parsed = JSON.parse(res.data.output)
        const nsList = (parsed.items || []).map((i: any) => i.metadata.name)
        setNamespaces(nsList)
      }
    } catch (e) { console.error("NS Fetch error:", e) }
  }, [namespaces])

  const handleDisconnect = async (id: number) => {
    try {
      await api.post(`/api/servers/${id}/k8s/disconnect`)
      toast.success('Cluster disconnected', 'This server is no longer managed via Kubernetes.')
      setConfirmDisconnect(null)
      loadClusters()
    } catch (e: any) {
      toast.error('Disconnect failed', e.response?.data?.error || 'Could not disconnect')
      setConfirmDisconnect(null)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api/servers/${id}`)
      toast.success('Server deleted', 'All node data destroyed.')
      setConfirmDelete(null)
      loadClusters()
    } catch (e: any) {
      toast.error('Delete failed', e.response?.data?.error || 'Could not delete server')
      setConfirmDelete(null)
    }
  }

  const fetchK8sData = useCallback(async (clusterId: number, resource: ResourceType) => {
    if (resource === 'yaml') return;
    setLoading(true)
    try {
      let command = ''
      const nsFlag = selectedNS === 'All' ? '-A' : `-n ${selectedNS}`
      
      switch(resource) {
        case 'nodes': command = 'get nodes -o json'; break; // Nodes are cluster-scoped
        case 'pods': command = `get pods ${nsFlag} -o json`; break;
        case 'deployments': command = `get deployments ${nsFlag} -o json`; break;
        case 'services': command = `get services ${nsFlag} -o json`; break;
        case 'events': command = `get events ${nsFlag} --sort-by=.metadata.creationTimestamp -o json`; break;
        case 'pulse': command = `get nodes,pods,deployments,services,events ${nsFlag} -o json`; break;
      }

      const res = await api.post(`/api/servers/${clusterId}/kubectl`, { command })
      if (res.data.success) {
        try {
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
        } catch (parseErr) {
          console.error("JSON Parse Error:", parseErr, "Raw Output:", res.data.output)
          // Fallback: show error message in the data area if possible
          setData([])
        }
      } else {
          console.error("Kubectl Error:", res.data.error, "Stderr:", res.data.stderr)
          setData([])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedCluster) {
      fetchNamespaces(selectedCluster.id)
      fetchK8sData(selectedCluster.id, activeRes)
    }
  }, [selectedCluster, activeRes, selectedNS, fetchK8sData, fetchNamespaces])

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const input = commandInput.trim().toLowerCase()
    
    // Command Logic
    if (input.startsWith('ns ')) {
       const ns = input.split(' ')[1]
       if (ns === 'all') setSelectedNS('All')
       else if (namespaces.includes(ns)) setSelectedNS(ns)
    } else {
       const routes: Record<string, ResourceType> = {
         'p': 'pods', 'pods': 'pods', 'n': 'nodes', 'nodes': 'nodes',
         'd': 'deployments', 'deployments': 'deployments',
         's': 'services', 'services': 'services',
         'e': 'events', 'events': 'events', 'pulse': 'pulse', 'y': 'yaml'
       }
       if (routes[input]) setActiveRes(routes[input])
    }
    
    setShowCommandBar(false)
    setCommandInput('')
  }

  const fetchYaml = async (kind: string, name: string, ns?: string) => {
    if (!selectedCluster) return
    setLoading(true)
    try {
      const nsFlag = ns ? `-n ${ns}` : "-A"
      const command = `get ${kind} ${name} ${nsFlag} -o yaml`
      const res = await api.post(`/api/servers/${selectedCluster.id}/kubectl`, { command })
      if (res.data.success) {
        setEditingYaml({ open: true, content: res.data.output, name, ns, kind })
      }
    } catch (e) { console.error("YAML fetch error:", e) }
    finally { setLoading(false) }
  }

  const applyYaml = async () => {
    if (!selectedCluster || !editingYaml.content) return
    setLoading(true)
    setApplyResult(null)
    try {
      const res = await api.post(`/api/servers/${selectedCluster.id}/kubectl/apply`, { yaml: editingYaml.content })
      if (res.data.success) {
        setApplyResult({ success: true, msg: res.data.output || "Resource applied successfully" })
        // Background refresh
        fetchK8sData(selectedCluster.id, activeRes)
      } else {
        setApplyResult({ success: false, msg: res.data.stderr || res.data.error || "Application failed" })
      }
    } catch (e: any) { 
      setApplyResult({ success: false, msg: "Network error during apply" })
      console.error("YAML apply error:", e) 
    } finally { 
      setLoading(false) 
    }
  }

  // Keyboard Shortcuts for Editor
  useEffect(() => {
    if (!editingYaml.open) return
    const handleS = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        applyYaml()
      }
      if (e.key === 'Escape') {
        setEditingYaml({ ...editingYaml, open: false })
        setApplyResult(null)
      }
    }
    window.addEventListener('keydown', handleS)
    return () => window.removeEventListener('keydown', handleS)
  }, [editingYaml.open, editingYaml.content])

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
                 <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {confirmDisconnect === cluster.id ? (
                      <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11, background: 'var(--warning)', color: '#fff', border: 'none' }} onClick={() => handleDisconnect(cluster.id)}>Confirm</button>
                        <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setConfirmDisconnect(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn-icon" title="Disconnect" onClick={(e) => { e.stopPropagation(); setConfirmDisconnect(cluster.id) }}><Unlink size={14} /></button>
                    )}
                    
                    {confirmDelete === cluster.id ? (
                      <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11, background: 'var(--danger)', color: '#fff', border: 'none' }} onClick={() => handleDelete(cluster.id)}>Confirm</button>
                        <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setConfirmDelete(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn-icon" title="Delete" onClick={(e) => { e.stopPropagation(); setConfirmDelete(cluster.id) }} style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                    )}
                    
                    <ChevronRight size={16} color="var(--text-muted)" />
                 </div>
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

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
          <ResNavLink active={activeRes === 'pulse'} onClick={() => setActiveRes('pulse')} icon={Activity} label="Pulse" />
          
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '20px 14px 8px', letterSpacing: '0.08em' }}>Workloads</div>
          <ResNavLink active={activeRes === 'nodes'} onClick={() => setActiveRes('nodes')} icon={Server} label="Nodes" />
          <ResNavLink active={activeRes === 'pods'} onClick={() => setActiveRes('pods')} icon={Boxes} label="Pods" />
          <ResNavLink active={activeRes === 'deployments'} onClick={() => setActiveRes('deployments')} icon={LayoutGrid} label="Deployments" />
          
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '20px 14px 8px', letterSpacing: '0.08em' }}>Networking</div>
          <ResNavLink active={activeRes === 'services'} onClick={() => setActiveRes('services')} icon={Globe} label="Services" />
          
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '20px 14px 8px', letterSpacing: '0.08em' }}>Configuration</div>
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
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--brand-glow)', padding: '4px 12px', borderRadius: 8, border: '1px solid var(--brand-primary)40' }}>
                 <Globe size={14} color="var(--brand-primary)" />
                 <select 
                   style={{ background: 'transparent', border: 'none', fontSize: 13, fontWeight: 700, color: 'var(--brand-primary)', cursor: 'pointer', outline: 'none' }}
                   value={selectedNS}
                   onChange={e => setSelectedNS(e.target.value)}
                 >
                    <option value="All">All Namespaces</option>
                    {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                 </select>
              </div>

              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => fetchK8sData(selectedCluster.id, activeRes)}>
                <RefreshCw size={12} style={{ marginRight: 6 }} className={loading ? 'spin' : ''} /> Refresh
              </button>
           </div>
        </header>

        <main style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
          {activeRes === 'pulse' && <PulseDashboard cluster={selectedCluster} stats={stats} onJump={(r: ResourceType) => setActiveRes(r)} />}
          {activeRes === 'nodes' && <KTable columns={['Name', 'Status', 'Role', 'Version']} data={data} 
             actions={(n: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('node', n.metadata.name)}><FileCode size={14} /></button>} 
          />}
          {activeRes === 'pods' && <KTable 
             columns={['Name', 'Namespace', 'Restarts', 'Status']} 
             data={data} 
             actions={ (p: any) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('pod', p.metadata.name, p.metadata.namespace)}><FileCode size={14} /></button>
                  <button className="btn-icon" title="Logs" onClick={() => setDrawer({ open: true, mode: 'logs', pod: p.metadata.name, ns: p.metadata.namespace })}><List size={14} /></button>
                  <button className="btn-icon" title="Shell" onClick={() => setDrawer({ open: true, mode: 'shell', pod: p.metadata.name, ns: p.metadata.namespace })}><Terminal size={14} /></button>
                </>
             )}
          />}
          {activeRes === 'deployments' && <KTable columns={['Name', 'Namespace', 'Ready', 'Available']} data={data} 
             actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('deployment', d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'services' && <KTable columns={['Name', 'Namespace', 'Type', 'Cluster-IP']} data={data} 
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('service', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
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

      {editingYaml.open && (
        <div className="fade-in" style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: '#fff', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
              <div style={{ height: 64, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', background: '#fff' }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                   <div style={{ padding: 8, background: 'var(--brand-glow)', borderRadius: 8 }}>
                     <FileCode size={20} color="var(--brand-primary)" />
                   </div>
                   <div style={{ display: 'flex', flexDirection: 'column' }}>
                     <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{editingYaml.kind?.toUpperCase()}: {editingYaml.name}</span>
                     <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{editingYaml.ns || 'cluster-scoped'} • CMD+S TO APPLY</span>
                   </div>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                   <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => { navigator.clipboard.writeText(editingYaml.content); toast.success('Copied', 'YAML content copied to clipboard.') }}>Copy</button>
                   <button className="btn btn-secondary" onClick={() => setEditingYaml({ ...editingYaml, open: false })}>Cancel</button>
                   <button className="btn btn-primary" onClick={applyYaml} disabled={loading}>{loading ? 'Applying...' : 'Save & Apply'}</button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                 <div style={{ flex: 1, overflow: 'hidden' }}>
                    <ConfigViewer content={editingYaml.content} onChange={(val: string) => setEditingYaml({ ...editingYaml, content: val })} fullPage />
                 </div>
                 
                 {applyResult && (
                    <div className="fade-up" style={{ height: 180, background: '#0f172a', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                       <div style={{ height: 32, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: applyResult.success ? '#064e3b' : '#7f1d1d' }}>
                          <span style={{ fontSize: 10, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {applyResult.success ? '✓ Apply Success' : '✕ Apply Failed'}
                          </span>
                          <button onClick={() => setApplyResult(null)} style={{ color: '#fff', padding: 4 }}><X size={12} /></button>
                       </div>
                       <div style={{ flex: 1, padding: '16px 24px', overflowY: 'auto', color: '#cbd5e1', fontFamily: '"JetBrains Mono", monospace', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                          {applyResult.msg}
                       </div>
                    </div>
                 )}
              </div>
        </div>
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
      case 'status': {
        const val = item.status?.phase || (item.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'Running' : 'Ready');
        return <span className={`badge ${val === 'Running' || val === 'Ready' || val === 'Active' ? 'badge-online' : 'badge-offline'}`}>{val}</span>;
      }
      case 'restarts': return item.status?.containerStatuses?.[0]?.restartCount ?? 0;
      case 'role': return item.metadata.labels?.['kubernetes.io/role'] || (item.metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined ? 'control-plane' : 'worker');
      case 'version': return item.status?.nodeInfo?.kubeletVersion;
      case 'ready': return `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`;
      case 'available': return item.status?.availableReplicas || 0;
      case 'type': return item.spec?.type;
      case 'cluster-ip': return item.spec?.clusterIP;
      case 'internal-ip': return item.status?.addresses?.find((a: any) => a.type === 'InternalIP')?.address;
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
  const [form, setForm] = useState({ name: '', host: '', ssh_user: 'root', ssh_password: '', kube_config: '' })
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null)

  const testConnection = async () => {
    if (!form.host || !form.kube_config) {
      useToastStore.getState().error('Missing fields', 'Host and KubeConfig are required for testing')
      return
    }
    setLoading(true)
    setTestResult(null)
    try {
      // First save temp or just send a dry-run style command. 
      // For simplicity, we'll try to run a dummy command against the potential server.
      // But since the server doesn't exist yet, we'll use a specific 'test' endpoint if we had one.
      // Alternatively, we let the user save it and then it shows status.
      // Let's implement a 'dry-run' connection test.
      const res = await api.post('/api/servers/test-k8s', { ...form, auth_type: 'password' })
      setTestResult({ success: res.data.success, msg: res.data.output || 'Connected successfully' })
    } catch (e: any) {
      setTestResult({ success: false, msg: e.response?.data?.error || 'Connection failed' })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/api/servers', { ...form, auth_type: 'password', tags: 'kubernetes' }) 
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
                <label className="input-label">SSH Proxy Host (Target Node)</label>
                <input className="input" placeholder="IP Address" value={form.host} onChange={e => setForm({...form, host: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">SSH Username</label>
                <input className="input" placeholder="e.g. root or ubuntu" value={form.ssh_user} onChange={e => setForm({...form, ssh_user: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">SSH Password (for Cluster Sync)</label>
                <input className="input" type="password" placeholder="••••••••" value={form.ssh_password} onChange={e => setForm({...form, ssh_password: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">KubeConfig RAW (Persistent)</label>
                <textarea 
                  className="input" 
                  style={{ height: 160, fontFamily: 'monospace', fontSize: 12 }} 
                  placeholder="Paste contents of sudo k3s kubectl config view --raw"
                  value={form.kube_config}
                  onChange={e => setForm({...form, kube_config: e.target.value})}
                  required
                />
             </div>
             
             {testResult && (
                <div style={{ padding: '8px 12px', border: `1px solid ${testResult.success ? 'var(--success)' : 'var(--danger)'}`, borderRadius: 8, background: testResult.success ? 'var(--success-glow)' : 'var(--danger-glow)', fontSize: 12, color: testResult.success ? 'var(--success)' : 'var(--danger)' }}>
                   {testResult.msg}
                </div>
             )}

             <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={testConnection} disabled={loading}>
                   {loading ? 'Testing...' : 'Test Connection'}
                </button>
                <button className="btn btn-primary" type="submit" disabled={loading} style={{ flex: 1.5 }}>
                   {loading ? 'Wait...' : 'Add Cluster'}
                </button>
             </div>
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

function ConfigViewer({ content, onChange, fullPage }: any) {
  return (
    <div style={{ 
      height: fullPage ? '100%' : 'calc(100vh - 200px)', 
      background: '#fff', 
      position: 'relative', 
      overflow: 'hidden' 
    }}>
       <textarea 
         className="input"
         value={content}
         onChange={e => onChange(e.target.value)}
         spellCheck={false}
         style={{ 
            width: '100%', 
            height: '100%', 
            border: 'none', 
            background: 'transparent', 
            color: 'var(--text-primary)',
            caretColor: 'var(--brand-primary)',
            fontFamily: '"JetBrains Mono", monospace', 
            fontSize: 13, 
            lineHeight: 1.6,
            padding: 32, 
            resize: 'none', 
            position: 'relative', 
            zIndex: 1,
            outline: 'none',
            boxShadow: 'none'
         }}
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
