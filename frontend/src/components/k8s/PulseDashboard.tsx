import { memo } from 'react'
import { 
  Server, Boxes, LayoutGrid, Zap, RefreshCw, Globe, 
  FileCode, Key, Database, Layers, Cpu, Activity, 
  Shield, Hash, Network, HardDrive, Box, Clock, 
  Binary, Activity as PulseIcon
} from 'lucide-react'

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
      <div className="fade-in" style={{ padding: '0 4px', maxWidth: '100%', margin: '0' }}>
         {/* System Header */}
         <div style={{ 
            marginBottom: 32, 
            borderBottom: '1px solid var(--border)', 
            paddingBottom: 24, 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'flex-end',
            gap: 16
         }}>
            <div style={{ flex: 1 }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ 
                    display: 'flex', alignItems: 'center', gap: 6, 
                    background: 'var(--success-glow)', border: '1px solid var(--success)20', 
                    padding: '3px 8px', borderRadius: 0 
                  }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--success)' }} />
                    <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>Online</span>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>
                    STREAM: OK
                  </span>
               </div>
               
               <h1 style={{ 
                 fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', 
                 letterSpacing: '-0.03em', marginBottom: 6, textTransform: 'uppercase'
               }}>
                 {cluster.name}
               </h1>
               
               <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 800 }}>HOST: <span style={{ color: 'var(--text-secondary)' }}>{cluster.host || 'AUTO'}</span></span>
                  <div style={{ width: 1, height: 8, background: 'var(--border)' }} />
                  <span style={{ color: 'var(--text-muted)', fontWeight: 800 }}>ENGINE: <span style={{ color: 'var(--brand-primary)' }}>NATIVE_K8S</span></span>
                  <div style={{ width: 1, height: 8, background: 'var(--border)' }} />
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                     <Clock size={10} color="var(--text-muted)" />
                     <span style={{ color: 'var(--text-muted)', fontWeight: 800 }}>99.9% UPTIME</span>
                  </div>
               </div>
            </div>
         </div>

         {error ? (
            <div className="card" style={{ padding: '60px 40px', textAlign: 'center', border: '1px solid var(--danger)30', borderRadius: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--bg-card)' }}>
               <Zap size={24} color="var(--danger)" style={{ marginBottom: 20 }} />
               <h2 style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: 18, letterSpacing: '-0.02em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Link Fault Detect</h2>
               <div style={{ marginTop: 20, padding: '16px', background: 'var(--bg-app)', border: '1px solid var(--border)', fontSize: 10, color: 'var(--danger)', fontFamily: 'var(--font-mono)', width: '100%', maxWidth: 600, textAlign: 'left' }}>
                  {error}
               </div>
               <button className="btn btn-primary" onClick={onResync} style={{ marginTop: 24, padding: '10px 24px', borderRadius: 0, fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)' }}>REINITIALIZE</button>
            </div>
         ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
               {stats && (
                  <>
                     {/* Tier 1: Compact Core Metrics */}
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                        <PulseStat
                           label="Nodes" main={stats.nodesReady || 0} total={stats.nodes || 0} sub="Ready"
                           icon={Server} color="var(--info)" onClick={() => onJump('nodes')} loading={connecting}
                        />
                        <PulseStat
                           label="Pods" main={stats.podsRunning || 0} total={stats.pods || 0} sub="Running"
                           icon={Boxes} color="var(--brand-primary)" onClick={() => onJump('pods')} loading={connecting}
                        />
                        <PulseStat
                           label="Deployments" main={stats.deploymentsReady || 0} total={stats.deployments || 0} sub="Healthy"
                           icon={LayoutGrid} color="var(--success)" onClick={() => onJump('deployments')} loading={connecting}
                        />
                     </div>

                     {/* Tier 2: Consumption */}
                     {(stats.cpuTotal > 0 || stats.memTotal > 0) && (
                        <div>
                           <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                              <h3 style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', fontFamily: 'var(--font-mono)' }}>Resource Metrics</h3>
                              <div style={{ flex: 1, height: 1, background: 'var(--border)', opacity: 0.3 }} />
                           </div>
                           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                               <CapacityCard
                                 label="CPU Resources"
                                 allocatable={stats.cpuAllocatable}
                                 usage={stats.cpuUsage}
                                 total={stats.cpuTotal}
                                 unit="m"
                                 color="#3b82f6"
                                 icon={Activity}
                              />
                              <CapacityCard
                                 label="Memory Resources"
                                 allocatable={stats.memAllocatable}
                                 usage={stats.memUsage}
                                 total={stats.memTotal}
                                 unit="B"
                                 color="#f59e0b"
                                 icon={HardDrive}
                              />
                              <CapacityCard
                                 label="Ephemeral Disk"
                                 allocatable={stats.diskAllocatable}
                                 usage={stats.diskUsage}
                                 total={stats.diskTotal}
                                 unit="B"
                                 color="#10b981"
                                 icon={Database}
                              />
                           </div>
                        </div>
                     )}

                     {/* Tier 3: Workloads */}
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                        <PulseStat
                           label="ReplicaSets" main={stats.replicasetsReady || 0} total={stats.replicasets || 0} sub="Nominal"
                           icon={Layers} color="#6366f1" onClick={() => onJump('replicasets')} loading={connecting} small
                        />
                        <PulseStat
                           label="StatefulSets" main={stats.statefulsetsReady || 0} total={stats.statefulsets || 0} sub="Nominal"
                           icon={Database} color="#ec4899" onClick={() => onJump('statefulsets')} loading={connecting} small
                        />
                        <PulseStat
                           label="DaemonSets" main={stats.daemonsetsReady || 0} total={stats.daemonsets || 0} sub="Nominal"
                           icon={Cpu} color="#06b6d4" onClick={() => onJump('daemonsets')} loading={connecting} small
                        />
                     </div>

                     {/* Tier 4: Compact Inventory */}
                     <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                           <h3 style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', fontFamily: 'var(--font-mono)' }}>Inventory Dash</h3>
                           <div style={{ flex: 1, height: 1, background: 'var(--border)', opacity: 0.3 }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                           <MiniStat label="Services" count={stats.services} icon={Network} onClick={() => onJump('services')} />
                           <MiniStat label="Ingresses" count={stats.ingresses} icon={Globe} onClick={() => onJump('ingresses')} />
                           <MiniStat label="ConfigMaps" count={stats.configmaps} icon={FileCode} onClick={() => onJump('configmaps')} />
                           <MiniStat label="Secrets" count={stats.secrets} icon={Key} onClick={() => onJump('secrets')} />
                           <MiniStat label="PVCs" count={stats.pvcs} icon={HardDrive} onClick={() => onJump('pvcs')} />
                           <MiniStat label="CronJobs" count={stats.cronjobs} icon={Binary} onClick={() => onJump('cronjobs')} />
                        </div>
                     </div>
                  </>
               )}
            </div>
         )}
      </div>
   )
})

const CapacityCard = memo(({ label, allocatable, usage, total, unit, color, icon: Icon }: any) => {
   const formatValue = (v: number, u: string) => {
      if (u === 'B') {
         const gb = v / (1024 * 1024 * 1024);
         return `${gb.toFixed(1)} GB`;
      }
      if (u === 'm') {
         return `${(v / 1000).toFixed(1)}C`;
      }
      return `${v}${u}`;
   };

   const pct = total > 0 ? (usage && usage > 0 ? (usage / total) * 100 : ((total - allocatable) / total) * 100) : 0;
   const displayUsage = usage && usage > 0 ? usage : (total - allocatable);

   return (
      <div className="card" style={{ padding: 16, border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 0 }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <Icon size={12} color={color} />
               <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>{label}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 900, color, fontFamily: 'var(--font-mono)' }}>{pct.toFixed(0)}%</div>
         </div>
         
         <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
            {formatValue(displayUsage, unit)} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/ {formatValue(total, unit)}</span>
         </div>
         
         <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 0, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ 
               height: '100%', 
               width: `${Math.min(pct, 100)}%`, 
               background: color, 
               transition: 'width 1.5s cubic-bezier(0.4, 0, 0.2, 1)'
            }} />
         </div>

         <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
            {usage && usage > 0 ? "STREAM_ACTIVE" : "ESTIMATED_VAL"} • AVAIL: {formatValue(allocatable, unit)}
         </div>
      </div>
   )
})

const PulseStat = memo(({ label, main, total, sub, icon: Icon, color, onClick, loading, small }: any) => {
   const isWarning = total > 0 && main < total;
   const statusColor = isWarning ? 'var(--warning)' : color;
   
   return (
      <div className="card hover-lift" style={{ 
         cursor: 'pointer', padding: 18, display: 'flex', flexDirection: 'column', borderRadius: 0,
         border: '1px solid var(--border)', background: 'var(--bg-card)'
      }} onClick={onClick}>
         
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ 
               width: 32, height: 32, borderRadius: 0, background: 'var(--bg-elevated)', 
               border: '1px solid var(--border)', display: 'flex', alignItems: 'center', 
               justifyContent: 'center', color: statusColor
            }}>
               <Icon size={14} strokeWidth={2.5} />
            </div>
            <div style={{ textAlign: 'right' }}>
               <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>{label}</div>
               <div style={{ fontSize: 8, fontWeight: 900, color: statusColor, textTransform: 'uppercase' }}>
                  {isWarning ? 'ALERT' : 'OK'}
               </div>
            </div>
         </div>

         <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
               {loading ? '—' : (main || 0)}
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
               / {loading ? '—' : (total || 0)}
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 900, color: 'var(--text-secondary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
               {sub}
            </div>
         </div>

         <div style={{ height: 3, background: 'var(--bg-elevated)', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${total > 0 ? (main / total) * 100 : 0}%`, background: statusColor, transition: 'width 1.5s ease-out' }} />
         </div>
      </div>
   )
})

const MiniStat = memo(({ label, count, icon: Icon, onClick }: any) => (
   <div className="card hover-lift" style={{ 
      cursor: 'pointer', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, 
      border: '1px solid var(--border)', borderRadius: 0, background: 'var(--bg-card)'
   }} onClick={onClick}>
      <div style={{ color: 'var(--brand-primary)', opacity: 0.8 }}>
         <Icon size={12} />
      </div>
      <div style={{ flex: 1, fontSize: 10, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.02em', fontFamily: 'var(--font-mono)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{count || 0}</div>
   </div>
))

PulseStat.displayName = 'PulseStat'
PulseDashboard.displayName = 'PulseDashboard'
MiniStat.displayName = 'MiniStat'
CapacityCard.displayName = 'CapacityCard'
