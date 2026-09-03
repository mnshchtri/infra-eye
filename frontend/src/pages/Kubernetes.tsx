import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'
import { useFolders } from '../hooks/useFolders'
import { FolderBar, type FolderSelection } from '../components/ui/FolderBar'

// Sub-components
import { K8sClusterGrid } from '../components/k8s/K8sClusterGrid'
import { K8sResourceExplorer } from '../components/k8s/K8sResourceExplorer'
import { AddClusterModal } from '../components/k8s/AddClusterModal'
import { apiError } from '../utils/errors'

interface Cluster {
  id: number;
  name: string;
  host: string;
  has_kubeconfig?: boolean;
  k8s_connected?: boolean;
  os?: string;
  folder_id?: number | null;
}

export function Kubernetes() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)
  const [showAddCluster, setShowAddCluster] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>('all')

  const toast = useToastStore()
  const { can } = usePermission()
  const canUseKubectl = can('use-kubectl')
  const canManage = can('manage-servers')
  const { folders, createFolder, deleteFolder } = useFolders()

  const loadClusters = useCallback(async () => {
    try {
      const res = await api.get('/api/servers')
      setClusters(res.data?.filter((c: Cluster) => c.has_kubeconfig) || [])
    } catch (e) { console.error(e) }
  }, [])

  const filteredClusters = useMemo(() => clusters.filter(c => {
    if (selectedFolder === 'all') return true
    if (selectedFolder === 'unassigned') return !c.folder_id
    return c.folder_id === selectedFolder
  }), [clusters, selectedFolder])

  async function moveClusterFolder(id: number, folderId: number | null) {
    try {
      await api.patch(`/api/servers/${id}/folder`, { folder_id: folderId })
      setClusters(prev => prev.map(c => c.id === id ? { ...c, folder_id: folderId } : c))
    } catch (e: unknown) {
      toast.error('Move failed', apiError(e) || 'Could not move cluster.')
    }
  }

  useEffect(() => { loadClusters() }, [loadClusters])

  const handleDisconnect = async (id: number) => {
    try {
      await api.post(`/api/servers/${id}/k8s/disconnect`)
      toast.success('Cluster disconnected', 'Server is no longer actively managed.')
      setConfirmDisconnect(null)
      loadClusters()
    } catch (e: unknown) {
      toast.error('Disconnect failed', apiError(e) || 'Could not disconnect')
      setConfirmDisconnect(null)
    }
  }

  const handleReconnect = async (id: number) => {
    try {
      await api.post(`/api/servers/${id}/k8s/reconnect`)
      toast.success('Cluster connected', 'Server is now actively managed.')
      loadClusters()
    } catch (e: unknown) { toast.error('Connect failed', apiError(e) || 'Could not connect') }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api/servers/${id}`)
      toast.success('Server deleted', 'Cluster data destroyed.')
      setConfirmDelete(null)
      loadClusters()
    } catch (e: unknown) {
      toast.error('Delete failed', apiError(e) || 'Could not delete server')
      setConfirmDelete(null)
    }
  }

  return (
    <>
      {selectedCluster ? (
        <K8sResourceExplorer 
          cluster={selectedCluster} 
          onBack={() => setSelectedCluster(null)}
          canUseKubectl={canUseKubectl}
        />
      ) : (
        <div className="page">
          {clusters.length > 0 && (
            <FolderBar
              folders={folders}
              counts={clusters.reduce((acc, c) => {
                if (c.folder_id) acc[c.folder_id] = (acc[c.folder_id] || 0) + 1
                return acc
              }, {} as Record<number, number>)}
              unassignedCount={clusters.filter(c => !c.folder_id).length}
              totalCount={clusters.length}
              selected={selectedFolder}
              onSelect={setSelectedFolder}
              onCreate={createFolder}
              onDelete={deleteFolder}
              canManage={canManage}
            />
          )}
          <K8sClusterGrid
            clusters={filteredClusters}
            onSelect={setSelectedCluster}
            onAdd={() => setShowAddCluster(true)}
            onDisconnect={handleDisconnect}
            onReconnect={handleReconnect}
            onDelete={handleDelete}
            confirmDisconnect={confirmDisconnect}
            setConfirmDisconnect={setConfirmDisconnect}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            folders={folders}
            onMoveFolder={moveClusterFolder}
            canManage={canManage}
          />
        </div>
      )}
      {showAddCluster && <AddClusterModal onClose={() => setShowAddCluster(false)} onSuccess={loadClusters} folders={folders} />}
    </>
  )
}
