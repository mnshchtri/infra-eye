import { useEffect, useState, useRef, useCallback } from 'react'
import { 
  Plus, LayoutGrid, Server, 
  RefreshCw, FileCode,
  Boxes, ChevronRight, Activity,
  Globe, X, Terminal,
  List, Zap, Trash2, Unlink
} from 'lucide-react'
import { api, buildWsUrl } from '../api/client'
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
  const [connecting, setConnecting] = useState(false) // true while waiting for first WS frame
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
  const [pulseError, setPulseError] = useState<string | null>(null)

  // Real-time Apply Logic
  const [applyResult, setApplyResult] = useState<{ success: boolean; msg: string } | null>(null)

  // K9s Logic - Command Bar
  const [showCommandBar, setShowCommandBar] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  
  // K9s Logic - Filter & Select
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const cmdInputRef = useRef<HTMLInputElement>(null)
  const [cmdError, setCmdError] = useState(false)
  
  const filteredData = data.filter((item: any) => {
    if (!filterQuery) return true;
    const name = item.metadata?.name?.toLowerCase() || '';
    return name.includes(filterQuery.toLowerCase());
  })

  // Reset selection when data changes
  useEffect(() => {
     setSelectedIndex(0)
  }, [activeRes, selectedNS, filterQuery])

  // K9s Logic - Terminal/Logs Drawer
  const [drawer, setDrawer] = useState<{ open: boolean; mode: 'logs' | 'shell'; pod?: string; ns?: string } | null>(null)

  const handleDeleteResource = async (item: any) => {
    if (!selectedCluster) return;
    const kind = item.kind || activeRes.slice(0, -1);
    if (!window.confirm(`Delete ${kind} ${item.metadata.name}?`)) return;
    try {
      await api.delete(`/api/servers/${selectedCluster.id}/kubectl`, {
        data: { kind, name: item.metadata.name, namespace: item.metadata.namespace }
      })
      toast.success('Resource deleted', `Deleted ${item.metadata.name}`)
      // The websocket streams the updated state automatically.
    } catch (e: any) {
      toast.error('Delete failed', e.response?.data?.error || 'Failed to delete resource')
    }
  }

  useEffect(() => {
    loadClusters()
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in generic inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
         if (e.key === 'Escape') {
             setShowSearch(false)
             setFilterQuery('')
             target.blur()
         }
         return;
      }

      if (e.key === ':' && !showCommandBar && !showSearch) {
        e.preventDefault()
        setShowCommandBar(true)
        setCmdError(false)
        setTimeout(() => cmdInputRef.current?.focus(), 50)
        return
      }
      
      if (e.key === 'Escape') {
        setShowCommandBar(false)
        setShowSearch(false)
        setFilterQuery('')
        setDrawer(curr => curr ? { ...curr, open: false } : null)
        return
      }

      // K9s Navigation logic
      if (activeRes !== 'pulse' && activeRes !== 'yaml' && activeRes !== 'events' && filteredData.length > 0 && selectedCluster && !editingYaml.open && !drawer?.open) {
         if (e.key === 'j' || e.key === 'ArrowDown') {
             e.preventDefault()
             setSelectedIndex(curr => Math.min(curr + 1, filteredData.length - 1))
         }
         else if (e.key === 'k' || e.key === 'ArrowUp') {
             e.preventDefault()
             setSelectedIndex(curr => Math.max(curr - 1, 0))
         }
         else if (e.key === '/') {
             e.preventDefault()
             setShowSearch(true)
             setTimeout(() => searchInputRef.current?.focus(), 50)
         }
         else if (e.key === '0') {
             e.preventDefault()
             setSelectedNS('All')
         }
         else if (e.key === 'e') {
             e.preventDefault()
             const item = filteredData[selectedIndex];
             fetchYaml(item.kind?.toLowerCase() || activeRes.slice(0, -1), item.metadata.name, item.metadata.namespace)
         }
         else if (e.key === 'l' && activeRes === 'pods') {
             e.preventDefault()
             const item = filteredData[selectedIndex];
             setDrawer({ open: true, mode: 'logs', pod: item.metadata.name, ns: item.metadata.namespace })
         }
         else if (e.key === 's' && activeRes === 'pods') {
             e.preventDefault()
             const item = filteredData[selectedIndex];
             setDrawer({ open: true, mode: 'shell', pod: item.metadata.name, ns: item.metadata.namespace })
         }
         else if (e.key === 'd') {
             e.preventDefault()
             const item = filteredData[selectedIndex];
             handleDeleteResource(item)
         }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showCommandBar, activeRes, filteredData, selectedIndex, selectedCluster, editingYaml.open, drawer?.open])

  async function loadClusters() {
    try {
      const res = await api.get('/api/servers')
      setClusters(res.data || [])
    } catch (e) { console.error(e) }
  }

  const fetchNamespaces = useCallback(async (clusterId: number) => {
    try {
      const res = await api.post(`/api/servers/${clusterId}/kubectl`, { command: 'get namespaces -o json' })
      if (res.data.success) {
        const parsed = JSON.parse(res.data.output)
        const nsList = (parsed.items || []).map((i: any) => i.metadata.name)
        setNamespaces(nsList)
      }
    } catch (e) { console.error("NS Fetch error:", e) }
  }, [])

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

  const activeWsRef = useRef<WebSocket | null>(null)

  const watchK8sData = useCallback((clusterId: number, resource: ResourceType) => {
    if (resource === 'yaml') return;
    setLoading(true)
    setConnecting(true)
    setData([])
    
    if (activeWsRef.current) {
       activeWsRef.current.close()
    }

    const ws = new WebSocket(buildWsUrl(`/ws/servers/${clusterId}/k8s/watch?resource=${resource}&namespace=${selectedNS}`));
    activeWsRef.current = ws;

    ws.onmessage = (event) => {
        setLoading(false)
        setConnecting(false)
        try {
           const parsed = JSON.parse(event.data);
           if (parsed.error) {
              console.error("Kubectl Error:", parsed.error, "Stderr:", parsed.stderr, "Cmd:", parsed.cmd)
              if (resource === 'pulse') setPulseError(parsed.details || parsed.stderr || parsed.error)
              else setPulseError(parsed.details || parsed.stderr || parsed.error)
              setData([])
              return
           }
           setPulseError(null)

           if (resource === 'pulse') {
             if (parsed.kind === 'Pulse') {
               setStats(parsed.stats)
               setData([])
             }
           } else {
             setData(parsed.items || [])
           }
        } catch(e) {
           console.error("JSON parse error:", e, event.data?.substring?.(0, 200));
           setData([]);
        }
    }
    
    ws.onerror = (err) => {
       console.error("WS error:", err);
       setLoading(false)
       setConnecting(false)
       setPulseError('WebSocket connection failed. Check that the backend is running and the server is reachable.')
    }
    ws.onclose = (ev) => {
       console.log("K8s WS closed", ev.code, ev.reason)
       setConnecting(false)
    }
  }, [selectedNS])

  useEffect(() => {
     return () => {
        if (activeWsRef.current) activeWsRef.current.close()
     }
  }, [])

  // Reset namespaces and data when cluster changes
  useEffect(() => {
    if (selectedCluster) {
      setNamespaces([])
      setSelectedNS('All')
      setData([])
      setPulseError(null)
      setStats({ nodes: 0, pods: 0, deployments: 0, services: 0, events: 0 })
      fetchNamespaces(selectedCluster.id)
    }
  }, [selectedCluster])

  useEffect(() => {
    if (selectedCluster) {
      watchK8sData(selectedCluster.id, activeRes)
    }
  }, [selectedCluster, activeRes, selectedNS])

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
         'p': 'pods', 'po': 'pods', 'pods': 'pods', 'pod': 'pods',
         'n': 'nodes', 'no': 'nodes', 'nodes': 'nodes', 'node': 'nodes',
         'd': 'deployments', 'dp': 'deployments', 'deploy': 'deployments', 'deployments': 'deployments',
         's': 'services', 'svc': 'services', 'services': 'services', 'service': 'services',
         'e': 'events', 'ev': 'events', 'events': 'events', 'pulse': 'pulse', 'y': 'yaml'
       }
       if (routes[input]) {
           setActiveRes(routes[input])
           setCmdError(false)
       } else {
           setCmdError(true)
           setTimeout(() => setCmdError(false), 800)
           return // don't close command bar on error
       }
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
        // The WebSocket handles refresh automatically now, so we just let it run
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
      {/* Floating Overlays */}
      {showAddCluster && <AddClusterModal onClose={() => setShowAddCluster(false)} onSuccess={loadClusters} />}

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

              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} disabled={activeRes === 'yaml'} onClick={() => { if(selectedCluster) watchK8sData(selectedCluster.id, activeRes) }}>
                <RefreshCw size={12} style={{ marginRight: 6 }} className={loading ? 'spin' : ''} /> Resync
              </button>
           </div>
        </header>

         <main style={{ flex: 1, overflowY: 'auto', padding: 24, position: 'relative' }}>
          {(showSearch || showCommandBar) && (
            <div className="fade-down" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)', padding: '12px 16px', border: cmdError ? '1px solid var(--error)' : '1px solid var(--border-bright)', borderRadius: 12, marginBottom: 16, display: 'flex', alignItems: 'center', boxShadow: 'var(--shadow-md)', transition: 'border-color 0.2s' }}>
              <span style={{ color: cmdError ? 'var(--error)' : 'var(--brand-primary)', fontWeight: 800, marginRight: 12 }}>{showSearch ? '/' : ':'}</span>
              {showSearch ? (
                  <input 
                    ref={searchInputRef}
                    value={filterQuery}
                    onChange={e => setFilterQuery(e.target.value)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: '100%' }}
                    placeholder="Fuzzy search resources..."
                  />
              ) : (
                 <form onSubmit={handleCommandSubmit} style={{ flex: 1, margin: 0 }}>
                    <input 
                      ref={cmdInputRef}
                      value={commandInput}
                      onChange={e => setCommandInput(e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: '100%' }}
                      placeholder="resource (e.g. pods, pos, deploy, ns default)..."
                    />
                 </form>
              )}
              <button className="btn-icon" onClick={() => { setShowSearch(false); setShowCommandBar(false); setFilterQuery(''); setCommandInput('') }}><X size={14}/></button>
            </div>
          )}
          {activeRes === 'pulse' && <PulseDashboard cluster={selectedCluster} stats={stats} error={pulseError} connecting={connecting} onJump={(r: ResourceType) => setActiveRes(r)} onResync={() => watchK8sData(selectedCluster.id, activeRes)} />}
          {activeRes === 'nodes' && <KTable columns={['Name', 'Status', 'Role', 'Version']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(n: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('node', n.metadata.name)}><FileCode size={14} /></button>} 
          />}
          {activeRes === 'pods' && <KTable 
             columns={['Name', 'Namespace', 'Restarts', 'Status']} 
             data={filteredData} 
             loading={connecting}
             selectedIndex={selectedIndex}
             actions={ (p: any) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('pod', p.metadata.name, p.metadata.namespace)}><FileCode size={14} /></button>
                  <button className="btn-icon" title="Logs" onClick={() => setDrawer({ open: true, mode: 'logs', pod: p.metadata.name, ns: p.metadata.namespace })}><List size={14} /></button>
                  <button className="btn-icon" title="Shell" onClick={() => setDrawer({ open: true, mode: 'shell', pod: p.metadata.name, ns: p.metadata.namespace })}><Terminal size={14} /></button>
                </>
             )}
          />}
          {activeRes === 'deployments' && <KTable columns={['Name', 'Namespace', 'Ready', 'Available']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('deployment', d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'services' && <KTable columns={['Name', 'Namespace', 'Type', 'Cluster-IP']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('service', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'events' && <KTable columns={['Type', 'Reason', 'Object', 'Message', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} />}
          {activeRes === 'yaml' && <ConfigViewer content={yamlConfig} onChange={setYamlConfig} />}
          {pulseError && activeRes !== 'pulse' && (
            <div className="fade-in" style={{ marginTop: 24, padding: '16px 20px', borderRadius: 12, background: 'var(--danger-glow, #fff1f2)', border: '1px solid var(--danger, #ef4444)', color: 'var(--danger, #ef4444)', fontSize: 13 }}>
              <strong>⚠ Cluster Error:</strong> {pulseError}
            </div>
          )}
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
        .k-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; }
        .k-table th { text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; background: #fafafa; border-bottom: 2px solid var(--border); letter-spacing: 0.05em; }
        .k-table td { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px; vertical-align: middle; }
        .k-table tr { transition: background-color 0.15s ease; }
        .k-table tr:hover td { background: var(--bg-card); cursor: pointer; }
        .k-row-selected td { background: var(--brand-glow) !important; color: var(--text-primary) !important; font-weight: 600; }
        .k-row-selected td:first-child { border-left: 3px solid var(--brand-primary); }
        @keyframes pulse-skeleton { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
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

function PulseDashboard({ cluster, stats, error, connecting, onJump, onResync }: any) {
  return (
    <div className="fade-in">
       <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>{cluster.name}</h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Live cluster topology and workload distribution</p>
          </div>
          <button className="btn btn-secondary" onClick={onResync} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={14} className={connecting ? 'spin' : ''} />
            <span>{connecting ? 'Connecting…' : 'Force Resync'}</span>
          </button>
       </div>

       {error ? (
         <div className="card" style={{ padding: 40, textAlign: 'center', border: '1px solid #fca5a5', background: '#fff1f2' }}>
            <div style={{ color: '#dc2626', marginBottom: 16 }}>
               <Zap size={40} />
            </div>
            <h3 style={{ fontWeight: 700, color: 'var(--text-primary)' }}>K8s Telemetry Offline</h3>
            <p style={{ fontSize: 13, color: '#7f1d1d', marginTop: 8, maxWidth: 560, margin: '8px auto', fontFamily: 'monospace', background: '#fee2e2', padding: '12px 16px', borderRadius: 8, textAlign: 'left', wordBreak: 'break-all' }}>
               {error}
            </p>
            <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'left', maxWidth: 480, margin: '20px auto 0', lineHeight: 2 }}>
               <strong>Common fixes:</strong><br />
               • Ensure <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>kubectl</code> is installed on the server<br />
               • Verify the kubeconfig servers[].server URL is reachable from the proxy host<br />
               • If using k3s: paste output of <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>sudo k3s kubectl config view --raw</code><br />
               • Check that kubeconfig context is correct: <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>kubectl config current-context</code>
            </div>
            <button className="btn btn-secondary" onClick={onResync} style={{ marginTop: 24 }}>Retry Connection</button>
         </div>
       ) : connecting ? (
         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            {['Nodes', 'Pods', 'Deployments', 'Active Events'].map(label => (
              <div key={label} className="card" style={{ padding: 28, opacity: 0.5, animation: 'pulse-skeleton 1.5s ease infinite' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#e2e8f0', marginBottom: 20 }} />
                <div style={{ height: 40, background: '#e2e8f0', borderRadius: 8, marginBottom: 8, width: '40%' }} />
                <div style={{ height: 12, background: '#e2e8f0', borderRadius: 4, width: '60%' }} />
              </div>
            ))}
         </div>
       ) : (
         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            <PulseStat label="Nodes" count={stats.nodes} icon={Server} color="var(--brand-primary)" onClick={() => onJump('nodes')} />
            <PulseStat label="Pods" count={stats.pods} icon={Boxes} color="var(--info)" onClick={() => onJump('pods')} />
            <PulseStat label="Deployments" count={stats.deployments} icon={LayoutGrid} color="var(--success)" onClick={() => onJump('deployments')} />
            <PulseStat label="Active Events" count={stats.events} icon={Activity} color="var(--warning)" onClick={() => onJump('events')} />
         </div>
       )}
    </div>
  )
}

function PulseStat({ label, count, icon: Icon, color, onClick }: any) {
  return (
    <div className="card hover-lift" style={{ cursor: 'pointer', padding: 28, position: 'relative', overflow: 'hidden', border: `1px solid ${color}20`, background: `linear-gradient(145deg, #ffffff, ${color}03)` }} onClick={onClick}>
       <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.05, color, transform: 'rotate(-10deg)' }}>
          <Icon size={140} />
       </div>
       <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Icon size={22} />
       </div>
       <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: 'var(--text-primary)' }}>{count}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
       </div>
    </div>
  )
}

function KTable({ columns, data, actions, selectedIndex, loading }: any) {
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
      case 'type': return item.type || item.spec?.type || '—';
      case 'reason': return item.reason || '—';
      case 'object': return item.involvedObject ? `${item.involvedObject.kind}/${item.involvedObject.name}` : '—';
      case 'message': return item.message || '—';
      case 'age': {
          if (!item.lastTimestamp && !item.creationTimestamp) return '—';
          const ts = new Date(item.lastTimestamp || item.creationTimestamp).getTime();
          const diff = (Date.now() - ts) / 1000;
          if (diff < 60) return `${Math.floor(diff)}s`;
          if (diff < 3600) return `${Math.floor(diff/60)}m`;
          if (diff < 86400) return `${Math.floor(diff/3600)}h`;
          return `${Math.floor(diff/86400)}d`;
      }
      case 'cluster-ip': return item.spec?.clusterIP;
      case 'internal-ip': return item.status?.addresses?.find((a: any) => a.type === 'InternalIP')?.address;
      default: return '—';
    }
  }

  const colCount = columns.length + (actions ? 1 : 0)

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
             {loading ? (
               Array.from({ length: 5 }).map((_, i) => (
                 <tr key={`skel-${i}`}>
                   {Array.from({ length: colCount }).map((_, j) => (
                     <td key={j}><div style={{ height: 14, background: '#f1f5f9', borderRadius: 4, width: j === 0 ? '60%' : '40%', animation: 'pulse-skeleton 1.5s ease infinite' }} /></td>
                   ))}
                 </tr>
               ))
             ) : data.length === 0 ? (
               <tr>
                 <td colSpan={colCount} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: 13 }}>
                   No resources found
                 </td>
               </tr>
             ) : data.map((item: any, i: number) => (
                <tr key={i} className={selectedIndex === i ? 'k-row-selected' : ''}>
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
