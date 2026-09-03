import { memo } from 'react'
import { Plus, ChevronRight, Unlink, Trash2, RefreshCw, Server } from 'lucide-react'
import { KubernetesIcon } from '../OSIcons'
import { FolderTag } from '../ui/FolderTag'
import type { FolderItem } from '../../hooks/useFolders'
import type { CSSProperties } from 'react'

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
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
  </div>
)

export const K8sClusterGrid = memo(({
  clusters, onSelect, onAdd, onDisconnect, onReconnect, onDelete,
  confirmDisconnect, setConfirmDisconnect, confirmDelete, setConfirmDelete,
  folders, onMoveFolder, canManage
}: K8sClusterGridProps) => {
  const online = clusters.filter(c => c.k8s_connected).length
  const offline = clusters.length - online

  return (
    <div className="fade-in">
      <div className="page-header" style={{ marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
        <div>
          <h1 className="page-title">Kubernetes clusters</h1>
          <p className="page-subtitle" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Manage control planes and workloads across every connected cluster.
            {(online > 0 || offline > 0) && (
              <span style={{ marginLeft: 10, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="badge badge-success" style={{ fontSize: 11, fontWeight: 700 }}>{online} online</span>
                {offline > 0 && <span className="badge badge-danger" style={{ fontSize: 11, fontWeight: 700 }}>{offline} offline</span>}
              </span>
            )}
          </p>
        </div>
        <button className="btn btn-primary" onClick={onAdd} style={{ height: 40, padding: '0 20px', fontWeight: 700, flexShrink: 0 }}>
          <Plus size={16} /> Connect cluster
        </button>
      </div>

      {clusters.length === 0 ? (
        <div className="empty-state" style={{ padding: '96px 40px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
            <Server size={28} color="var(--brand-primary)" />
          </div>
          <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>No clusters connected</h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 8, maxWidth: 420, lineHeight: 1.7 }}>
            Connect your first cluster by providing its KubeConfig identity file.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 28, padding: '10px 24px', fontWeight: 700 }} onClick={onAdd}>
            <Plus size={16} /> Connect cluster
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 20 }}>
          {clusters.map((cluster, i) => {
            const isConnected = !!cluster.k8s_connected
            return (
              <div
                key={cluster.id}
                className="card fade-up hover-lift"
                style={{
                  animationDelay: `${i * 50}ms`,
                  cursor: isConnected ? 'pointer' : 'default',
                  padding: 22,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16
                }}
                onClick={() => { if (isConnected) onSelect(cluster) }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 'var(--radius-md)',
                      background: isConnected ? 'var(--brand-glow)' : 'var(--bg-elevated)',
                      border: `1px solid ${isConnected ? 'var(--brand-primary)30' : 'var(--border)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      <KubernetesIcon size={24} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '0 0 6px' }}>{cluster.name}</h3>
                      <span
                        className="status-pill status-pill-solid"
                        style={{
                          '--pill-color': isConnected ? 'var(--success)' : 'var(--danger)',
                          '--pill-bg': isConnected ? 'var(--success-glow)' : 'var(--danger-glow)',
                          '--pill-border': isConnected ? 'var(--success)' : 'var(--danger)',
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em'
                        } as CSSProperties}
                      >
                        {isConnected ? 'Connected' : 'Offline'}
                      </span>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>#{String(cluster.id).padStart(2, '0')}</span>
                </div>

                {/* Meta */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <Meta label="API host" value={cluster.host || 'auto'} />
                  <Meta label="Engine" value="Kubernetes" />
                  <div onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>Folder</div>
                    <FolderTag
                      folders={folders}
                      value={cluster.folder_id ?? null}
                      onChange={fid => onMoveFolder(cluster.id, fid)}
                      disabled={!canManage}
                    />
                  </div>
                </div>

                {/* Footer actions */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {isConnected ? (
                      confirmDisconnect === cluster.id ? (
                        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                          <button className="btn btn-sm btn-danger" onClick={() => onDisconnect(cluster.id)}>Disconnect</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDisconnect(null)}>Cancel</button>
                        </div>
                      ) : (
                        canManage && (
                          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setConfirmDisconnect(cluster.id) }} title="Disconnect cluster" style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-app)' }}><Unlink size={14} /></button>
                        )
                      )
                    ) : (
                      <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onReconnect(cluster.id) }} style={{ gap: 6 }}>
                        <RefreshCw size={13} /> Reconnect
                      </button>
                    )}

                    {confirmDelete === cluster.id ? (
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(cluster.id)}>Delete</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                      </div>
                    ) : (
                      canManage && (
                        <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(cluster.id) }} title="Delete cluster" style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-app)' }}><Trash2 size={14} /></button>
                      )
                    )}
                  </div>

                  {isConnected ? (
                    <button className="btn btn-primary btn-sm" style={{ gap: 6, flexShrink: 0 }}>
                      Manage cluster <ChevronRight size={13} />
                    </button>
                  ) : (
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>Not connected</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

K8sClusterGrid.displayName = 'K8sClusterGrid'
