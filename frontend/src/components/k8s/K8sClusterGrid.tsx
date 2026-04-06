import { memo } from 'react'
import { Plus, Zap, ChevronRight, Unlink, Globe, Trash2, RefreshCw, Cpu, Database, Activity } from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../OSIcons'
import logo from '../../assets/logo.png'

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
      <div className="page-header" style={{ marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        <div>
          <h1 className="page-title">
            Infrastructure Clusters
          </h1>
          <p className="page-subtitle" style={{ 
            fontSize: 8, fontWeight: 900, color: 'var(--text-muted)', 
            textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', marginTop: 2 
          }}>
            Managed Kubernetes Control Planes : Active Systems
          </p>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={onAdd} 
          style={{ height: 44, borderRadius: 0, padding: '0 24px', fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
        >
          <Plus size={16} /> CONNECT CLUSTER
        </button>
      </div>

      <div className="grid-cards" style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 24 }}>
        {clusters.map((cluster, i) => {
          const isConnected = !!cluster.k8s_connected
          const statusColor = isConnected ? 'var(--success)' : 'var(--danger)'

          return (
            <div
              key={cluster.id}
              className="card server-card fade-up hover-lift"
              style={{
                animationDelay: `${i * 50}ms`,
                cursor: isConnected ? 'pointer' : 'default',
                padding: 24,
                borderRadius: 0,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                position: 'relative',
                overflow: 'hidden'
              }}
              onClick={() => { if (isConnected) onSelect(cluster) }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 0,
                      background: 'var(--brand-primary)', border: `1px solid var(--border)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, padding: 6
                    }}>
                      <img src={logo} alt="L" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                       <h3 style={{ 
                         fontSize: 14, fontWeight: 900, color: 'var(--text-primary)', 
                         textTransform: 'uppercase', letterSpacing: '0.02em', fontFamily: 'var(--font-mono)',
                         overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                       }}>
                         {cluster.name}
                       </h3>
                       <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
                          <span style={{ 
                            fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', 
                            textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' 
                          }}>
                            {isConnected ? 'STREAM_ACTIVE' : 'LINK_OFFLINE'}
                          </span>
                       </div>
                    </div>
                 </div>
                 
                 <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>NODE_IP</div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{cluster.host || 'DIRECT_API'}</div>
                 </div>
              </div>

              <div style={{ display: 'flex', gap: 32, marginBottom: 28 }}>
                 <div>
                    <div style={{ fontSize: 8, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Protocol</div>
                    <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--brand-primary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>KUBERNETES_API</div>
                 </div>
                 <div>
                    <div style={{ fontSize: 8, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Infrastructure</div>
                    <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-primary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>PRODUCTION_CORE</div>
                 </div>
              </div>

              {/* Action Layer */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <div style={{ display: 'flex', gap: 8 }}>
                    {isConnected ? (
                       confirmDisconnect === cluster.id ? (
                          <div style={{ display: 'flex', gap: 1 }} onClick={e => e.stopPropagation()}>
                             <button className="btn btn-warning" onClick={() => onDisconnect(cluster.id)} style={{ height: 32, borderRadius: 0, padding: '0 12px', fontSize: 10, fontWeight: 900 }}>OFFLINE</button>
                             <button className="btn btn-secondary" onClick={() => setConfirmDisconnect(null)} style={{ height: 32, borderRadius: 0, padding: '0 12px', fontSize: 10, fontWeight: 900 }}>BACK</button>
                          </div>
                       ) : (
                          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setConfirmDisconnect(cluster.id) }} style={{ width: 32, height: 32, borderRadius: 0, border: '1px solid var(--border)', background: 'var(--bg-app)' }} title="Deauthorize"><Unlink size={14} /></button>
                       )
                    ) : (
                       <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onReconnect(cluster.id) }} style={{ width: 32, height: 32, borderRadius: 0, border: '1px solid var(--border)', background: 'var(--bg-app)' }} title="Handshake"><RefreshCw size={14} /></button>
                    )}

                    {confirmDelete === cluster.id ? (
                       <div style={{ display: 'flex', gap: 1 }} onClick={e => e.stopPropagation()}>
                          <button className="btn btn-danger" onClick={() => onDelete(cluster.id)} style={{ height: 32, borderRadius: 0, padding: '0 12px', fontSize: 10, fontWeight: 900 }}>DELETE</button>
                          <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)} style={{ height: 32, borderRadius: 0, padding: '0 12px', fontSize: 10, fontWeight: 900 }}>BACK</button>
                       </div>
                    ) : (
                       <button className="btn-icon danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(cluster.id) }} style={{ width: 32, height: 32, borderRadius: 0, border: '1px solid var(--border)', background: 'var(--bg-app)' }} title="Destroy"><Trash2 size={14} /></button>
                    )}
                 </div>

                 {isConnected && (
                    <button className="btn btn-primary" style={{ padding: '0 16px', height: 32, borderRadius: 0, fontSize: 10, fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
                       MANAGE_CLUSTER <ChevronRight size={12} style={{ marginLeft: 4 }} />
                    </button>
                 )}
              </div>
            </div>
          )
        })}

        {clusters.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '120px 40px', textAlign: 'center', border: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 0,
              background: 'var(--bg-app)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32,
            }}>
              <Database size={28} color="var(--brand-primary)" />
            </div>
            <h2 style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 900, fontSize: 20, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>No Clusters Discovered</h2>
            <p style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginTop: 16, maxWidth: 420, lineHeight: 1.8 }}>
              Initialize your first infrastructure control plane by providing a KubeConfig identity file.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 40, padding: '16px 48px', borderRadius: 0, fontWeight: 900, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }} onClick={onAdd}>
              INITIATE HANDSHAKE
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

K8sClusterGrid.displayName = 'K8sClusterGrid'
