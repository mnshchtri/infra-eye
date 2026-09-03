import { memo, useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react'
import {
  LayoutGrid, Server,
  RefreshCw, FileCode,
  Boxes, ChevronLeft, Activity,
  Globe, X, Terminal,
  List,
  Shield, Key, Lock,
  Database, Gauge, Cpu, Layers,
  Hash, RotateCw, Expand, Route, Waypoints, Network, Puzzle, Plus, Trash2, KeyRound
} from 'lucide-react'
import { KubernetesIcon } from '../OSIcons'
import { api, buildWsUrl } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { KTable } from './KTable'
import { ResNavLink, NavCategory } from './K8sSidebar'
import { PulseDashboard } from './PulseDashboard'
import type { PulseStats } from './PulseDashboard'
import { ConfigViewer } from './ConfigViewer'
import { PortForwardModal } from './PortForwardModal'
import type { PortForwardSession } from './PortForwardModal'
import { ReadOnlyKubeconfigModal } from './ReadOnlyKubeconfigModal'
import { TerminalPortal } from './TerminalPortal'
import { MCPTerminal } from './MCPTerminal'
import { apiError, errMessage } from '../../utils/errors'
import type { K8sRow } from '../../types/k8s'

interface Cluster {
  id: number;
  name: string;
  host: string;
  os?: string;
  has_kubeconfig?: boolean;
}

export type ResourceType =
  | 'pulse' | 'nodes' | 'namespaces' | 'crds' | 'pods' | 'deployments' | 'daemonsets' | 'statefulsets' | 'replicasets' | 'jobs' | 'cronjobs'
  | 'configmaps' | 'secrets' | 'resourcequotas' | 'hpa' | 'poddisruptionbudgets'
  | 'services' | 'endpoints' | 'ingresses' | 'networkpolicies'
  | 'gatewayclasses' | 'gateways' | 'httproutes' | 'grpcroutes' | 'referencegrants'
  | 'pvcs' | 'pvs' | 'storageclasses'
  | 'serviceaccounts' | 'roles' | 'clusterroles' | 'rolebindings' | 'clusterrolebindings'
  | 'events' | 'yaml';

interface K8sResourceExplorerProps {
  cluster: Cluster;
  onBack: () => void;
  canUseKubectl: boolean;
}

// Lens-style creation templates: starting points the user edits before applying.
const K8S_TEMPLATES: Record<string, string> = {
  Pod: `apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  namespace: default
  labels:
    app: my-pod
spec:
  containers:
    - name: app
      image: nginx:latest
      ports:
        - containerPort: 80
`,
  Deployment: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deployment
  namespace: default
  labels:
    app: my-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: nginx:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
`,
  Service: `apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: default
spec:
  type: ClusterIP
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
      protocol: TCP
`,
  ConfigMap: `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  namespace: default
data:
  KEY: value
`,
  Secret: `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: default
type: Opaque
stringData:
  password: changeme
`,
  Ingress: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: default
spec:
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-service
                port:
                  number: 80
`,
  PersistentVolumeClaim: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`,
  Job: `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: default
spec:
  template:
    spec:
      containers:
        - name: job
          image: busybox:latest
          command: ["sh", "-c", "echo hello"]
      restartPolicy: Never
  backoffLimit: 3
`,
  CronJob: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
  namespace: default
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: job
              image: busybox:latest
              command: ["sh", "-c", "echo hello"]
          restartPolicy: OnFailure
`,
  Namespace: `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
`,
  NetworkPolicy: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-networkpolicy
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 80
`,
  Gateway: `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: my-gateway
  namespace: default
spec:
  gatewayClassName: my-gateway-class
  listeners:
    - name: http
      protocol: HTTP
      port: 80
`,
  HTTPRoute: `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
  namespace: default
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: my-service
          port: 80
`,
}

// Human-readable titles for each resource view (UI chrome — sans-serif titles).
const RESOURCE_LABELS: Record<string, string> = {
  pulse: 'Pulse Dashboard',
  nodes: 'Nodes',
  namespaces: 'Namespaces',
  crds: 'Custom Resource Definitions',
  pods: 'Pods',
  deployments: 'Deployments',
  daemonsets: 'DaemonSets',
  statefulsets: 'StatefulSets',
  replicasets: 'ReplicaSets',
  jobs: 'Jobs',
  cronjobs: 'CronJobs',
  configmaps: 'ConfigMaps',
  secrets: 'Secrets',
  resourcequotas: 'ResourceQuotas',
  hpa: 'Autoscalers',
  poddisruptionbudgets: 'Pod Disruption Budgets',
  services: 'Services',
  endpoints: 'Endpoints',
  ingresses: 'Ingresses',
  networkpolicies: 'NetworkPolicies',
  gatewayclasses: 'GatewayClasses',
  gateways: 'Gateways',
  httproutes: 'HTTPRoutes',
  grpcroutes: 'GRPCRoutes',
  referencegrants: 'ReferenceGrants',
  pvcs: 'PersistentVolumeClaims',
  pvs: 'PersistentVolumes',
  storageclasses: 'StorageClasses',
  serviceaccounts: 'ServiceAccounts',
  roles: 'Roles',
  clusterroles: 'ClusterRoles',
  rolebindings: 'RoleBindings',
  clusterrolebindings: 'ClusterRoleBindings',
  events: 'Events',
  yaml: 'KubeConfig'
}
export const K8sResourceExplorer = memo(({ cluster, onBack, canUseKubectl }: K8sResourceExplorerProps) => {
  const [activeRes, setActiveRes] = useState<ResourceType>('pulse')
  const [data, setData] = useState<K8sRow[]>([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [pulsePartial, setPulsePartial] = useState<Record<string, string> | null>(null)
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNS, setSelectedNS] = useState<string>('All')
  const [stats, setStats] = useState<PulseStats | null>(null)
  const [pulseError, setPulseError] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [showCommandBar, setShowCommandBar] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [cmdError, setCmdError] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editingYaml, setEditingYaml] = useState<{ open: boolean; content: string; name?: string; ns?: string; kind?: string; isNew?: boolean }>({ open: false, content: '' })
  const [createKind, setCreateKind] = useState('Deployment')
  const [drawer, setDrawer] = useState<{ open: boolean; mode: 'logs' | 'shell'; target?: 'pod' | 'node'; pod?: string; ns?: string; container?: string; node?: string } | null>(null)
  const [showPortForward, setShowPortForward] = useState(false)
  const [pfTarget, setPfTarget] = useState<{ ns?: string; target?: string; port?: string; suggestedLocal?: string }>({})
  const [portForwards, setPortForwards] = useState<PortForwardSession[]>([])
  const [selectedPods, setSelectedPods] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // A Service's first exposed port, if it declares one. Narrowed here because
  // K8sObject.spec is intentionally untyped — the explorer is generic over
  // every kind, and only this call site needs the Service shape.
  const servicePort = (s: K8sRow): string | undefined => {
    const ports = (s.spec as { ports?: { port?: number }[] } | undefined)?.ports
    return ports?.[0]?.port?.toString()
  }

  const openPortForward = (ns: string, target: string, port?: string) => {
    const suggestedLocal = Math.floor(Math.random() * (9999 - 8000 + 1) + 8000).toString();
    setPfTarget({ ns, target, port, suggestedLocal });
    setShowPortForward(true);
  }
  const [applyResult, setApplyResult] = useState<{ success: boolean; msg: string } | null>(null)
  const [showMCPTerminal, setShowMCPTerminal] = useState(false)
  const [showReadOnlyKubeconfig, setShowReadOnlyKubeconfig] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768)
  
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({
    cluster: true,
    workloads: true,
    config: false,
    network: false,
    gateway: false,
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

  const goTo = useCallback((r: ResourceType) => () => {
    setActiveRes(r)
    if (window.innerWidth <= 768) setIsSidebarOpen(false)
  }, [])

  const filteredData = useMemo(() => {
    if (!filterQuery) return data;
    const lowerQuery = filterQuery.toLowerCase();
    return data.filter((item: K8sRow) => {
      const name = item.metadata?.name?.toLowerCase() || '';
      return name.includes(lowerQuery);
    })
  }, [data, filterQuery])

  useEffect(() => { setSelectedIndex(0) }, [activeRes, selectedNS, filterQuery])
  useEffect(() => { setSelectedPods(new Set()) }, [activeRes, selectedNS])

  const podKey = useCallback((item: K8sRow) => `${item.metadata.namespace}/${item.metadata.name}`, [])

  const toggleSelectPod = useCallback((item: K8sRow) => {
    const key = podKey(item)
    setSelectedPods(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [podKey])

  const toggleSelectAllPods = useCallback(() => {
    setSelectedPods(prev => {
      if (prev.size === filteredData.length && filteredData.length > 0) return new Set()
      return new Set(filteredData.map(podKey))
    })
  }, [filteredData, podKey])

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
              setPulsePartial(null)
              setData([])
              return
           }
           setPulseError(null)
           // The cluster answered, but individual lookups inside the frame may
           // still have failed; those counts are zero for the wrong reason.
           const partial = parsed.errors && Object.keys(parsed.errors).length ? parsed.errors : null
           setPulsePartial(partial)

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
    
    ws.onerror = () => { setLoading(false); setConnecting(false); setPulsePartial(null); setPulseError('WebSocket connection failed.'); }
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
        setNamespaces((parsed.items || []).map((i: K8sRow) => i.metadata.name))
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
    } catch (e: unknown) { 
        toast.error('Network error', errMessage(e))
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
    } catch { setApplyResult({ success: false, msg: "Network error during apply" }) }
    finally { setLoading(false) }
  }

  const applyYamlRef = useRef(applyYaml)
  useEffect(() => { applyYamlRef.current = applyYaml }, [applyYaml])

  const openCreateResource = useCallback((kind?: string) => {
    const k = kind || 'Deployment'
    setCreateKind(k)
    setApplyResult(null)
    setEditingYaml({ open: true, content: K8S_TEMPLATES[k], isNew: true })
  }, [])

  const switchCreateTemplate = (kind: string) => {
    setCreateKind(kind)
    setEditingYaml(c => ({ ...c, content: K8S_TEMPLATES[kind] }))
  }

  const handleDeleteResource = useCallback(async (item: K8sRow) => {
    const kind = item.kind || activeRes.slice(0, -1);
    if (!window.confirm(`Delete ${kind} ${item.metadata.name}?`)) return;
    try {
      await api.delete(`/api/servers/${cluster.id}/kubectl`, {
        data: { kind, name: item.metadata.name, namespace: item.metadata.namespace }
      })
      toast.success('Resource deleted', `Deleted ${item.metadata.name}`)
    } catch (e: unknown) { toast.error('Delete failed', apiError(e) || 'Failed to delete resource') }
  }, [cluster.id, activeRes, toast])

  const handleBulkDeletePods = useCallback(async () => {
    const targets = filteredData.filter(item => selectedPods.has(podKey(item)))
    if (targets.length === 0) return
    if (!window.confirm(`Delete ${targets.length} selected pod${targets.length === 1 ? '' : 's'}?`)) return

    setBulkDeleting(true)
    const results = await Promise.allSettled(targets.map(item =>
      api.delete(`/api/servers/${cluster.id}/kubectl`, {
        data: { kind: 'pod', name: item.metadata.name, namespace: item.metadata.namespace }
      })
    ))
    setBulkDeleting(false)

    const failed = results.filter(r => r.status === 'rejected').length
    const succeeded = results.length - failed
    if (succeeded > 0) toast.success('Pods deleted', `Deleted ${succeeded} of ${targets.length} selected pod${targets.length === 1 ? '' : 's'}`)
    if (failed > 0) toast.error('Some deletions failed', `${failed} of ${targets.length} pod deletions failed`)
    setSelectedPods(new Set())
  }, [filteredData, selectedPods, podKey, cluster.id, toast])

  const singularKind: Record<string, string> = {
    deployments: 'deployment', daemonsets: 'daemonset', statefulsets: 'statefulset', replicasets: 'replicaset'
  }

  const rolloutRestart = useCallback(async (item: K8sRow) => {
    const kind = singularKind[stateRef.current.activeRes] || 'deployment'
    const ns = item.metadata.namespace ? `-n ${item.metadata.namespace}` : ''
    try {
      const res = await api.post(`/api/servers/${cluster.id}/kubectl`, { command: `rollout restart ${kind}/${item.metadata.name} ${ns}` })
      if (res.data.success) toast.success('Rollout restarted', `${kind}/${item.metadata.name} is restarting`)
      else toast.error('Restart failed', res.data.stderr || res.data.error || 'kubectl rollout restart failed')
    } catch (e: unknown) { toast.error('Restart failed', errMessage(e)) }
  }, [cluster.id, toast])

  const scaleWorkload = useCallback(async (item: K8sRow) => {
    const kind = singularKind[stateRef.current.activeRes] || 'deployment'
    const current = item.spec?.replicas ?? 1
    const input = window.prompt(`Scale ${kind}/${item.metadata.name} — desired replicas:`, String(current))
    if (input === null) return
    const replicas = parseInt(input, 10)
    if (isNaN(replicas) || replicas < 0) { toast.error('Invalid replica count', 'Enter a non-negative integer'); return }
    const ns = item.metadata.namespace ? `-n ${item.metadata.namespace}` : ''
    try {
      const res = await api.post(`/api/servers/${cluster.id}/kubectl`, { command: `scale ${kind}/${item.metadata.name} --replicas=${replicas} ${ns}` })
      if (res.data.success) toast.success('Scaled', `${kind}/${item.metadata.name} → ${replicas} replicas`)
      else toast.error('Scale failed', res.data.stderr || res.data.error || 'kubectl scale failed')
    } catch (e: unknown) { toast.error('Scale failed', errMessage(e)) }
  }, [cluster.id, toast])

  const fetchPortForwards = useCallback(async () => {
    if (!canUseKubectl) return
    try {
      const res = await api.get(`/api/servers/${cluster.id}/kubectl/port-forward`)
      setPortForwards(res.data.sessions || [])
    } catch (e: unknown) { toast.error('Port-forward list failed', apiError(e) || 'Unable to load sessions') }
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
      if (e.key === 'F' && e.shiftKey && !curYaml.open && !drawer?.open) {
        e.preventDefault();
        
        // If a resource is selected in the current view, pre-fill it
        if (selectedIndex !== -1 && filteredData[selectedIndex]) {
          const item = filteredData[selectedIndex];
          const ns = item.metadata.namespace || 'default';
          const name = item.metadata.name;
          const randomPort = Math.floor(Math.random() * (9999 - 8000 + 1) + 8000).toString();
          
          let target = '';
          const port = randomPort;

          if (activeRes === 'pods') target = `pod/${name}`;
          else if (activeRes === 'services') target = `svc/${name}`;
          else if (['deployments', 'daemonsets', 'statefulsets'].includes(activeRes)) {
            const kindMap: Record<string, string> = { deployments: 'deploy', daemonsets: 'ds', statefulsets: 'sts' };
            target = `${kindMap[activeRes] || activeRes.slice(0, -1)}/${name}`;
          }

          if (target) {
            openPortForward(ns, target, port);
            return;
          }
        }

        setShowPortForward(true);
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

  const handleNameClick = useCallback((item: K8sRow) => {
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
          'rb': 'rolebindings', 'crb': 'clusterrolebindings', 'e': 'events', 'ev': 'events', 'pulse': 'pulse', 'y': 'yaml',
          'ns': 'namespaces', 'namespaces': 'namespaces', 'crd': 'crds', 'crds': 'crds', 'pdb': 'poddisruptionbudgets',
          'gc': 'gatewayclasses', 'gw': 'gateways', 'gateway': 'gateways', 'gateways': 'gateways',
          'hr': 'httproutes', 'httproute': 'httproutes', 'httproutes': 'httproutes',
          'gr': 'grpcroutes', 'grpcroutes': 'grpcroutes', 'rg': 'referencegrants'
        }
       if (routes[input]) { setActiveRes(routes[input]); setCmdError(false); }
       else { setCmdError(true); setTimeout(() => setCmdError(false), 800); return; }
    }
    setShowCommandBar(false); setCommandInput('');
  }

  // Write-only: the API no longer returns stored kubeconfigs (they carry
  // cluster-admin credentials), so this pane starts empty and saving replaces
  // the stored config rather than editing it in place.
  const [rawConfig, setRawConfig] = useState('')
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
        setRawConfig('')
        toast.success('Configuration saved', 'Cluster KubeConfig replaced successfully.')
      } else {
        toast.error('Save failed', 'Status: ' + res.status)
      }
    } catch (e: unknown) {
      toast.error('Save failed', errMessage(e))
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
          height: 'var(--header-h)', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 16,
          borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)',
          flexShrink: 0
        }}>
           <button 
             className="btn-icon" 
             onClick={onBack} 
             style={{ 
               width: 32, height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', 
               background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', 
               justifyContent: 'center', cursor: 'pointer' 
             }}
           >
             <ChevronLeft size={14} color="var(--text-muted)" />
           </button>
           
           <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
             <KubernetesIcon size={24} />
             <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cluster.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                  Kubernetes cluster
                </span>
              </div>
           </div>
           
           {/* Mobile Sidebar Close */}
           <button className="show-mobile-only btn-icon" onClick={() => setIsSidebarOpen(false)} style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
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
              onClick={goTo('nodes')}
              icon={Server} label="Nodes" isSub
            />
            <ResNavLink
              active={activeRes === 'namespaces'}
              onClick={goTo('namespaces')}
              icon={Hash} label="Namespaces" isSub
            />
            <ResNavLink
              active={activeRes === 'events'}
              onClick={goTo('events')}
              icon={List} label="Events" isSub
            />
            <ResNavLink
              active={activeRes === 'crds'}
              onClick={goTo('crds')}
              icon={Puzzle} label="CRDs" isSub
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
            <ResNavLink
              active={activeRes === 'poddisruptionbudgets'}
              onClick={goTo('poddisruptionbudgets')}
              icon={Shield} label="PodDisruptionBudgets" isSub
            />
          </NavCategory>
          <NavCategory label="Network" icon={Globe} isOpen={expandedCats.network} onToggle={() => toggleCategory('network')}>
            <ResNavLink 
              active={activeRes === 'services'} 
              onClick={() => { setActiveRes('services'); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Layers} label="Services" isSub 
            />
            <ResNavLink 
              active={false} 
              onClick={() => { setShowPortForward(true); if (window.innerWidth <= 768) setIsSidebarOpen(false); }} 
              icon={Globe} label="Port Forwarding" isSub 
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
          <NavCategory label="Gateway API" icon={Waypoints} isOpen={expandedCats.gateway} onToggle={() => toggleCategory('gateway')}>
            <ResNavLink
              active={activeRes === 'gatewayclasses'}
              onClick={goTo('gatewayclasses')}
              icon={Network} label="GatewayClasses" isSub
            />
            <ResNavLink
              active={activeRes === 'gateways'}
              onClick={goTo('gateways')}
              icon={Waypoints} label="Gateways" isSub
            />
            <ResNavLink
              active={activeRes === 'httproutes'}
              onClick={goTo('httproutes')}
              icon={Route} label="HTTPRoutes" isSub
            />
            <ResNavLink
              active={activeRes === 'grpcroutes'}
              onClick={goTo('grpcroutes')}
              icon={Route} label="GRPCRoutes" isSub
            />
            <ResNavLink
              active={activeRes === 'referencegrants'}
              onClick={goTo('referencegrants')}
              icon={Shield} label="ReferenceGrants" isSub
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
        <header style={{ height: 'var(--header-h)', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, zIndex: 10 }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
               <button 
                className="show-mobile-only btn-icon" 
                onClick={() => setIsSidebarOpen(true)}
                style={{ padding: 8, background: 'var(--bg-elevated)', borderRadius: 0, border: '1px solid var(--border)' }}
              >
                <LayoutGrid size={16} color="var(--brand-primary)" />
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: connecting ? 'var(--warning)' : 'var(--success)', boxShadow: connecting ? 'none' : '0 0 6px var(--success)', flexShrink: 0 }} />
                <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeRes === 'yaml' ? 'KubeConfig' : (RESOURCE_LABELS[activeRes] || activeRes)}
                </h2>
                {loading && <RefreshCw size={13} className="spin" color="var(--brand-primary)" style={{ flexShrink: 0 }} />}
              </div>
           </div>
           
           <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {activeRes !== 'yaml' && (
                <div className="namespace-selector hidden-mobile" style={{ 
                  display: 'flex', alignItems: 'center', gap: 8, 
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', 
                  padding: '0 12px', height: 34, borderRadius: 'var(--radius-md)' 
                }}>
                  <Globe size={14} color="var(--text-muted)" />
                  <select 
                    style={{ background: 'transparent', border: 'none', fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer', outline: 'none', fontFamily: 'var(--font-mono)', paddingRight: 4 }}
                    value={selectedNS} onChange={e => setSelectedNS(e.target.value)}
                  >
                      <option value="All">Cluster scope</option>
                      {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
                  </select>
                </div>
              )}

              {activeRes === 'yaml' && (
                <button 
                  className="btn btn-primary" 
                  onClick={saveClusterConfig}
                  disabled={savingRaw}
                  style={{ height: 34, padding: '0 16px', fontWeight: 700, fontSize: 12.5 }}
                >
                  {savingRaw ? 'Saving…' : 'Save config'}
                </button>
              )}
              
              {canUseKubectl && (
                <button
                  className="btn btn-primary"
                  onClick={() => openCreateResource()}
                  title="Create a resource from a YAML template"
                  style={{ height: 34, padding: '0 16px', gap: 6, fontWeight: 700, fontSize: 12.5 }}
                >
                  <Plus size={14} />
                  <span className="hidden-mobile">Create</span>
                </button>
              )}

              {canUseKubectl && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowReadOnlyKubeconfig(true)}
                  title="Generate a read-only kubeconfig to share with a developer"
                  style={{ height: 34, padding: '0 14px', gap: 6, fontWeight: 700, fontSize: 12.5 }}
                >
                  <KeyRound size={14} />
                  <span className="hidden-mobile">Read-only access</span>
                </button>
              )}

              <button
                className={`btn ${showMCPTerminal ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setShowMCPTerminal(t => !t)}
                style={{ height: 34, padding: '0 14px', gap: 6, fontWeight: 700, fontSize: 12.5 }}
              >
                <Terminal size={14} />
                <span className="hidden-mobile">Kubectl shell</span>
              </button>
           </div>
        </header>

         <main style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', position: 'relative' }}>
          {(showSearch || showCommandBar) && (
            <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)', padding: '12px 16px', border: cmdError ? '1px solid var(--danger)' : '1px solid var(--border-bright)', borderRadius: 'var(--radius-md)', marginBottom: 16, display: 'flex', alignItems: 'center', boxShadow: 'var(--shadow-md)' }}>
              <span style={{ color: 'var(--brand-primary)', fontWeight: 800, marginRight: 12 }}>{showSearch ? '/' : ':'}</span>
              <form onSubmit={handleCommandSubmit} style={{ flex: 1, margin: 0 }}>
                <input ref={showSearch ? searchInputRef : cmdInputRef}
                       value={showSearch ? filterQuery : commandInput}
                       onChange={e => showSearch ? setFilterQuery(e.target.value) : setCommandInput(e.target.value)}
                       style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, outline: 'none', width: '100%' }}
                       autoFocus
                       placeholder={showSearch ? "Search resources…" : "kubectl command…"} />
              </form>
              <button className="btn-icon" onClick={() => { setShowSearch(false); setShowCommandBar(false); }}><X size={14}/></button>
            </div>
          )}

          {activeRes === 'pulse' && <PulseDashboard cluster={cluster} stats={stats} namespace={selectedNS} error={pulseError} partialErrors={pulsePartial} connecting={connecting} onJump={(r) => setActiveRes(r)} onResync={() => watchK8sData(cluster.id, activeRes, selectedNS)} />}
          
          {activeRes === 'nodes' && <KTable columns={['Name', 'Status', 'Role', 'Version', 'Internal-IP']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(n: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('node', n.metadata.name)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Shell (via a temporary debug pod)" onClick={() => setDrawer({ open: true, mode: 'shell', target: 'node', node: n.metadata.name })}><Terminal size={14} /></button>}
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(n)}><Trash2 size={14} /></button>}
                </>
             )}
          />}

          {activeRes === 'pods' && canUseKubectl && selectedPods.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap',
              padding: '10px 14px', border: '1px solid var(--danger)30', background: 'var(--danger-glow)', borderRadius: 'var(--radius-md)'
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                {selectedPods.size} pod{selectedPods.size === 1 ? '' : 's'} selected
              </span>
              <button
                className="btn btn-sm btn-danger"
                onClick={handleBulkDeletePods}
                disabled={bulkDeleting}
                style={{ marginLeft: 'auto', gap: 6 }}
              >
                <Trash2 size={13} /> {bulkDeleting ? 'Deleting…' : 'Delete selected'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setSelectedPods(new Set())}
                style={{ fontWeight: 700, fontSize: 11 }}
              >
                Clear
              </button>
            </div>
          )}

          {activeRes === 'pods' && <KTable columns={['Name', 'Namespace', 'Restarts', 'Status']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             selectable={canUseKubectl}
             isRowChecked={(p: K8sRow) => selectedPods.has(podKey(p))}
             onToggleRow={toggleSelectPod}
             allChecked={filteredData.length > 0 && selectedPods.size === filteredData.length}
             onToggleAll={toggleSelectAllPods}
             actions={ (p: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('pod', p.metadata.name, p.metadata.namespace)}><FileCode size={14} /></button>
                  <button className="btn-icon" title="Logs" onClick={() => setDrawer({ open: true, mode: 'logs', pod: p.metadata.name, ns: p.metadata.namespace, container: p.spec?.containers?.[0]?.name })}><List size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Shell" onClick={() => setDrawer({ open: true, mode: 'shell', pod: p.metadata.name, ns: p.metadata.namespace, container: p.spec?.containers?.[0]?.name })}><Terminal size={14} /></button>}
                  {canUseKubectl && <button className="btn-icon" title="Port Forward" onClick={() => openPortForward(p.metadata.namespace ?? 'default', `pod/${p.metadata.name}`)}><Globe size={14} /></button>}
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(p)}><Trash2 size={14} /></button>}
                </>
             )}
          />}

          {['deployments', 'daemonsets', 'statefulsets', 'replicasets', 'jobs', 'cronjobs'].includes(activeRes) &&
            <KTable columns={['Name', 'Namespace', 'Ready', 'Available', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
              actions={(d: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(d.kind?.toLowerCase() || activeRes.slice(0, -1), d.metadata.name, d.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && ['deployments', 'daemonsets', 'statefulsets'].includes(activeRes) &&
                    <button className="btn-icon" title="Rollout Restart" onClick={() => rolloutRestart(d)}><RotateCw size={14} /></button>}
                  {canUseKubectl && ['deployments', 'statefulsets', 'replicasets'].includes(activeRes) &&
                    <button className="btn-icon" title="Scale" onClick={() => scaleWorkload(d)}><Expand size={14} /></button>}
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(d)}><Trash2 size={14} /></button>}
                </>
              )}
            />}

          {activeRes === 'configmaps' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(c: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('configmap', c.metadata.name, c.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(c)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'secrets' && <KTable columns={['Name', 'Namespace', 'Type', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('secret', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(s)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'resourcequotas' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('resourcequota', r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(r)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'hpa' && <KTable columns={['Name', 'Namespace', 'Targets', 'MinPods', 'MaxPods', 'Replicas', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(h: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('hpa', h.metadata.name, h.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(h)}><Trash2 size={14} /></button>}
                </>
             )}
          />}

          {activeRes === 'services' && <KTable columns={['Name', 'Namespace', 'Type', 'Cluster-IP', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('service', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Port Forward" onClick={() => openPortForward(s.metadata.namespace ?? 'default', `svc/${s.metadata.name}`, servicePort(s))}><Globe size={14} /></button>}
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(s)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'endpoints' && <KTable columns={['Name', 'Namespace', 'Endpoints', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(e: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('endpoints', e.metadata.name, e.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(e)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'ingresses' && <KTable columns={['Name', 'Namespace', 'Hosts', 'Address', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(i: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('ingress', i.metadata.name, i.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(i)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'networkpolicies' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(n: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('networkpolicy', n.metadata.name, n.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(n)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          
          {activeRes === 'pvcs' && <KTable columns={['Name', 'Namespace', 'Status', 'Volume', 'Capacity', 'AccessModes', 'StorageClass', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(p: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('persistentvolumeclaim', p.metadata.name, p.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(p)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'pvs' && <KTable columns={['Name', 'Capacity', 'AccessModes', 'ReclaimPolicy', 'Status', 'Claim', 'StorageClass', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(p: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('persistentvolume', p.metadata.name)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(p)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'storageclasses' && <KTable columns={['Name', 'Provisioner', 'ReclaimPolicy', 'VolumeBindingMode', 'AllowVolumeExpansion', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('storageclass', s.metadata.name)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(s)}><Trash2 size={14} /></button>}
                </>
             )}
          />}

          {activeRes === 'serviceaccounts' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(s: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('serviceaccount', s.metadata.name, s.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(s)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {['roles', 'clusterroles'].includes(activeRes) && <KTable columns={['Name', activeRes === 'roles' ? 'Namespace' : '', 'Age'].filter(Boolean)} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(activeRes.slice(0, -1), r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(r)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {['rolebindings', 'clusterrolebindings'].includes(activeRes) && <KTable columns={['Name', activeRes === 'rolebindings' ? 'Namespace' : '', 'Role', 'Age'].filter(Boolean)} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(activeRes.slice(0, -1), r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(r)}><Trash2 size={14} /></button>}
                </>
             )}
          />}

          {activeRes === 'events' && <KTable columns={['Type', 'Reason', 'Object', 'Message', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} />}

          {activeRes === 'namespaces' && <KTable columns={['Name', 'Status', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(n: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('namespace', n.metadata.name)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(n)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'crds' && <KTable columns={['Name', 'Group', 'Scope', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(c: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('crd', c.metadata.name)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(c)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'poddisruptionbudgets' && <KTable columns={['Name', 'Namespace', 'MinAvailable', 'MaxUnavailable', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(p: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('poddisruptionbudget', p.metadata.name, p.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(p)}><Trash2 size={14} /></button>}
                </>
             )}
          />}

          {activeRes === 'gatewayclasses' && <KTable columns={['Name', 'Controller', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(g: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('gatewayclass', g.metadata.name)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(g)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'gateways' && <KTable columns={['Name', 'Namespace', 'Class', 'Address', 'Listeners', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(g: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('gateway', g.metadata.name, g.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(g)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {['httproutes', 'grpcroutes'].includes(activeRes) && <KTable columns={['Name', 'Namespace', 'Hostnames', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml(activeRes.slice(0, -1), r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(r)}><Trash2 size={14} /></button>}
                </>
             )}
          />}
          {activeRes === 'referencegrants' && <KTable columns={['Name', 'Namespace', 'Age']} data={filteredData} loading={connecting} selectedIndex={selectedIndex} onNameClick={handleNameClick}
             actions={(r: K8sRow) => (
                <>
                  <button className="btn-icon" title="Edit YAML" onClick={() => fetchYaml('referencegrant', r.metadata.name, r.metadata.namespace)}><FileCode size={14} /></button>
                  {canUseKubectl && <button className="btn-icon" title="Delete" onClick={() => handleDeleteResource(r)}><Trash2 size={14} /></button>}
                </>
             )}
          />}

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


      {showPortForward && canUseKubectl && <PortForwardModal 
          serverID={cluster.id} 
          sessions={portForwards} 
          onClose={() => { setShowPortForward(false); setPfTarget({}); }} 
          onRefresh={fetchPortForwards} 
          initialNamespace={pfTarget.ns}
          initialTarget={pfTarget.target}
          initialPort={pfTarget.port}
      />}
      {drawer?.open && canUseKubectl && <TerminalPortal serverID={cluster.id} target={drawer.target || 'pod'} pod={drawer.pod} namespace={drawer.ns} container={drawer.container} node={drawer.node} mode={drawer.mode} onClose={() => setDrawer(null)} />}
      {showMCPTerminal && <MCPTerminal clusterId={cluster.id} clusterName={cluster.name} onClose={() => setShowMCPTerminal(false)} />}
      {showReadOnlyKubeconfig && canUseKubectl && <ReadOnlyKubeconfigModal serverID={cluster.id} clusterName={cluster.name} onClose={() => setShowReadOnlyKubeconfig(false)} />}
      
      {editingYaml.open && (
        <div className="fade-in" style={{ position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: 'var(--bg-app)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 64, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', gap: 16 }}>
            {editingYaml.isNew ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Create resource</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pick a template, edit and apply · Ctrl/Cmd + S to apply</span>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  padding: '6px 12px', borderRadius: 'var(--radius-md)'
                }}>
                  <FileCode size={14} color="var(--brand-primary)" />
                  <select
                    style={{ background: 'transparent', border: 'none', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', cursor: 'pointer', outline: 'none', fontFamily: 'var(--font-mono)', paddingRight: 4 }}
                    value={createKind} onChange={e => switchCreateTemplate(e.target.value)}
                  >
                    {Object.keys(K8S_TEMPLATES).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{editingYaml.kind?.toUpperCase()}: {editingYaml.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{editingYaml.ns || 'Cluster scoped'} · Ctrl/Cmd + S to apply</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
              <button className="btn btn-secondary" onClick={() => setEditingYaml({ open: false, content: '' })}>Cancel</button>
              <button className="btn btn-primary" onClick={applyYaml} disabled={loading}>{loading ? 'Applying…' : editingYaml.isNew ? 'Create & apply' : 'Save & apply'}</button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ConfigViewer content={editingYaml.content} onChange={(val: string) => setEditingYaml(c => ({ ...c, content: val }))} fullPage />
            </div>
            
            {applyResult && (
              <div className="fade-up" style={{ height: 180, background: '#0f172a', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                 <div style={{ height: 32, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: applyResult.success ? '#064e3b' : '#7f1d1d' }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {applyResult.success ? '✓ Apply Success' : '✕ Apply Failed'}
                    </span>
                    <button className="btn-icon" onClick={() => setApplyResult(null)} style={{ color: '#fff', padding: 4 }}><X size={14}/></button>
                 </div>
                 <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
                    <pre style={{ margin: 0, fontSize: 13, color: applyResult.success ? '#10b981' : '#f87171', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
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
