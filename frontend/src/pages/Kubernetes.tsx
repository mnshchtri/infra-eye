import { useEffect, useState, useRef, useCallback } from 'react'
import { 
  Plus, LayoutGrid, Server, 
  RefreshCw, FileCode,
  Boxes, ChevronRight, Activity,
  Globe, X, Terminal,
  List, Zap, Trash2, Unlink,
  Shield, Key, Lock, HardDrive,
  Database, Gauge, Cpu, Layers,
  ChevronDown, ChevronUp
} from 'lucide-react'
import { api, buildWsUrl } from '../api/client'
import CodeEditor from '@uiw/react-textarea-code-editor'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'

interface Cluster {
  id: number;
  name: string;
  host: string;
  kube_config?: string;
}

interface PortForwardSession {
  id: string
  target: string
  namespace: string
  local_port: number
  remote_port: number
  pid: string
  created_at: string
}

type ResourceType = 
  | 'pulse' | 'nodes' | 'pods' | 'deployments' | 'daemonsets' | 'statefulsets' | 'replicasets' | 'jobs' | 'cronjobs'
  | 'configmaps' | 'secrets' | 'resourcequotas' | 'hpa'
  | 'services' | 'endpoints' | 'ingresses' | 'networkpolicies'
  | 'pvcs' | 'pvs' | 'storageclasses'
  | 'serviceaccounts' | 'roles' | 'clusterroles' | 'rolebindings' | 'clusterrolebindings'
  | 'events' | 'yaml';

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
  const { can } = usePermission()
  const canUseKubectl = can('use-kubectl')
  
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
  
  // Sidebar expanded categories
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({
    cluster: true,
    workloads: true,
    config: false,
    network: false,
    storage: false,
    rbac: false
  })

  const toggleCategory = (cat: string) => {
    setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))
  }
  
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
  const [drawer, setDrawer] = useState<{ open: boolean; mode: 'logs' | 'shell'; pod?: string; ns?: string; container?: string } | null>(null)
  const [showPortForward, setShowPortForward] = useState(false)
  const [portForwards, setPortForwards] = useState<PortForwardSession[]>([])

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
             setDrawer({ open: true, mode: 'logs', pod: item.metadata.name, ns: item.metadata.namespace, container: item.spec?.containers?.[0]?.name })
         }
        else if (e.key === 's' && activeRes === 'pods' && canUseKubectl) {
             e.preventDefault()
             const item = filteredData[selectedIndex];
             setDrawer({ open: true, mode: 'shell', pod: item.metadata.name, ns: item.metadata.namespace, container: item.spec?.containers?.[0]?.name })
         }
        else if (e.key.toLowerCase() === 'f' && e.shiftKey && canUseKubectl) {
            e.preventDefault()
            setShowPortForward(true)
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
  }, [showCommandBar, activeRes, filteredData, selectedIndex, selectedCluster, editingYaml.open, drawer?.open, canUseKubectl])

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

  const fetchPortForwards = useCallback(async () => {
    if (!selectedCluster || !canUseKubectl) return
    try {
      const res = await api.get(`/api/servers/${selectedCluster.id}/kubectl/port-forward`)
      setPortForwards(res.data.sessions || [])
    } catch (e: any) {
      toast.error('Port-forward list failed', e.response?.data?.error || 'Unable to load sessions')
    }
  }, [selectedCluster, canUseKubectl, toast])

  useEffect(() => {
    if (showPortForward) fetchPortForwards()
  }, [showPortForward, fetchPortForwards])

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
          'ds': 'daemonsets', 'daemonset': 'daemonsets',
          'sts': 'statefulsets', 'statefulset': 'statefulsets',
          'rs': 'replicasets', 'replicaset': 'replicasets',
          'job': 'jobs', 'jobs': 'jobs',
          'cj': 'cronjobs', 'cronjob': 'cronjobs',
          'cm': 'configmaps', 'configmap': 'configmaps',
          'sec': 'secrets', 'secret': 'secrets',
          'rq': 'resourcequotas', 'quota': 'resourcequotas',
          'hpa': 'hpa',
          's': 'services', 'svc': 'services', 'services': 'services', 'service': 'services',
          'ep': 'endpoints', 'endpoint': 'endpoints',
          'ing': 'ingresses', 'ingress': 'ingresses',
          'np': 'networkpolicies', 'netpol': 'networkpolicies',
          'pvc': 'pvcs', 'pv': 'pvs', 'sc': 'storageclasses',
          'sa': 'serviceaccounts', 'role': 'roles', 'crole': 'clusterroles',
          'rb': 'rolebindings', 'crb': 'clusterrolebindings',
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

      {/* Internal Sidebar - Lens Style */}
      <div style={{ width: 240, background: '#fff', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflowX: 'hidden' }}>
        <div style={{ padding: '16px 12px 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
           <button className="btn-icon" onClick={() => setSelectedCluster(null)} style={{ padding: 4 }}>
             <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
           </button>
           <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 10 }}>
                {selectedCluster.name.substring(0, 2).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
                  {selectedCluster.name}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Kubernetes Cluster</span>
              </div>
           </div>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }} className="k8s-sidebar-nav">
          <ResNavLink active={activeRes === 'pulse'} onClick={() => setActiveRes('pulse')} icon={Activity} label="Pulse Dashboard" />
          
          <NavCategory label="Cluster" icon={Gauge} isOpen={expandedCats.cluster} onToggle={() => toggleCategory('cluster')}>
            <ResNavLink active={activeRes === 'nodes'} onClick={() => setActiveRes('nodes')} icon={Server} label="Nodes" isSub />
            <ResNavLink active={activeRes === 'events'} onClick={() => setActiveRes('events')} icon={List} label="Events" isSub />
          </NavCategory>

          <NavCategory label="Workloads" icon={Layers} isOpen={expandedCats.workloads} onToggle={() => toggleCategory('workloads')}>
            <ResNavLink active={activeRes === 'pods'} onClick={() => setActiveRes('pods')} icon={Boxes} label="Pods" isSub />
            <ResNavLink active={activeRes === 'deployments'} onClick={() => setActiveRes('deployments')} icon={LayoutGrid} label="Deployments" isSub />
            <ResNavLink active={activeRes === 'daemonsets'} onClick={() => setActiveRes('daemonsets')} icon={Cpu} label="DaemonSets" isSub />
            <ResNavLink active={activeRes === 'statefulsets'} onClick={() => setActiveRes('statefulsets')} icon={Database} label="StatefulSets" isSub />
            <ResNavLink active={activeRes === 'replicasets'} onClick={() => setActiveRes('replicasets')} icon={Layers} label="ReplicaSets" isSub />
            <ResNavLink active={activeRes === 'jobs'} onClick={() => setActiveRes('jobs')} icon={Activity} label="Jobs" isSub />
            <ResNavLink active={activeRes === 'cronjobs'} onClick={() => setActiveRes('cronjobs')} icon={Activity} label="CronJobs" isSub />
          </NavCategory>

          <NavCategory label="Config" icon={Lock} isOpen={expandedCats.config} onToggle={() => toggleCategory('config')}>
            <ResNavLink active={activeRes === 'configmaps'} onClick={() => setActiveRes('configmaps')} icon={FileCode} label="ConfigMaps" isSub />
            <ResNavLink active={activeRes === 'secrets'} onClick={() => setActiveRes('secrets')} icon={Key} label="Secrets" isSub />
            <ResNavLink active={activeRes === 'resourcequotas'} onClick={() => setActiveRes('resourcequotas')} icon={Shield} label="ResourceQuotas" isSub />
            <ResNavLink active={activeRes === 'hpa'} onClick={() => setActiveRes('hpa')} icon={Activity} label="HPA" isSub />
          </NavCategory>

          <NavCategory label="Network" icon={Globe} isOpen={expandedCats.network} onToggle={() => toggleCategory('network')}>
            <ResNavLink active={activeRes === 'services'} onClick={() => setActiveRes('services')} icon={Globe} label="Services" isSub />
            <ResNavLink active={activeRes === 'endpoints'} onClick={() => setActiveRes('endpoints')} icon={List} label="Endpoints" isSub />
            <ResNavLink active={activeRes === 'ingresses'} onClick={() => setActiveRes('ingresses')} icon={Globe} label="Ingresses" isSub />
            <ResNavLink active={activeRes === 'networkpolicies'} onClick={() => setActiveRes('networkpolicies')} icon={Shield} label="NetworkPolicies" isSub />
          </NavCategory>

          <NavCategory label="Storage" icon={HardDrive} isOpen={expandedCats.storage} onToggle={() => toggleCategory('storage')}>
            <ResNavLink active={activeRes === 'pvcs'} onClick={() => setActiveRes('pvcs')} icon={Database} label="PVCs" isSub />
            <ResNavLink active={activeRes === 'pvs'} onClick={() => setActiveRes('pvs')} icon={Database} label="PVs" isSub />
            <ResNavLink active={activeRes === 'storageclasses'} onClick={() => setActiveRes('storageclasses')} icon={HardDrive} label="StorageClasses" isSub />
          </NavCategory>

          <NavCategory label="Access Control" icon={Shield} isOpen={expandedCats.rbac} onToggle={() => toggleCategory('rbac')}>
            <ResNavLink active={activeRes === 'serviceaccounts'} onClick={() => setActiveRes('serviceaccounts')} icon={Server} label="ServiceAccounts" isSub />
            <ResNavLink active={activeRes === 'clusterroles'} onClick={() => setActiveRes('clusterroles')} icon={Lock} label="ClusterRoles" isSub />
            <ResNavLink active={activeRes === 'roles'} onClick={() => setActiveRes('roles')} icon={Lock} label="Roles" isSub />
            <ResNavLink active={activeRes === 'clusterrolebindings'} onClick={() => setActiveRes('clusterrolebindings')} icon={Lock} label="CRB" isSub />
            <ResNavLink active={activeRes === 'rolebindings'} onClick={() => setActiveRes('rolebindings')} icon={Lock} label="RoleBindings" isSub />
          </NavCategory>

          <div style={{ marginTop: 12 }}>
            <ResNavLink active={activeRes === 'yaml'} onClick={() => setActiveRes('yaml')} icon={FileCode} label="Raw Configuration" />
          </div>
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
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>PRESS <kbd style={{ background: '#f1f5f9', padding: '2px 4px', border: '1px solid #e2e8f0', borderRadius: 4 }}>:</kbd> FOR CLI {canUseKubectl ? ' • SHIFT+F for Port Forward' : ''}</div>
              {canUseKubectl && (
                <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setShowPortForward(true)}>
                  Port Forward
                </button>
              )}
              
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
          {activeRes === 'nodes' && <KTable columns={['Name', 'Status', 'Role', 'Version', 'Internal-IP']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
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
                  <button className="btn-icon" title="Logs" onClick={() => setDrawer({ open: true, mode: 'logs', pod: p.metadata.name, ns: p.metadata.namespace, container: p.spec?.containers?.[0]?.name })}><List size={14} /></button>
                  {canUseKubectl && (
                    <button className="btn-icon" title="Shell" onClick={() => setDrawer({ open: true, mode: 'shell', pod: p.metadata.name, ns: p.metadata.namespace, container: p.spec?.containers?.[0]?.name })}><Terminal size={14} /></button>
                  )}
                </>
             )}
          />}
          {['deployments', 'daemonsets', 'statefulsets', 'replicasets'].includes(activeRes) && <KTable columns={['Name', 'Namespace', 'Ready', 'Available', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(d.kind?.toLowerCase() || activeRes.slice(0, -1), d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {['jobs', 'cronjobs'].includes(activeRes) && <KTable columns={['Name', 'Namespace', 'Status', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(d.kind?.toLowerCase() || activeRes.slice(0, -1), d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {['configmaps', 'secrets', 'resourcequotas', 'serviceaccounts'].includes(activeRes) && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(d.kind?.toLowerCase() || activeRes.slice(0, -1), d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'hpa' && <KTable columns={['Name', 'Namespace', 'Targets', 'MinPods', 'MaxPods', 'Replicas']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('horizontalpodautoscaler', d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'services' && <KTable columns={['Name', 'Namespace', 'Type', 'Cluster-IP', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('service', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'endpoints' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('endpoints', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'ingresses' && <KTable columns={['Name', 'Namespace', 'Hosts', 'Address', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('ingress', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'networkpolicies' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('networkpolicy', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'pvcs' && <KTable columns={['Name', 'Namespace', 'Status', 'Volume', 'Capacity', 'AccessModes', 'StorageClass', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('persistentvolumeclaim', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'pvs' && <KTable columns={['Name', 'Capacity', 'AccessModes', 'ReclaimPolicy', 'Status', 'Claim', 'StorageClass', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('persistentvolume', s.metadata.name)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'storageclasses' && <KTable columns={['Name', 'Provisioner', 'ReclaimPolicy', 'VolumeBindingMode', 'AllowVolumeExpansion', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('storageclass', s.metadata.name)}><FileCode size={14} /></button>}
          />}
          {['roles', 'clusterroles', 'rolebindings', 'clusterrolebindings'].includes(activeRes) && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex}
             actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(d.kind?.toLowerCase() || activeRes.slice(0, -1), d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
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

      {showPortForward && selectedCluster && canUseKubectl && (
        <PortForwardModal
          serverID={selectedCluster.id}
          sessions={portForwards}
          onClose={() => setShowPortForward(false)}
          onRefresh={fetchPortForwards}
        />
      )}

      {drawer?.open && canUseKubectl && (
        <TerminalPortal 
          serverID={selectedCluster.id} 
          pod={drawer.pod!} 
          namespace={drawer.ns!} 
          container={drawer.container}
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
        .res-nav-link { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); margin-bottom: 2px; }
        .res-nav-link:hover { background: #f1f5f9; color: var(--text-primary); }
        .res-nav-link.active { background: var(--brand-glow); color: var(--brand-primary); box-shadow: 0 4px 12px -4px var(--brand-primary)40; }
        .res-nav-link.sub { padding: 8px 12px 8px 36px; font-size: 12px; font-weight: 500; opacity: 0.8; }
        .res-nav-link.sub:hover { opacity: 1; }
        .res-nav-link.sub.active { opacity: 1; font-weight: 700; background: var(--brand-primary)08; }
        
        .nav-cat { margin-bottom: 4px; }
        .nav-cat-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.15s; color: var(--text-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .nav-cat-header:hover { background: #f8fafc; color: var(--text-primary); }
        .nav-cat-header.open { color: var(--text-primary); }
        .nav-cat-body { padding-left: 4px; border-left: 1px solid #f1f5f9; margin-left: 18px; margin-top: 2px; margin-bottom: 8px; }

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

function ResNavLink({ active, onClick, icon: Icon, label, isSub }: any) {
  return (
    <div className={`res-nav-link ${active ? 'active' : ''} ${isSub ? 'sub' : ''}`} onClick={onClick}>
      <Icon size={isSub ? 13 : 15} strokeWidth={active ? 2.5 : 1.5} />
      <span>{label}</span>
    </div>
  )
}

function NavCategory({ label, icon: Icon, children, isOpen, onToggle }: any) {
  return (
    <div className="nav-cat">
      <div className={`nav-cat-header ${isOpen ? 'open' : ''}`} onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon size={14} strokeWidth={1.5} color="var(--text-muted)" />
          <span>{label}</span>
        </div>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </div>
      {isOpen && (
        <div className="nav-cat-body fade-down">
          {children}
        </div>
      )}
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
      case 'ready': return `${item.status?.readyReplicas || item.status?.numberReady || 0}/${item.spec?.replicas || item.status?.desiredNumberScheduled || 0}`;
      case 'available': return item.status?.availableReplicas || item.status?.numberAvailable || 0;
      case 'type': return item.type || item.spec?.type || '—';
      case 'reason': return item.reason || '—';
      case 'object': return item.involvedObject ? `${item.involvedObject.kind}/${item.involvedObject.name}` : '—';
      case 'message': return item.message || '—';
      case 'targets': {
         const current = item.status?.currentCPUUtilizationPercentage ?? '?';
         const target = item.spec?.targetCPUUtilizationPercentage ?? '?';
         return `${current}% / ${target}%`;
      }
      case 'minpods': return item.spec?.minReplicas ?? 0;
      case 'maxpods': return item.spec?.maxReplicas ?? 0;
      case 'replicas': return item.status?.currentReplicas ?? 0;
      case 'hosts': return item.spec?.rules?.[0]?.host || '—';
      case 'address': return item.status?.loadBalancer?.ingress?.[0]?.ip || item.status?.loadBalancer?.ingress?.[0]?.hostname || '—';
      case 'volume': return item.spec?.volumeName || '—';
      case 'capacity': return item.status?.capacity?.storage || item.spec?.resources?.requests?.storage || '—';
      case 'accessmodes': return item.spec?.accessModes?.join(', ') || '—';
      case 'storageclass': return item.spec?.storageClassName || '—';
      case 'claim': return item.spec?.claimRef ? `${item.spec.claimRef.namespace}/${item.spec.claimRef.name}` : '—';
      case 'reclaimpolicy': return item.spec?.persistentVolumeReclaimPolicy || item.reclaimPolicy || '—';
      case 'provisioner': return item.provisioner || '—';
      case 'volumebindingmode': return item.volumeBindingMode || '—';
      case 'allowvolumeexpansion': return item.allowVolumeExpansion ? 'True' : 'False';
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
      await api.post('/api/servers', { ...form, auth_type: 'password', tags: 'kubernetes', is_k8s: true }) 
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
      <CodeEditor
        value={content}
        language="yaml"
        placeholder="Write or paste Kubernetes manifest YAML..."
        onChange={(evn) => onChange(evn.target.value)}
        padding={16}
        data-color-mode="light"
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13,
          backgroundColor: 'transparent',
          minHeight: '100%',
          overflow: 'auto'
        }}
      />
    </div>
  )
}

function PortForwardModal({ serverID, sessions, onClose, onRefresh }: any) {
  const toast = useToastStore()
  const [form, setForm] = useState({ namespace: 'default', target: '', local_port: '', remote_port: '' })
  const [busy, setBusy] = useState(false)

  const createPortForward = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(`/api/servers/${serverID}/kubectl/port-forward`, {
        namespace: form.namespace,
        target: form.target,
        local_port: Number(form.local_port),
        remote_port: Number(form.remote_port)
      })
      toast.success('Port forward started', `${form.target} ${form.local_port}:${form.remote_port}`)
      setForm((prev: any) => ({ ...prev, target: '', local_port: '', remote_port: '' }))
      onRefresh()
    } catch (e: any) {
      toast.error('Port-forward failed', e.response?.data?.error || 'Unable to start port-forward')
    } finally {
      setBusy(false)
    }
  }

  const stopPortForward = async (id: string) => {
    try {
      await api.delete(`/api/servers/${serverID}/kubectl/port-forward/${id}`)
      toast.success('Port forward stopped', `Session ${id} terminated`)
      onRefresh()
    } catch (e: any) {
      toast.error('Stop failed', e.response?.data?.error || 'Unable to stop port-forward')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card fade-up" style={{ width: 760, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Kubernetes Port Forward Manager</h3>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={createPortForward} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr auto', gap: 10, marginBottom: 16 }}>
          <input className="input" placeholder="Namespace" value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} required />
          <input className="input" placeholder="Target (svc/my-service or pod/my-pod)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required />
          <input className="input" placeholder="Local" value={form.local_port} onChange={(e) => setForm({ ...form, local_port: e.target.value })} required />
          <input className="input" placeholder="Remote" value={form.remote_port} onChange={(e) => setForm({ ...form, remote_port: e.target.value })} required />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Starting...' : 'Start'}</button>
        </form>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table className="k-table">
            <thead>
              <tr>
                <th>Target</th><th>Namespace</th><th>Ports</th><th>PID</th><th>Started</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No active port forwards</td></tr>
              ) : sessions.map((s: PortForwardSession) => (
                <tr key={s.id}>
                  <td>{s.target}</td>
                  <td>{s.namespace}</td>
                  <td>{s.local_port}:{s.remote_port}</td>
                  <td>{s.pid}</td>
                  <td>{new Date(s.created_at).toLocaleString()}</td>
                  <td><button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => stopPortForward(s.id)}>Stop</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TerminalPortal({ serverID, pod, namespace, container, mode, onClose }: any) {
  const terminalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!terminalRef.current) return;
    const term = new XTerm({ theme: { background: '#0f172a', foreground: '#cbd5e1' }, fontSize: 13, fontFamily: '"JetBrains Mono", monospace' })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()
    const params = new URLSearchParams({
      pod,
      namespace,
      mode,
    })
    if (container) params.set('container', container)
    const ws = new WebSocket(buildWsUrl(`/ws/servers/${serverID}/kubectl/pod-terminal?${params.toString()}`))
    ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') { term.write(ev.data) }
        else { ev.data.arrayBuffer().then((buf: any) => term.write(new Uint8Array(buf))) }
    }
    ws.onerror = () => {
      term.writeln('\r\n[infra-eye] websocket error while opening pod stream.\r\n')
    }
    ws.onclose = () => {
      term.writeln('\r\n[infra-eye] pod stream closed.\r\n')
    }
    // Logs streams are read-only; shell streams are interactive.
    if (mode === 'shell') {
      term.onData((data) => ws.send(data))
    }
    return () => { ws.close(); term.dispose(); }
  }, [serverID, pod, namespace, container, mode])

  return (
    <div className="fade-up" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: '38vh', minHeight: 260, maxHeight: '60vh', background: '#fff', borderTop: '1px solid var(--border)', zIndex: 1200, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
       <div style={{ height: 46, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
             <Terminal size={14} color="var(--brand-primary)" />
             <span style={{ fontSize: 12, fontWeight: 700 }}>POD {mode.toUpperCase()} • {namespace}/{pod}</span>
             <span className="badge badge-online" style={{ fontSize: 10 }}>LIVE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Esc to close</span>
            <button onClick={onClose}><X size={16} color="var(--text-muted)" /></button>
          </div>
       </div>
       <div ref={terminalRef} style={{ flex: 1, padding: 10, background: '#0f172a' }} />
    </div>
  )
}
