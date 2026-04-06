import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'

// Sub-components
import { K8sClusterGrid } from '../components/k8s/K8sClusterGrid'
import { K8sResourceExplorer } from '../components/k8s/K8sResourceExplorer'
import { AddClusterModal } from '../components/k8s/AddClusterModal'

interface Cluster {
  id: number;
  name: string;
  host: string;
  kube_config?: string;
  k8s_connected?: boolean;
  os?: string;
}

export function Kubernetes() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)
  const [showAddCluster, setShowAddCluster] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  
  const toast = useToastStore()
  const { can } = usePermission()
  const canUseKubectl = can('use-kubectl')

<<<<<<< HEAD
  const loadClusters = useCallback(async () => {
=======
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
  const [drawer, setDrawer] = useState<{ open: boolean; mode: 'logs' | 'shell'; pod?: string; ns?: string; container?: string } | null>(null)

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
         else if (e.key === 's' && activeRes === 'pods') {
             e.preventDefault()
             const item = filteredData[selectedIndex];
             setDrawer({ open: true, mode: 'shell', pod: item.metadata.name, ns: item.metadata.namespace, container: item.spec?.containers?.[0]?.name })
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
>>>>>>> 6ae201e (feat: add container field to Kubernetes drawer state for targeted logs and shell access)
    try {
      const res = await api.get('/api/servers')
      setClusters(res.data?.filter((c: any) => c.kube_config) || [])
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadClusters() }, [loadClusters])

  const handleDisconnect = async (id: number) => {
    try {
      await api.post(`/api/servers/${id}/k8s/disconnect`)
      toast.success('Cluster disconnected', 'Server is no longer actively managed.')
      setConfirmDisconnect(null)
      loadClusters()
    } catch (e: any) {
      toast.error('Disconnect failed', e.response?.data?.error || 'Could not disconnect')
      setConfirmDisconnect(null)
    }
  }

  const handleReconnect = async (id: number) => {
    try {
      await api.post(`/api/servers/${id}/k8s/reconnect`)
      toast.success('Cluster connected', 'Server is now actively managed.')
      loadClusters()
    } catch (e: any) { toast.error('Connect failed', e.response?.data?.error || 'Could not connect') }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api/servers/${id}`)
      toast.success('Server deleted', 'Cluster data destroyed.')
      setConfirmDelete(null)
      loadClusters()
    } catch (e: any) {
      toast.error('Delete failed', e.response?.data?.error || 'Could not delete server')
      setConfirmDelete(null)
    }
  }

  if (selectedCluster) {
    return (
      <K8sResourceExplorer 
        cluster={selectedCluster} 
        onBack={() => setSelectedCluster(null)}
        canUseKubectl={canUseKubectl}
      />
    )
  }

  return (
    <>
      <K8sClusterGrid 
        clusters={clusters}
        onSelect={setSelectedCluster}
        onAdd={() => setShowAddCluster(true)}
        onDisconnect={handleDisconnect}
        onReconnect={handleReconnect}
        onDelete={handleDelete}
        confirmDisconnect={confirmDisconnect}
        setConfirmDisconnect={setConfirmDisconnect}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
      />
      {showAddCluster && <AddClusterModal onClose={() => setShowAddCluster(false)} onSuccess={loadClusters} />}
    </>
  )
}
