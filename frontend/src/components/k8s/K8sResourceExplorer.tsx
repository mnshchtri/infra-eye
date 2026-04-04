import { memo, useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react'
import { 
  LayoutGrid, Server, 
  RefreshCw, FileCode,
  Boxes, ChevronRight, ChevronLeft, Activity,
  Globe, X, Terminal,
  List,
  Shield, Key, Lock,
  Database, Gauge, Cpu, Layers
} from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../OSIcons'
import { api, buildWsUrl } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { useUIStore } from '../../store/uiStore'
import logo from '../../assets/logo.png'
import { KTable } from './KTable'
import { ResNavLink, NavCategory } from './K8sSidebar'
import { PulseDashboard } from './PulseDashboard'
import { ConfigViewer } from './ConfigViewer'
import { PortForwardModal } from './PortForwardModal'
import { TerminalPortal } from './TerminalPortal'
import { MCPTerminal } from './MCPTerminal'
import logo from '../../assets/logo.png'

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
  const { darkMode } = useUIStore()
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768)
  
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

  const [rawConfig, setRawConfig] = useState(cluster.kube_config || '')
  const [savingRaw, setSavingRaw] = useState(false)

  const saveClusterConfig = async () => {
    if (!rawConfig) return
    setSavingRaw(true)
    try {
      const res = await api.put(`/api/servers/${cluster.id}`, { 
        ...cluster,
        kube_config: rawConfig 
      })
      if (res.status === 200) {
        toast.success('Configuration saved', 'Cluster KubeConfig updated successfully.')
      } else {
        toast.error('Save failed', 'Status: ' + res.status)
      }
    } catch (e: any) {
      toast.error('Save failed', e.response?.data?.error || e.message)
    } finally {
      setSavingRaw(false)
    }
  }

  return (
    <div className={`k8s-explorer-container ${!isSidebarOpen ? 'sidebar-hidden' : ''}`} style={{ display: 'flex', height: '100%', background: 'var(--bg-app)', position: 'relative', flex: 1, minWidth: 0 }}>
      
      {/* Sidebar Overlay for Mobile */}
      <div 
        className={`k8s-sidebar-overlay ${isSidebarOpen ? 'mobile-open' : ''}`} 
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar */}
      <div className={`k8s-resource-sidebar ${!isSidebarOpen ? 'collapsed' : ''}`} style={{ 
        width: 240, 
        background: 'var(--bg-sidebar)', 
        borderRight: '1px solid var(--border)', 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%', 
        overflowX: 'hidden',
        transition: 'all 0.3s ease',
        zIndex: 500
      }}>
        <div style={{ 
          height: 60, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 16, 
          borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)', 
          flexShrink: 0 
        }}>
           <button 
             className="btn-icon" 
             onClick={onBack} 
             style={{ 
               width: 32, height: 32, borderRadius: 0, border: '1px solid var(--border)', 
               background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', 
               justifyContent: 'center', cursor: 'pointer' 
             }}
           >
             <ChevronLeft size={14} color="var(--text-muted)" />
           </button>
           
           <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
             <img src={logo} alt="L" style={{ height: 28, width: 'auto', objectFit: 'contain', filter: darkMode ? 'brightness(0) invert(1)' : 'none' }} />
             <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ 
                  fontWeight: 900, fontSize: 11, color: 'var(--text-primary)', 
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', 
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.02em' 
                }}>
                  {cluster.name}
                </span>
                <span style={{ 
                  fontSize: 8, color: 'var(--text-muted)', fontWeight: 900, 
                  textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' 
                }}>
                  Cluster Node
                </span>
              </div>
           </div>
           
           {/* Mobile Sidebar Close */}
           <button className="show-mobile-only btn-icon" onClick={() => setIsSidebarOpen(false)} style={{ borderRadius: 0, border: '1px solid var(--border)' }}>
              <X size={14} />
           </button>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }} className="k8s-sidebar-nav">
          <ResNavLink 
            active={activeRes === 'pulse'} 
            onClick={() => { setActiveRes('pulse'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
            icon={Activity} label="Pulse Dashboard" 
          />
          <NavCategory label="Cluster" icon={Gauge} isOpen={expandedCats.cluster} onToggle={() => toggleCategory('cluster')}>
            <ResNavLink 
              active={activeRes === 'nodes'} 
              onClick={() => { setActiveRes('nodes'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Server} label="Nodes" isSub 
            />
            <ResNavLink 
              active={activeRes === 'events'} 
              onClick={() => { setActiveRes('events'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={List} label="Events" isSub 
            />
          </NavCategory>
          <NavCategory label="Workloads" icon={Layers} isOpen={expandedCats.workloads} onToggle={() => toggleCategory('workloads')}>
            <ResNavLink 
              active={activeRes === 'pods'} 
              onClick={() => { setActiveRes('pods'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Boxes} label="Pods" isSub 
            />
            <ResNavLink 
              active={activeRes === 'deployments'} 
              onClick={() => { setActiveRes('deployments'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={LayoutGrid} label="Deployments" isSub 
            />
            <ResNavLink 
              active={activeRes === 'daemonsets'} 
              onClick={() => { setActiveRes('daemonsets'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Cpu} label="DaemonSets" isSub 
            />
            <ResNavLink 
              active={activeRes === 'statefulsets'} 
              onClick={() => { setActiveRes('statefulsets'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Database} label="StatefulSets" isSub 
            />
            <ResNavLink 
              active={activeRes === 'replicasets'} 
              onClick={() => { setActiveRes('replicasets'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Layers} label="ReplicaSets" isSub 
            />
            <ResNavLink 
              active={activeRes === 'jobs'} 
              onClick={() => { setActiveRes('jobs'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Activity} label="Jobs" isSub 
            />
            <ResNavLink 
              active={activeRes === 'cronjobs'} 
              onClick={() => { setActiveRes('cronjobs'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Activity} label="CronJobs" isSub 
            />
          </NavCategory>
          <NavCategory label="Config" icon={Lock} isOpen={expandedCats.config} onToggle={() => toggleCategory('config')}>
            <ResNavLink 
              active={activeRes === 'configmaps'} 
              onClick={() => { setActiveRes('configmaps'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={FileCode} label="ConfigMaps" isSub 
            />
            <ResNavLink 
              active={activeRes === 'secrets'} 
              onClick={() => { setActiveRes('secrets'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Key} label="Secrets" isSub 
            />
            <ResNavLink 
              active={activeRes === 'resourcequotas'} 
              onClick={() => { setActiveRes('resourcequotas'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Shield} label="ResourceQuotas" isSub 
            />
            <ResNavLink 
              active={activeRes === 'hpa'} 
              onClick={() => { setActiveRes('hpa'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Activity} label="HPA" isSub 
            />
          </NavCategory>
          <NavCategory label="Network" icon={Globe} isOpen={expandedCats.network} onToggle={() => toggleCategory('network')}>
            <ResNavLink 
              active={activeRes === 'services'} 
              onClick={() => { setActiveRes('services'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Layers} label="Services" isSub 
            />
            <ResNavLink 
              active={activeRes === 'endpoints'} 
              onClick={() => { setActiveRes('endpoints'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Activity} label="Endpoints" isSub 
            />
            <ResNavLink 
              active={activeRes === 'ingresses'} 
              onClick={() => { setActiveRes('ingresses'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Globe} label="Ingresses" isSub 
            />
            <ResNavLink 
              active={activeRes === 'networkpolicies'} 
              onClick={() => { setActiveRes('networkpolicies'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Shield} label="NetworkPolicies" isSub 
            />
          </NavCategory>
          <NavCategory label="Storage" icon={Database} isOpen={expandedCats.storage} onToggle={() => toggleCategory('storage')}>
            <ResNavLink 
              active={activeRes === 'pvcs'} 
              onClick={() => { setActiveRes('pvcs'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Database} label="PersistentVolumeClaims" isSub 
            />
            <ResNavLink 
              active={activeRes === 'pvs'} 
              onClick={() => { setActiveRes('pvs'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Layers} label="PersistentVolumes" isSub 
            />
            <ResNavLink 
              active={activeRes === 'storageclasses'} 
              onClick={() => { setActiveRes('storageclasses'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Cpu} label="StorageClasses" isSub 
            />
          </NavCategory>
          <NavCategory label="Access Control" icon={Shield} isOpen={expandedCats.rbac} onToggle={() => toggleCategory('rbac')}>
            <ResNavLink 
              active={activeRes === 'serviceaccounts'} 
              onClick={() => { setActiveRes('serviceaccounts'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Lock} label="ServiceAccounts" isSub 
            />
            <ResNavLink 
              active={activeRes === 'roles'} 
              onClick={() => { setActiveRes('roles'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Shield} label="Roles" isSub 
            />
            <ResNavLink 
              active={activeRes === 'clusterroles'} 
              onClick={() => { setActiveRes('clusterroles'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Shield} label="ClusterRoles" isSub 
            />
            <ResNavLink 
              active={activeRes === 'rolebindings'} 
              onClick={() => { setActiveRes('rolebindings'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Key} label="RoleBindings" isSub 
            />
            <ResNavLink 
              active={activeRes === 'clusterrolebindings'} 
              onClick={() => { setActiveRes('clusterrolebindings'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Key} label="ClusterRoleBindings" isSub 
            />
          </NavCategory>
          <div style={{ marginTop: 12 }}>
            <ResNavLink 
              active={activeRes === 'yaml'} 
              onClick={() => { setActiveRes('yaml'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={FileCode} label="Raw Configuration" 
            />
          </div>
        </nav>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)', minWidth: 0 }}>
        <header style={{ height: 60, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, zIndex: 10 }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
               <button 
                className="show-mobile-only btn-icon" 
                onClick={() => setIsSidebarOpen(true)}
                style={{ padding: 8, background: 'var(--bg-elevated)', borderRadius: 0, border: '1px solid var(--border)' }}
              >
                <LayoutGrid size={16} color="var(--brand-primary)" />
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  display: 'flex', alignItems: 'center', gap: 6, 
                  background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)20', 
                  padding: '4px 10px', borderRadius: 0 
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', boxShadow: '0 0 8px var(--brand-primary)' }} />
                  <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--brand-primary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-mono)' }}>Real-Time Stream</span>
                </div>
                <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
                <h2 style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {activeRes === 'yaml' ? 'KubeConfig' : activeRes} <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>PROTOCOLS</span>
                </h2>
                {loading && <RefreshCw size={12} className="spin" color="var(--brand-primary)" style={{ marginLeft: 4 }} />}
              </div>
           </div>
           
           <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {activeRes !== 'yaml' && (
                <div className="namespace-selector hidden-mobile" style={{ 
                  display: 'flex', alignItems: 'center', gap: 10, 
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', 
                  padding: '6px 14px', borderRadius: 0 
                }}>
                  <Globe size={13} color="var(--brand-primary)" />
                  <select 
                    style={{ background: 'transparent', border: 'none', fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', cursor: 'pointer', outline: 'none', fontFamily: 'var(--font-mono)', paddingRight: 4 }}
                    value={selectedNS} onChange={e => setSelectedNS(e.target.value)}
                  >
                      <option value="All">CLUSTER_SCOPE</option>
                      {namespaces.map(ns => <option key={ns} value={ns}>{ns.toUpperCase()}</option>)}
                  </select>
                </div>
              )}
              
              <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} className="hidden-mobile" />

              {activeRes === 'yaml' && (
                <button 
                  className="btn btn-primary" 
                  onClick={saveClusterConfig}
                  disabled={savingRaw}
                  style={{ height: 36, padding: '0 20px', borderRadius: 0, fontWeight: 900, fontSize: 11, letterSpacing: '0.05em' }}
                >
                  {savingRaw ? 'SYNCHRONIZING...' : 'COMMIT_CHANGES'}
                </button>
              )}
              
              <button
                className="btn btn-secondary"
                onClick={() => setShowMCPTerminal(t => !t)}
                style={{
                  height: 36, padding: '0 16px', borderRadius: 0,
                  gap: 8,
                  display: 'flex', alignItems: 'center',
                  background: showMCPTerminal ? 'var(--brand-gradient)' : 'var(--bg-elevated)',
                  color: showMCPTerminal ? '#fff' : 'var(--text-primary)',
                  border: showMCPTerminal ? 'none' : '1px solid var(--border)',
                  fontWeight: 900, fontSize: 11, letterSpacing: '0.05em'
                }}
              >
                <Terminal size={14} />
                <span className="hidden-mobile">KUBECTL_SHELL</span>
              </button>
           </div>
        </header>

         <main style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', position: 'relative' }}>
          {(showSearch || showCommandBar) && (
            <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)', padding: '12px 16px', border: cmdError ? '1px solid var(--danger)' : '1px solid var(--border-bright)', borderRadius: 12, marginBottom: 16, display: 'flex', alignItems: 'center', boxShadow: 'var(--shadow-md)' }}>
              <span style={{ color: 'var(--brand-primary)', fontWeight: 800, marginRight: 12 }}>{showSearch ? '/' : ':'}</span>
              <form onSubmit={handleCommandSubmit} style={{ flex: 1, margin: 0 }}>
                <input ref={showSearch ? searchInputRef : cmdInputRef}
                       value={showSearch ? filterQuery : commandInput}
                       onChange={e => showSearch ? setFilterQuery(e.target.value) : setCommandInput(e.target.value)}
                       style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: '100%' }}
                       autoFocus
                       placeholder={showSearch ? "Fuzzy search..." : "resource type..."} />
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
                content={rawConfig} 
                onChange={(val) => setRawConfig(val)} 
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
