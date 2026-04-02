import { memo, useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react'
import { 
  LayoutGrid, Server, 
  RefreshCw, FileCode,
  Boxes, ChevronRight, Activity,
  Globe, X, Terminal,
  List,
  Shield, Key, Lock,
  Database, Gauge, Cpu, Layers
} from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../OSIcons'
import { api, buildWsUrl } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { KTable } from './KTable'
import { ResNavLink, NavCategory } from './K8sSidebar'
import { PulseDashboard } from './PulseDashboard'
import { ConfigViewer } from './ConfigViewer'
import { PortForwardModal } from './PortForwardModal'
import { TerminalPortal } from './TerminalPortal'
import { MCPTerminal } from './MCPTerminal'

interface Cluster {
  id: number;
  name: string;
  host: string;
  os?: string;
  kube_config?: string;
}

type ResourceType = 
  | 'pulse' | 'nodes' | 'pods' | 'deployments' | 'daemonsets' | 'statefulsets' | 'replicasets' | 'jobs' | 'cronjobs'
  | 'configmaps' | 'secrets' | 'resourcequotas' | 'hpa'
  | 'services' | 'endpoints' | 'ingresses' | 'networkpolicies'
  | 'pvcs' | 'pvs' | 'storageclasses'
  | 'serviceaccounts' | 'roles' | 'clusterroles' | 'rolebindings' | 'clusterrolebindings'
  | 'events' | 'yaml';

interface K8sResourceExplorerProps {
  cluster: Cluster;
  onBack: () => void;
  canUseKubectl: boolean;
}

export const K8sResourceExplorer = memo(({ cluster, onBack, canUseKubectl }: K8sResourceExplorerProps) => {
  const [activeRes, setActiveRes] = useState<ResourceType>('pulse')
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNS, setSelectedNS] = useState<string>('All')
  const [stats, setStats] = useState({ nodes: 0, pods: 0, deployments: 0, services: 0, events: 0 })
  const [pulseError, setPulseError] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [showCommandBar, setShowCommandBar] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [cmdError, setCmdError] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editingYaml, setEditingYaml] = useState<{ open: boolean; content: string; name?: string; ns?: string; kind?: string }>({ open: false, content: '' })
  const [drawer, setDrawer] = useState<{ open: boolean; mode: 'logs' | 'shell'; pod?: string; ns?: string; container?: string } | null>(null)
  const [showPortForward, setShowPortForward] = useState(false)
  const [portForwards, setPortForwards] = useState<any[]>([])
  const [applyResult, setApplyResult] = useState<{ success: boolean; msg: string } | null>(null)
  const [showMCPTerminal, setShowMCPTerminal] = useState(false)
  
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({
    cluster: true,
    workloads: true,
    config: false,
    network: false,
    storage: false,
    rbac: false
  })

  const toast = useToastStore()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const cmdInputRef = useRef<HTMLInputElement>(null)
  const activeWsRef = useRef<WebSocket | null>(null)
  
  const stateRef = useRef({
    activeRes, data, selectedIndex, editingYaml, filterQuery, showCommandBar, showSearch, selectedNS
  })

  useEffect(() => {
    stateRef.current = { activeRes, data, selectedIndex, editingYaml, filterQuery, showCommandBar, showSearch, selectedNS }
  }, [activeRes, data, selectedIndex, editingYaml, filterQuery, showCommandBar, showSearch, selectedNS])

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))
  }, [])

  const filteredData = useMemo(() => {
    if (!filterQuery) return data;
    const lowerQuery = filterQuery.toLowerCase();
    return data.filter((item: any) => {
      const name = item.metadata?.name?.toLowerCase() || '';
      return name.includes(lowerQuery);
    })
  }, [data, filterQuery])

  useEffect(() => { setSelectedIndex(0) }, [activeRes, selectedNS, filterQuery])

  const watchK8sData = useCallback((clusterId: number, resource: ResourceType, ns: string) => {
    if (resource === 'yaml') return;
    setLoading(true)
    setConnecting(true)
    setData([])
    
    if (activeWsRef.current) activeWsRef.current.close()

    const ws = new WebSocket(buildWsUrl(`/ws/servers/${clusterId}/k8s/watch?resource=${resource}&namespace=${ns}`));
    activeWsRef.current = ws;

    ws.onmessage = (event) => {
        setLoading(false)
        setConnecting(false)
        try {
           const parsed = JSON.parse(event.data);
           if (parsed.error) {
              setPulseError(parsed.details || parsed.stderr || parsed.error)
              setData([])
              return
           }
           setPulseError(null)

           if (resource === 'pulse') {
             if (parsed.kind === 'Pulse') {
               startTransition(() => {
                 setStats(parsed.stats)
               })
             }
           } else {
             startTransition(() => {
               setData(parsed.items || [])
             })
           }
        } catch(e) { console.error("JSON parse error:", e); setData([]); }
    }
    
    ws.onerror = () => { setLoading(false); setConnecting(false); setPulseError('WebSocket connection failed.'); }
    ws.onclose = () => setConnecting(false)
  }, [])

  useEffect(() => {
    watchK8sData(cluster.id, activeRes, selectedNS)
    return () => { if (activeWsRef.current) activeWsRef.current.close() }
  }, [cluster.id, activeRes, selectedNS, watchK8sData])

  const fetchNamespaces = useCallback(async () => {
    try {
      const res = await api.post(`/api/servers/${cluster.id}/kubectl`, { command: 'get namespaces -o json' })
      if (res.data.success) {
        const parsed = JSON.parse(res.data.output)
        setNamespaces((parsed.items || []).map((i: any) => i.metadata.name))
      }
    } catch (e) { console.error("NS Fetch error:", e) }
  }, [cluster.id])

  useEffect(() => { fetchNamespaces() }, [fetchNamespaces])

  const fetchYaml = useCallback(async (kind: string, name: string, ns?: string) => {
    setLoading(true)
    try {
      const nsFlag = ns ? `-n ${ns}` : ""
      const res = await api.post(`/api/servers/${cluster.id}/kubectl`, { command: `get ${kind} ${name} ${nsFlag} -o yaml` })
      if (res.data.success) {
        setEditingYaml({ open: true, content: res.data.output, name, ns, kind })
      } else {
        toast.error('Fetch failed', res.data.error || 'Check cluster connection.')
      }
    } catch (e: any) { 
        toast.error('Network error', e.message)
    } finally { 
        setLoading(false) 
    }
  }, [cluster.id, toast])

  const applyYaml = async () => {
    if (!editingYaml.content) return
    setLoading(true)
    setApplyResult(null)
    try {
      const res = await api.post(`/api/servers/${cluster.id}/kubectl/apply`, { yaml: editingYaml.content })
      setApplyResult({ 
        success: res.data.success, 
        msg: res.data.output || res.data.stderr || res.data.error || (res.data.success ? "Resource applied successfully" : "Application failed") 
      })
    } catch (e: any) { setApplyResult({ success: false, msg: "Network error during apply" }) }
    finally { setLoading(false) }
  }

  const applyYamlRef = useRef(applyYaml)
  useEffect(() => { applyYamlRef.current = applyYaml }, [applyYaml])

  const handleDeleteResource = useCallback(async (item: any) => {
    const kind = item.kind || activeRes.slice(0, -1);
    if (!window.confirm(`Delete ${kind} ${item.metadata.name}?`)) return;
    try {
      await api.delete(`/api/servers/${cluster.id}/kubectl`, {
        data: { kind, name: item.metadata.name, namespace: item.metadata.namespace }
      })
      toast.success('Resource deleted', `Deleted ${item.metadata.name}`)
    } catch (e: any) { toast.error('Delete failed', e.response?.data?.error || 'Failed to delete resource') }
  }, [cluster.id, activeRes, toast])

  const fetchPortForwards = useCallback(async () => {
    if (!canUseKubectl) return
    try {
      const res = await api.get(`/api/servers/${cluster.id}/kubectl/port-forward`)
      setPortForwards(res.data.sessions || [])
    } catch (e: any) { toast.error('Port-forward list failed', e.response?.data?.error || 'Unable to load sessions') }
  }, [cluster.id, canUseKubectl, toast])

  useEffect(() => { if (showPortForward) fetchPortForwards() }, [showPortForward, fetchPortForwards])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { showCommandBar, showSearch, activeRes: curRes, selectedIndex: curIdx, editingYaml: curYaml, selectedNS: curNS } = stateRef.current;
      const target = e.target as HTMLElement;

      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
         e.preventDefault();
         watchK8sData(cluster.id, curRes, curNS);
         return;
      }

      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
         if (e.key === 'Escape') { 
            e.preventDefault();
            if (curYaml.open) setEditingYaml({ open: false, content: '' });
            else { setShowSearch(false); setFilterQuery(''); setShowCommandBar(false); target.blur(); }
            return;
         }
         if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            if (curYaml.open) applyYamlRef.current();
            return;
         }
         if (!curYaml.open) return;
      }
      if (e.key === 'Escape') { 
         if (curYaml.open) setEditingYaml({ open: false, content: '' });
         else { setShowCommandBar(false); setShowSearch(false); setFilterQuery(''); setDrawer(null); }
         return; 
      }
      if (e.key === ':' && !showCommandBar && !showSearch && !curYaml.open) {
        e.preventDefault(); setShowCommandBar(true); setCmdError(false);
        setTimeout(() => cmdInputRef.current?.focus(), 50); return;
      }

      if (curRes !== 'pulse' && curRes !== 'yaml' && curRes !== 'events' && filteredData.length > 0 && !curYaml.open && !drawer?.open) {
         if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(c => Math.min(c + 1, filteredData.length - 1)); }
         else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(c => Math.max(c - 1, 0)); }
         else if (e.key === '/') { e.preventDefault(); setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 50); }
         else if (e.key === '0') { e.preventDefault(); setSelectedNS('All'); }
         else if (e.key === 'e') {
             const item = filteredData[curIdx];
             fetchYaml(item.kind?.toLowerCase() || curRes.slice(0, -1), item.metadata.name, item.metadata.namespace)
         }
         else if (e.key === 'l' && curRes === 'pods') {
             const item = filteredData[curIdx];
             setDrawer({ open: true, mode: 'logs', pod: item.metadata.name, ns: item.metadata.namespace, container: item.spec?.containers?.[0]?.name })
         }
         else if (e.key === 's' && curRes === 'pods' && canUseKubectl) {
             const item = filteredData[curIdx];
             setDrawer({ open: true, mode: 'shell', pod: item.metadata.name, ns: item.metadata.namespace, container: item.spec?.containers?.[0]?.name })
         }
         else if (e.key === 'd') handleDeleteResource(filteredData[curIdx]);
      }
    }
    window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredData, fetchYaml, handleDeleteResource, canUseKubectl, drawer, watchK8sData, cluster.id])

  const handleNameClick = useCallback((item: any) => {
    const kind = item.kind?.toLowerCase() || activeRes.slice(0, -1);
    fetchYaml(kind, item.metadata.name, item.metadata.namespace);
  }, [activeRes, fetchYaml]);

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const input = commandInput.trim().toLowerCase()
    if (input.startsWith('ns ')) {
       const ns = input.split(' ')[1]
       if (ns === 'all') setSelectedNS('All')
       else if (namespaces.includes(ns)) setSelectedNS(ns)
    } else {
       const routes: Record<string, ResourceType> = {
          'p': 'pods', 'po': 'pods', 'pods': 'pods', 'pod': 'pods',
          'n': 'nodes', 'no': 'nodes', 'nodes': 'nodes', 'node': 'nodes',
          'd': 'deployments', 'dp': 'deployments', 'deploy': 'deployments', 'deployments': 'deployments',
          'ds': 'daemonsets', 'sts': 'statefulsets', 'rs': 'replicasets', 'job': 'jobs', 'cj': 'cronjobs',
          'cm': 'configmaps', 'sec': 'secrets', 'rq': 'resourcequotas', 'hpa': 'hpa',
          's': 'services', 'svc': 'services', 'ep': 'endpoints', 'ing': 'ingresses', 'np': 'networkpolicies',
          'pvc': 'pvcs', 'pv': 'pvs', 'sc': 'storageclasses', 'sa': 'serviceaccounts', 'role': 'roles', 'crole': 'clusterroles',
          'rb': 'rolebindings', 'crb': 'clusterrolebindings', 'e': 'events', 'ev': 'events', 'pulse': 'pulse', 'y': 'yaml'
        }
       if (routes[input]) { setActiveRes(routes[input]); setCmdError(false); }
       else { setCmdError(true); setTimeout(() => setCmdError(false), 800); return; }
    }
    setShowCommandBar(false); setCommandInput('');
  }

  return (
    <div className="page" style={{ padding: 0, flexDirection: 'row', overflow: 'hidden', maxWidth: 'none', margin: 0 }}>
      {/* Sidebar */}
      <div style={{ width: 240, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflowX: 'hidden' }}>
        <div style={{ height: 60, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', boxSizing: 'border-box' }}>
           <button className="btn-icon" onClick={onBack} style={{ padding: 4 }}>
             <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
           </button>
           <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-primary)', color: 'var(--text-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 10 }}>
                {cluster.os === 'darwin' ? <AppleIcon size={18} color="var(--text-inverse)" /> :
                 cluster.os === 'windows'? <WindowsIcon size={16} color="var(--text-inverse)" /> :
                 cluster.os === 'linux'  ? <LinuxIcon size={16} color="var(--text-inverse)" /> :
                 <KubernetesIcon size={20} />}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{cluster.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Cluster Explorer</span>
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
            <ResNavLink active={activeRes === 'services'} onClick={() => setActiveRes('services')} icon={Layers} label="Services" isSub />
            <ResNavLink active={activeRes === 'endpoints'} onClick={() => setActiveRes('endpoints')} icon={Activity} label="Endpoints" isSub />
            <ResNavLink active={activeRes === 'ingresses'} onClick={() => setActiveRes('ingresses')} icon={Globe} label="Ingresses" isSub />
            <ResNavLink active={activeRes === 'networkpolicies'} onClick={() => setActiveRes('networkpolicies')} icon={Shield} label="NetworkPolicies" isSub />
          </NavCategory>
          <NavCategory label="Storage" icon={Database} isOpen={expandedCats.storage} onToggle={() => toggleCategory('storage')}>
            <ResNavLink active={activeRes === 'pvcs'} onClick={() => setActiveRes('pvcs')} icon={Database} label="PersistentVolumeClaims" isSub />
            <ResNavLink active={activeRes === 'pvs'} onClick={() => setActiveRes('pvs')} icon={Layers} label="PersistentVolumes" isSub />
            <ResNavLink active={activeRes === 'storageclasses'} onClick={() => setActiveRes('storageclasses')} icon={Cpu} label="StorageClasses" isSub />
          </NavCategory>
          <NavCategory label="Access Control" icon={Shield} isOpen={expandedCats.rbac} onToggle={() => toggleCategory('rbac')}>
            <ResNavLink active={activeRes === 'serviceaccounts'} onClick={() => setActiveRes('serviceaccounts')} icon={Lock} label="ServiceAccounts" isSub />
            <ResNavLink active={activeRes === 'roles'} onClick={() => setActiveRes('roles')} icon={Shield} label="Roles" isSub />
            <ResNavLink active={activeRes === 'clusterroles'} onClick={() => setActiveRes('clusterroles')} icon={Shield} label="ClusterRoles" isSub />
            <ResNavLink active={activeRes === 'rolebindings'} onClick={() => setActiveRes('rolebindings')} icon={Key} label="RoleBindings" isSub />
            <ResNavLink active={activeRes === 'clusterrolebindings'} onClick={() => setActiveRes('clusterrolebindings')} icon={Key} label="ClusterRoleBindings" isSub />
          </NavCategory>
          {/* Add more categories as needed or truncated for brevity */}
          <div style={{ marginTop: 12 }}>
            <ResNavLink active={activeRes === 'yaml'} onClick={() => setActiveRes('yaml')} icon={FileCode} label="Raw Configuration" />
          </div>
        </nav>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
        <header style={{ height: 60, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 0 24px' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="badge badge-online">REAL-TIME</div>
              <h2 style={{ fontSize: 16, fontWeight: 700, textTransform: 'capitalize' }}>{activeRes} Explorer</h2>
              {loading && <RefreshCw size={14} className="spin" color="var(--brand-primary)" />}
           </div>
           
           <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--brand-glow)', padding: '4px 12px', borderRadius: 8, border: '1px solid var(--brand-primary)20' }}>
                 <Globe size={14} color="var(--brand-primary)" />
                 <select 
                   style={{ background: 'transparent', border: 'none', fontSize: 13, fontWeight: 700, color: 'var(--brand-primary)', cursor: 'pointer', outline: 'none' }}
                   value={selectedNS} onChange={e => setSelectedNS(e.target.value)}
                 >
                    <option value="All">All Namespaces</option>
                    {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                 </select>
              </div>
              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} 
                      disabled={activeRes === 'yaml'} onClick={() => watchK8sData(cluster.id, activeRes, selectedNS)}>
                <RefreshCw size={12} style={{ marginRight: 6 }} className={loading ? 'spin' : ''} /> Resync
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowMCPTerminal(t => !t)}
                title="Open kubectl terminal (MCP)"
                style={{
                  padding: '6px 14px', fontSize: 12, gap: 6,
                  display: 'flex', alignItems: 'center',
                  background: showMCPTerminal ? 'var(--brand-gradient)' : undefined,
                  color: showMCPTerminal ? '#fff' : undefined,
                  border: showMCPTerminal ? 'none' : undefined,
                }}
              >
                <Terminal size={13} />
                kubectl
              </button>
           </div>
        </header>

         <main style={{ flex: 1, overflowY: 'auto', padding: 24, position: 'relative' }}>
          {(showSearch || showCommandBar) && (
            <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)', padding: '12px 16px', border: cmdError ? '1px solid var(--error)' : '1px solid var(--border-bright)', borderRadius: 12, marginBottom: 16, display: 'flex', alignItems: 'center', boxShadow: 'var(--shadow-md)' }}>
              <span style={{ color: 'var(--brand-primary)', fontWeight: 800, marginRight: 12 }}>{showSearch ? '/' : ':'}</span>
              <form onSubmit={handleCommandSubmit} style={{ flex: 1, margin: 0 }}>
                <input ref={showSearch ? searchInputRef : cmdInputRef}
                       value={showSearch ? filterQuery : commandInput}
                       onChange={e => showSearch ? setFilterQuery(e.target.value) : setCommandInput(e.target.value)}
                       style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: '100%' }}
                       placeholder={showSearch ? "Fuzzy search resources..." : "resource type or ns command..."} />
              </form>
              <button className="btn-icon" onClick={() => { setShowSearch(false); setShowCommandBar(false); }}><X size={14}/></button>
            </div>
          )}

          {activeRes === 'pulse' && <PulseDashboard cluster={cluster} stats={stats} namespace={selectedNS} error={pulseError} connecting={connecting} onJump={(r) => setActiveRes(r)} onResync={() => watchK8sData(cluster.id, activeRes, selectedNS)} />}
          
          {activeRes === 'nodes' && <KTable columns={['Name', 'Status', 'Role', 'Version', 'Internal-IP']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(n: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('node', n.metadata.name)}><FileCode size={14} /></button>} 
          />}

          {activeRes === 'pods' && <KTable columns={['Name', 'Namespace', 'Restarts', 'Status']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={ (p: any) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('pod', p.metadata.name, p.metadata.namespace)}><FileCode size={14} /></button>
                  <button className="btn-icon" title="Logs" onClick={() => setDrawer({ open: true, mode: 'logs', pod: p.metadata.name, ns: p.metadata.namespace, container: p.spec?.containers?.[0]?.name })}><List size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Shell" onClick={() => setDrawer({ open: true, mode: 'shell', pod: p.metadata.name, ns: p.metadata.namespace, container: p.spec?.containers?.[0]?.name })}><Terminal size={14} /></button>}
                </>
             )}
          />}

          {['deployments', 'daemonsets', 'statefulsets', 'replicasets', 'jobs', 'cronjobs'].includes(activeRes) && 
            <KTable columns={['Name', 'Namespace', 'Ready', 'Available', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
              actions={(d: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(d.kind?.toLowerCase() || activeRes.slice(0, -1), d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>}
            />}

          {activeRes === 'configmaps' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(c: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('configmap', c.metadata.name, c.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'secrets' && <KTable columns={['Name', 'Namespace', 'Type', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('secret', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'resourcequotas' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('resourcequota', r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'hpa' && <KTable columns={['Name', 'Namespace', 'Targets', 'MinPods', 'MaxPods', 'Replicas', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(h: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('hpa', h.metadata.name, h.metadata.namespace)}><FileCode size={14} /></button>}
          />}

          {activeRes === 'services' && <KTable columns={['Name', 'Namespace', 'Type', 'Cluster-IP', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('service', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'endpoints' && <KTable columns={['Name', 'Namespace', 'Endpoints', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(e: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('endpoints', e.metadata.name, e.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'ingresses' && <KTable columns={['Name', 'Namespace', 'Hosts', 'Address', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(i: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('ingress', i.metadata.name, i.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'networkpolicies' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(n: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('networkpolicy', n.metadata.name, n.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          
          {activeRes === 'pvcs' && <KTable columns={['Name', 'Namespace', 'Status', 'Volume', 'Capacity', 'AccessModes', 'StorageClass', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(p: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('persistentvolumeclaim', p.metadata.name, p.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'pvs' && <KTable columns={['Name', 'Capacity', 'AccessModes', 'ReclaimPolicy', 'Status', 'Claim', 'StorageClass', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(p: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('persistentvolume', p.metadata.name)}><FileCode size={14} /></button>}
          />}
          {activeRes === 'storageclasses' && <KTable columns={['Name', 'Provisioner', 'ReclaimPolicy', 'VolumeBindingMode', 'AllowVolumeExpansion', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('storageclass', s.metadata.name)}><FileCode size={14} /></button>}
          />}

          {activeRes === 'serviceaccounts' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('serviceaccount', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {['roles', 'clusterroles'].includes(activeRes) && <KTable columns={['Name', activeRes === 'roles' ? 'Namespace' : '', 'Age'].filter(Boolean)} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(activeRes.slice(0, -1), r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>}
          />}
          {['rolebindings', 'clusterrolebindings'].includes(activeRes) && <KTable columns={['Name', activeRes === 'rolebindings' ? 'Namespace' : '', 'Role', 'Age'].filter(Boolean)} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: any) => <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(activeRes.slice(0, -1), r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>}
          />}

          {activeRes === 'events' && <KTable columns={['Type', 'Reason', 'Object', 'Message', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} />}

          {activeRes === 'yaml' && (
            <div style={{ height: 'calc(100vh - 160px)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <ConfigViewer 
                content={cluster.kube_config || ''} 
                onChange={() => {}} 
                fullPage
              />
            </div>
          )}
        </main>
      </div>

      {showPortForward && canUseKubectl && <PortForwardModal serverID={cluster.id} sessions={portForwards} onClose={() => setShowPortForward(false)} onRefresh={fetchPortForwards} />}
      {drawer?.open && canUseKubectl && <TerminalPortal serverID={cluster.id} pod={drawer.pod!} namespace={drawer.ns!} container={drawer.container} mode={drawer.mode} onClose={() => setDrawer(null)} />}
      {showMCPTerminal && <MCPTerminal clusterId={cluster.id} clusterName={cluster.name} onClose={() => setShowMCPTerminal(false)} />}
      
      {editingYaml.open && (
        <div className="fade-in" style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: 'var(--bg-app)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 64, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{editingYaml.kind?.toUpperCase()}: {editingYaml.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{editingYaml.ns || 'cluster-scoped'} • CMD+S TO APPLY</span>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <button className="btn btn-secondary" onClick={() => setEditingYaml({ open: false, content: '' })}>Cancel</button>
              <button className="btn btn-primary" onClick={applyYaml} disabled={loading}>{loading ? 'Applying...' : 'Save & Apply'}</button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ConfigViewer content={editingYaml.content} onChange={(val: string) => setEditingYaml(c => ({ ...c, content: val }))} fullPage />
            </div>
            
            {applyResult && (
              <div className="fade-up" style={{ height: 180, background: '#0f172a', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                 <div style={{ height: 32, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: applyResult.success ? '#064e3b' : '#7f1d1d' }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {applyResult.success ? '✓ Apply Success' : '✕ Apply Failed'}
                    </span>
                    <button className="btn-icon" onClick={() => setApplyResult(null)} style={{ color: '#fff', padding: 4 }}><X size={14}/></button>
                 </div>
                 <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
                    <pre style={{ margin: 0, fontSize: 12, color: applyResult.success ? '#10b981' : '#f87171', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                       {applyResult.msg}
                    </pre>
                 </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

K8sResourceExplorer.displayName = 'K8sResourceExplorer'
