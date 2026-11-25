import { memo } from 'react'
import { Plus, ChevronRight, Unlink, Trash2, RefreshCw, Server } from 'lucide-react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { KubernetesIcon } from '../OSIcons'
import { FolderTag } from '../ui/FolderTag'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { PageHeader } from '../ui/PageHeader'
import type { FolderItem } from '../../hooks/useFolders'

interface Cluster {
  id: number;
  name: string;
  host: string;
  k8s_connected?: boolean;
  os?: string;
  has_kubeconfig?: boolean;
  folder_id?: number | null;
}

interface K8sClusterGridProps {
  clusters: Cluster[];
  onSelect: (cluster: Cluster) => void;
  onAdd: () => void;
  onDisconnect: (id: number) => void;
  onReconnect: (id: number) => void;
  onDelete: (id: number) => void;
  confirmDisconnect: number | null;
  setConfirmDisconnect: (id: number | null) => void;
  confirmDelete: number | null;
  setConfirmDelete: (id: number | null) => void;
  folders: FolderItem[];
  onMoveFolder: (id: number, folderId: number | null) => void;
  canManage: boolean;
}

const Meta = ({ label, value }: { label: string; value: string }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>{label}</Typography>
    <Typography variant="body2" noWrap title={value} sx={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{value}</Typography>
  </Box>
)

export const K8sClusterGrid = memo(({
  clusters, onSelect, onAdd, onDisconnect, onReconnect, onDelete,
  confirmDisconnect, setConfirmDisconnect, confirmDelete, setConfirmDelete,
  folders, onMoveFolder, canManage
}: K8sClusterGridProps) => {
  const online = clusters.filter(c => c.k8s_connected).length
  const offline = clusters.length - online
  const disconnectTarget = clusters.find(c => c.id === confirmDisconnect)
  const deleteTarget = clusters.find(c => c.id === confirmDelete)

  return (
    <Box>
      <PageHeader
        title="Kubernetes clusters"
        subtitle="Manage control planes and workloads across every connected cluster."
        actions={
          <>
            {online > 0 && <Chip size="small" color="success" label={`${online} online`} />}
            {offline > 0 && <Chip size="small" color="error" label={`${offline} offline`} />}
            <Button icon={<Plus size={16} />} onClick={onAdd}>Connect cluster</Button>
          </>
        }
      />

      {clusters.length === 0 ? (
        <Card variant="outlined" sx={{ borderStyle: 'dashed' }}>
          <EmptyState
            icon={Server}
            title="No clusters connected"
            description="Connect your first cluster by providing its kubeconfig file."
            action={<Button icon={<Plus size={16} />} onClick={onAdd}>Connect cluster</Button>}
          />
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 2 }}>
          {clusters.map(cluster => {
            const isConnected = !!cluster.k8s_connected
            return (
              <Card
                key={cluster.id}
                variant="outlined"
                onClick={() => { if (isConnected) onSelect(cluster) }}
                sx={{
                  p: 2, display: 'flex', flexDirection: 'column', gap: 2,
                  cursor: isConnected ? 'pointer' : 'default',
                  '&:hover': isConnected ? { borderColor: 'primary.main' } : undefined,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: 'action.selected', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <KubernetesIcon size={22} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" component="h3" noWrap sx={{ lineHeight: 1.3 }}>{cluster.name}</Typography>
                      <Chip size="small" color={isConnected ? 'success' : 'error'} label={isConnected ? 'Connected' : 'Offline'} />
                    </Box>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    #{String(cluster.id).padStart(2, '0')}
                  </Typography>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5 }}>
                  <Meta label="API host" value={cluster.host || 'auto'} />
                  <Meta label="Engine" value="Kubernetes" />
                  <Box onClick={e => e.stopPropagation()} sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Folder</Typography>
                    <FolderTag
                      folders={folders}
                      value={cluster.folder_id ?? null}
                      onChange={fid => onMoveFolder(cluster.id, fid)}
                      disabled={!canManage}
                    />
                  </Box>
                </Box>

                <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    {isConnected ? (
                      canManage && (
                        <Tooltip title="Disconnect cluster">
                          <IconButton size="small" aria-label={`Disconnect ${cluster.name}`}
                            onClick={e => { e.stopPropagation(); setConfirmDisconnect(cluster.id) }}>
                            <Unlink size={15} />
                          </IconButton>
                        </Tooltip>
                      )
                    ) : (
                      <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />}
                        onClick={e => { e.stopPropagation(); onReconnect(cluster.id) }}>
                        Reconnect
                      </Button>
                    )}
                    {canManage && (
                      <Tooltip title="Delete cluster">
                        <IconButton size="small" color="error" aria-label={`Delete ${cluster.name}`}
                          onClick={e => { e.stopPropagation(); setConfirmDelete(cluster.id) }}>
                          <Trash2 size={15} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>

                  {isConnected ? (
                    <Button size="sm" icon={<ChevronRight size={13} />} iconPosition="right"
                      onClick={e => { e.stopPropagation(); onSelect(cluster) }}>
                      Manage cluster
                    </Button>
                  ) : (
                    <Typography variant="caption" color="text.secondary">Not connected</Typography>
                  )}
                </Box>
              </Card>
            )
          })}
        </Box>
      )}

      <Dialog open={!!disconnectTarget} onClose={() => setConfirmDisconnect(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Disconnect cluster?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {disconnectTarget?.name} will no longer be actively managed. You can reconnect it later.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="secondary" onClick={() => setConfirmDisconnect(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => disconnectTarget && onDisconnect(disconnectTarget.id)}>Disconnect</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete cluster?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget?.name} and its stored data will be permanently deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => deleteTarget && onDelete(deleteTarget.id)}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
})

K8sClusterGrid.displayName = 'K8sClusterGrid'
