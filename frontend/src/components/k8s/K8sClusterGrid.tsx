import { memo } from 'react'
import { Plus, Zap, ChevronRight, Unlink, Globe, Trash2, RefreshCw, Cpu } from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../OSIcons'

interface Cluster {
  id: number;
  name: string;
  host: string;
  k8s_connected?: boolean;
  os?: string;
  kube_config?: string;
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
}

export const K8sClusterGrid = memo(({
  clusters, onSelect, onAdd, onDisconnect, onReconnect, onDelete,
  confirmDisconnect, setConfirmDisconnect, confirmDelete, setConfirmDelete
}: K8sClusterGridProps) => {
  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Kubernetes Clusters</h1>
          <p className="page-subtitle">Manage and explore connected Kubernetes infrastructure</p>
        </div>
        <button className="btn btn-primary" onClick={onAdd} style={{ height: 40 }}>
          <Plus size={16} /> Add Cluster
        </button>
      </div>

      <div className="grid-cards" style={{ marginTop: 8 }}>
        {clusters.map((cluster, i) => {
          const isConnected = !!cluster.k8s_connected
          const statusColor = isConnected ? 'var(--success)' : 'var(--danger)'
          const statusLabel = isConnected ? 'CONNECTED' : 'DISCONNECTED'

          return (
            <div
              key={cluster.id}
              className="card server-card fade-up"
              style={{
                animationDelay: `${i * 60}ms`,
                cursor: isConnected ? 'pointer' : 'default',
                padding: 24,
                overflow: 'hidden',
                opacity: isConnected ? 1 : 0.85,
              }}
              onClick={() => { if (isConnected) onSelect(cluster) }}
            >
              {/* Header: icon + name + status badge inline */}
              <div className="server-card-header">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
                  {/* Cluster icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                    background: `${statusColor}10`, border: `1px solid ${statusColor}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {cluster.os === 'darwin' ? <AppleIcon size={20} color={statusColor} /> :
                     cluster.os === 'windows' ? <WindowsIcon size={18} color={statusColor} /> :
                     cluster.os === 'linux'   ? <LinuxIcon size={18} color={statusColor} /> :
                     <KubernetesIcon size={22} />}
                  </div>

                  {/* Name + OS pill + status + host */}
                  <div className="server-info-top" style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: name + OS pill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <div className="server-name" style={{
                        fontSize: 15, fontWeight: 700,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {cluster.name}
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                        background: 'rgba(129,140,248,0.15)', color: 'var(--brand-primary)',
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        border: '1px solid rgba(129,140,248,0.2)',
                      }}>
                        {cluster.os?.toUpperCase() || 'K8S'}
                      </span>
                    </div>

                    {/* Row 2: status badge + host */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <span
                        className={isConnected ? 'badge badge-online' : 'badge badge-offline'}
                        style={{ fontSize: 10, padding: '2px 8px' }}
                      >
                        <span style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: statusColor, display: 'inline-block', marginRight: 4,
                          boxShadow: isConnected ? `0 0 6px ${statusColor}` : undefined,
                        }} />
                        {statusLabel}
                      </span>
                      <div className="server-host" style={{ fontSize: 11 }}>
                        {cluster.host
                          ? <><Globe size={10} style={{ display: 'inline', marginRight: 4 }} />{cluster.host}</>
                          : <><Cpu size={10} style={{ display: 'inline', marginRight: 4, color: 'var(--success)' }} /><span style={{ color: 'var(--success)' }}>Direct API</span></>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer: action buttons */}
              <div className="server-card-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 16 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {isConnected ? (
                    confirmDisconnect === cluster.id ? (
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        <button
                          style={{
                            padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                            background: 'var(--warning)', border: 'none', color: '#fff', cursor: 'pointer',
                          }}
                          onClick={() => onDisconnect(cluster.id)}
                        >
                          Confirm
                        </button>
                        <button
                          style={{
                            padding: '5px 10px', borderRadius: 8, fontSize: 11,
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            color: 'var(--text-muted)', cursor: 'pointer',
                          }}
                          onClick={() => setConfirmDisconnect(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-icon-sm"
                        title="Disconnect"
                        onClick={(e) => { e.stopPropagation(); setConfirmDisconnect(cluster.id) }}
                      >
                        <Unlink size={13} />
                      </button>
                    )
                  ) : (
                    <button
                      className="btn-icon-sm"
                      title="Reconnect"
                      onClick={(e) => { e.stopPropagation(); onReconnect(cluster.id) }}
                    >
                      <RefreshCw size={13} />
                    </button>
                  )}

                  {confirmDelete === cluster.id ? (
                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      <button
                        style={{
                          padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                          background: 'var(--danger)', border: 'none', color: '#fff', cursor: 'pointer',
                        }}
                        onClick={() => onDelete(cluster.id)}
                      >
                        Confirm
                      </button>
                      <button
                        style={{
                          padding: '5px 10px', borderRadius: 8, fontSize: 11,
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                          color: 'var(--text-muted)', cursor: 'pointer',
                        }}
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn-icon-sm"
                      title="Delete cluster"
                      style={{ color: 'var(--danger)' }}
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(cluster.id) }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = '' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {/* Explore arrow — only when connected */}
                {isConnected && (
                  <button className="btn-icon-sm primary" title="Explore cluster">
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {clusters.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '80px 40px' }}>
            <div style={{
              width: 72, height: 72, borderRadius: 22,
              background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24,
            }}>
              <Zap size={36} color="var(--brand-primary)" />
            </div>
            <p>No managed clusters</p>
            <span>Connect your first cluster using a KubeConfig file to begin management.</span>
            <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={onAdd}>
              <Plus size={14} /> Get Started
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

K8sClusterGrid.displayName = 'K8sClusterGrid'
