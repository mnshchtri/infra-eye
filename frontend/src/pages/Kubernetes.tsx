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

  const loadClusters = useCallback(async () => {
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
