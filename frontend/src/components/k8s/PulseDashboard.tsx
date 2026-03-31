import { memo } from 'react'
import { Server, Boxes, LayoutGrid, Zap, RefreshCw, Globe, FileCode, Key, Database, Layers, Cpu, Activity, Shield } from 'lucide-react'

interface PulseDashboardProps {
  cluster: any;
  stats: any;
  namespace: string;
  error: string | null;
  connecting: boolean;
  onJump: (r: any) => void;
  onResync: () => void;
}

export const PulseDashboard = memo(({ cluster, stats, namespace, error, connecting, onJump, onResync }: PulseDashboardProps) => {
  return (
    <div className="fade-in">
       <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{cluster.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
               <div className="badge badge-online" style={{ padding: '4px 8px', fontSize: 10 }}>Connected</div>
               <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>{cluster.host} • K8s Native Engine</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--brand-glow)', padding: '6px 16px', borderRadius: 10, border: '1px solid var(--brand-primary)20' }}>
               <Globe size={14} color="var(--brand-primary)" />
               <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--brand-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {namespace === 'All' ? 'All Namespaces' : `Namespace: ${namespace}`}
               </span>
            </div>
            <button className="btn btn-secondary" onClick={onResync} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, width: '100%', justifyContent: 'center' }}>
              <RefreshCw size={14} className={connecting ? 'spin' : ''} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>{connecting ? 'Syncing...' : 'Refresh'}</span>
            </button>
          </div>
       </div>

       {error ? (
         <div className="card" style={{ padding: 40, textAlign: 'center', border: '1px solid var(--error-glow)', background: 'var(--error-glow)' }}>
            <div style={{ color: 'var(--danger)', marginBottom: 16 }}>
               <Zap size={40} />
            </div>
            <h3 style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Telemetry Link Broken</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, maxWidth: 560, margin: '8px auto', fontFamily: 'var(--font-mono)', padding: '12px 16px', borderRadius: 8, textAlign: 'left', wordBreak: 'break-all', background: 'rgba(0,0,0,0.05)' }}>
               {error}
            </p>
            <button className="btn btn-primary" onClick={onResync} style={{ marginTop: 24 }}>Re-establish Connection</button>
         </div>
       ) : (
         <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
            {/* Core Infrastructure Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
               <PulseStat 
                  label="Nodes" main={stats.nodesReady || 0} total={stats.nodes || 0} sub="Ready" 
                  icon={Server} color="#10b981" onClick={() => onJump('nodes')} loading={connecting}
               />
               <PulseStat 
                  label="Pods" main={stats.podsRunning || 0} total={stats.pods || 0} sub="Running" 
                  icon={Boxes} color="#6366f1" onClick={() => onJump('pods')} loading={connecting}
               />
               <PulseStat 
                  label="Deployments" main={stats.deploymentsReady || 0} total={stats.deployments || 0} sub="Available" 
                  icon={LayoutGrid} color="#8b5cf6" onClick={() => onJump('deployments')} loading={connecting}
               />
            </div>

            {/* Workload Health Grid */}
            <div>
               <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>Workload Health</h3>
               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                  <PulseStat 
                    label="ReplicaSets" main={stats.replicasetsReady || 0} total={stats.replicasets || 0} sub="Ready"
                    icon={Layers} color="#f59e0b" onClick={() => onJump('replicasets')} loading={connecting} small
                  />
                  <PulseStat 
                    label="StatefulSets" main={stats.statefulsetsReady || 0} total={stats.statefulsets || 0} sub="Ready"
                    icon={Database} color="#ec4899" onClick={() => onJump('statefulsets')} loading={connecting} small
                  />
                  <PulseStat 
                    label="DaemonSets" main={stats.daemonsetsReady || 0} total={stats.daemonsets || 0} sub="Ready"
                    icon={Cpu} color="#06b6d4" onClick={() => onJump('daemonsets')} loading={connecting} small
                  />
               </div>
            </div>

            {/* Network, Config & Storage Grid */}
            <div>
               <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>Cluster Inventory</h3>
               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  <MiniStat label="Services" count={stats.services} icon={Globe} onClick={() => onJump('services')} />
                  <MiniStat label="Ingresses" count={stats.ingresses} icon={Globe} onClick={() => onJump('ingresses')} />
                  <MiniStat label="Endpoints" count={stats.endpoints} icon={Activity} onClick={() => onJump('endpoints')} />
                  <MiniStat label="ConfigMaps" count={stats.configmaps} icon={FileCode} onClick={() => onJump('configmaps')} />
                  <MiniStat label="Secrets" count={stats.secrets} icon={Key} onClick={() => onJump('secrets')} />
                  <MiniStat label="PVCs" count={stats.pvcs} icon={Database} onClick={() => onJump('pvcs')} />
                  <MiniStat label="PersistentVolumes" count={stats.pvs} icon={Database} onClick={() => onJump('pvs')} />
                  <MiniStat label="StorageClasses" count={stats.storageclasses} icon={Layers} onClick={() => onJump('storageclasses')} />
                  <MiniStat label="ResourceQuotas" count={stats.resourcequotas} icon={Shield} onClick={() => onJump('resourcequotas')} />
                  <MiniStat label="HPA" count={stats.hpa} icon={Activity} onClick={() => onJump('hpa')} />
                  <MiniStat label="CronJobs" count={stats.cronjobs} icon={Activity} onClick={() => onJump('cronjobs')} />
               </div>
            </div>
         </div>
       )}
    </div>
  )
})

PulseDashboard.displayName = 'PulseDashboard'

const PulseStat = memo(({ label, main, total, sub, icon: Icon, color, onClick, loading, small }: any) => {
  const isWarning = total > 0 && main < total;
  const statusColor = isWarning ? '#f59e0b' : color;
  const padding = small ? '24px' : '32px';

  return (
    <div className="card hover-lift" style={{ cursor: 'pointer', padding, display: 'flex', flexDirection: 'column', gap: small ? 16 : 24, border: `1px solid ${statusColor}15`, background: `linear-gradient(145deg, var(--bg-card), ${statusColor}05)` }} onClick={onClick}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ width: small ? 40 : 48, height: small ? 40 : 48, borderRadius: 14, background: `${statusColor}15`, color: statusColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
             <Icon size={small ? 20 : 24} />
          </div>
          <div style={{ textAlign: 'right' }}>
             <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
             <div style={{ fontSize: 10, fontWeight: 700, color: statusColor }}>{isWarning ? 'Needs Attention' : 'Healthy'}</div>
          </div>
       </div>

       <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: small ? 32 : 44, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{loading ? '—' : (main || 0)}</div>
          <div style={{ fontSize: small ? 14 : 18, fontWeight: 700, color: 'var(--text-muted)' }}>/ {loading ? '—' : (total || 0)}</div>
          <div style={{ marginLeft: 'auto', fontSize: small ? 11 : 13, fontWeight: 700, color: 'var(--text-secondary)' }}>{sub}</div>
       </div>

       <div style={{ height: 6, background: 'var(--bg-app)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${total > 0 ? (main / total) * 100 : 0}%`, background: statusColor, transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)' }} />
       </div>
    </div>
  )
})

const MiniStat = memo(({ label, count, icon: Icon, onClick }: any) => (
   <div className="card hover-lift" style={{ cursor: 'pointer', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)' }} onClick={onClick}>
      <div style={{ color: 'var(--brand-primary)', opacity: 0.7 }}>
         <Icon size={16} />
      </div>
      <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--brand-primary)' }}>{count || 0}</div>
   </div>
))

PulseStat.displayName = 'PulseStat'
PulseDashboard.displayName = 'PulseDashboard'
