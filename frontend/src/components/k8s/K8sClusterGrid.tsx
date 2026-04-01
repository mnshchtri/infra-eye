import { memo } from 'react'
import { Plus, Zap, ChevronRight, Unlink, Globe, Trash2 } from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../OSIcons'

interface Cluster {
  id: number;
  name: string;
  host: string;
  k8s_connected?: boolean;
  os?: string;
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
          <h1 className="page-title">Kubernetes Cluster Manager</h1>
          <p className="page-subtitle">Standardized light-mode infrastructure administration</p>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={16} style={{ marginRight: 8 }} /> Add Cluster
        </button>
      </div>

      <div className="grid-cards" style={{ marginTop: 12 }}>
        {clusters.map((cluster, i) => (
          <div 
            key={cluster.id} 
            className="card hover-lift" 
            style={{ animationDelay: `${i * 100}ms`, cursor: 'pointer', opacity: cluster.k8s_connected ? 1 : 0.7 }}
            onClick={() => {
              if (cluster.k8s_connected) onSelect(cluster)
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {cluster.os === 'darwin' ? <AppleIcon size={24} color="var(--brand-primary)" /> :
                 cluster.os === 'windows'? <WindowsIcon size={22} color="var(--brand-primary)" /> :
                 cluster.os === 'linux'  ? <LinuxIcon size={22} color="var(--brand-primary)" /> :
                 <KubernetesIcon size={30} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cluster.name}</h3>
                  <span style={{ fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 4, background: 'rgba(129,140,248,0.1)', color: 'var(--brand-primary)', textTransform: 'uppercase' }}>
                    {cluster.os || 'K8s'}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cluster.host}</p>
              </div>
            </div>
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <div className={cluster.k8s_connected ? "badge badge-online" : "badge badge-offline"} style={!cluster.k8s_connected ? { background: 'var(--bg-elevated)', border: '1px solid var(--border)' } : {}}>
                 {cluster.k8s_connected ? 'Connected' : 'Disconnected'}
               </div>
               <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {cluster.k8s_connected ? (
                    confirmDisconnect === cluster.id ? (
                      <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11, background: 'var(--warning)', color: 'var(--text-primary)', border: 'none' }} onClick={() => onDisconnect(cluster.id)}>Confirm</button>
                        <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setConfirmDisconnect(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn-icon" title="Disconnect" onClick={(e) => { e.stopPropagation(); setConfirmDisconnect(cluster.id) }}><Unlink size={14} /></button>
                    )
                  ) : (
                    <button className="btn-icon" title="Reconnect" onClick={(e) => { e.stopPropagation(); onReconnect(cluster.id) }}><Globe size={14} /></button>
                  )}
                  
                  {confirmDelete === cluster.id ? (
                    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11, background: 'var(--danger)', color: 'var(--text-inverse)', border: 'none' }} onClick={() => onDelete(cluster.id)}>Confirm</button>
                      <button className="btn btn-secondary" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn-icon" title="Delete" onClick={(e) => { e.stopPropagation(); setConfirmDelete(cluster.id) }} style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                  )}
                  
                  <ChevronRight size={16} color="var(--text-muted)" />
               </div>
            </div>
          </div>
        ))}
        
        {clusters.length === 0 && (
           <div className="empty-state" style={{ gridColumn: '1 / -1', padding: 100 }}>
              <Zap size={48} color="var(--text-muted)" style={{ marginBottom: 20 }} />
              <p>No managed clusters found</p>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Connect your first cluster using a KubeConfig file to begin management.</span>
              <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={onAdd}>Get Started</button>
           </div>
        )}
      </div>
    </div>
  )
})

K8sClusterGrid.displayName = 'K8sClusterGrid'
