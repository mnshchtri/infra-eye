import { memo } from 'react'
import {
  Server, Boxes, LayoutGrid, Globe,
  FileCode, Key, Database, Activity,
  Shield, HardDrive, Box, Clock,
  Binary, AlertTriangle, RefreshCw, Zap,
  Activity as PulseIcon
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

const Meta = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <b style={{ color: 'var(--text-secondary)', fontFamily: mono ? 'var(--font-mono)' : undefined, fontWeight: 700 }}>{value}</b>
  </span>
)

const StatusBadge = ({ connecting }: { connecting: boolean }) => (
  <span className={connecting ? 'badge badge-warning' : 'badge badge-success'} style={{ gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.03em' }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
    {connecting ? 'Connecting…' : 'Online'}
  </span>
)

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
    <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{children}</h3>
    <div style={{ flex: 1, height: 1, background: 'var(--border)', opacity: 0.5 }} />
  </div>
)

export const PulseDashboard = memo(({ cluster, stats, namespace, error, connecting, onJump, onResync }: PulseDashboardProps) => {
   return (
      <div className="fade-in" style={{ padding: '0 6px', maxWidth: '100%' }}>
         {/* Header */}
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 26 }}>
            <div style={{ minWidth: 0 }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <StatusBadge connecting={connecting} />
                  {stats?.k8sVersion && <span className="badge badge-neutral" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{stats.k8sVersion}</span>}
                  <span className="badge badge-neutral hidden-mobile" style={{ fontSize: 11 }}>Kubernetes engine</span>
               </div>
               <h1 style={{ fontSize: 23, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.25, margin: '0 0 10' }}>
                  {cluster.name}
               </h1>
               <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, lineHeight: 1.4 }}>
                  <Meta label="Host:" value={cluster.host || 'auto'} />
                  <span style={{ opacity: 0.35 }}>•</span>
                  <Meta label="Scope:" value={namespace === 'All' ? 'Cluster scope' : namespace} />
                  <span className="hidden-mobile" style={{ opacity: 0.35 }}>•</span>
                  <span className="hidden-mobile" style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={12} /> Live streaming
                  </span>
               </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={onResync}
              title="Reconnect the live data stream"
              style={{ height: 34, padding: '0 14px', fontWeight: 700, fontSize: 12.5, flexShrink: 0 }}
            >
              <RefreshCw size={13} /> Refresh
            </button>
         </div>

         {error ? (
            <div style={{ border: '1px solid var(--danger)30', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: '48px 32px', textAlign: 'center' }}>
               <Zap size={22} color="var(--danger)" style={{ marginBottom: 14 }} />
               <h2 style={{ fontWeight: 800, fontSize: 16, margin: '0 0 6' }}>Could not reach the cluster</h2>
               <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 18' }}>The real-time stream failed. Check the cluster connection and try again.</p>
               <div style={{ margin: '0 auto 20', maxWidth: 560, padding: 12, background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--font-mono)', textAlign: 'left', wordBreak: 'break-word' }}>
                  {error}
               </div>
               <button className="btn btn-primary" onClick={onResync} style={{ fontWeight: 700 }}>
                  <RefreshCw size={14} /> Reconnect
               </button>
            </div>
         ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
               {stats && (
                  <>
                     {/* Tier 1: Core metrics */}
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 14 }}>
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
                        <section>
                           <SectionTitle>Resource metrics</SectionTitle>
                           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 14 }}>
                              <CapacityCard
                                 label="CPU resources"
                                 allocatable={stats.cpuAllocatable}
                                 usage={stats.cpuUsage}
                                 total={stats.cpuTotal}
                                 unit="m"
                                 color="#2b9af3"
                                 icon={Activity}
                              />
                              <CapacityCard
                                 label="Memory resources"
                                 allocatable={stats.memAllocatable}
                                 usage={stats.memUsage}
                                 total={stats.memTotal}
                                 unit="B"
                                 color="#5ba352"
                                 icon={Box}
                              />
                           </div>
                        </section>
                     )}

                     {/* Tier 3: Resource counts */}
                     <section>
                        <SectionTitle>Resource counts</SectionTitle>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))', gap: 10 }}>
                           <MiniStat label="Services" count={stats.services} icon={Globe} onClick={() => onJump('services')} />
                           <MiniStat label="Endpoints" count={stats.endpoints} icon={Boxes} onClick={() => onJump('endpoints')} />
                           <MiniStat label="Ingresses" count={stats.ingresses} icon={Globe} onClick={() => onJump('ingresses')} />
                           <MiniStat label="ConfigMaps" count={stats.configmaps} icon={FileCode} onClick={() => onJump('configmaps')} />
                           <MiniStat label="Secrets" count={stats.secrets} icon={Key} onClick={() => onJump('secrets')} />
                           <MiniStat label="ResourceQuotas" count={stats.resourcequotas} icon={Shield} onClick={() => onJump('resourcequotas')} />
                           <MiniStat label="HPA" count={stats.hpa} icon={PulseIcon} onClick={() => onJump('hpa')} />
                           <MiniStat label="PVCs" count={stats.pvcs} icon={HardDrive} onClick={() => onJump('pvcs')} />
                           <MiniStat label="PVs" count={stats.pvs} icon={Database} onClick={() => onJump('pvs')} />
                           <MiniStat label="StorageClasses" count={stats.storageclasses} icon={Box} onClick={() => onJump('storageclasses')} />
                           <MiniStat label="Jobs" count={stats.jobs} icon={Zap} onClick={() => onJump('jobs')} />
                           <MiniStat label="CronJobs" count={stats.cronjobs} icon={Binary} onClick={() => onJump('cronjobs')} />
                           <MiniStat
                             label="Warning events" count={stats.eventsWarning} icon={AlertTriangle}
                             color={stats.eventsWarning > 0 ? 'var(--warning)' : undefined}
                             onClick={() => onJump('events')}
                           />
                        </div>
                     </section>
                  </>
               )}
            </div>
         )}
      </div>
   )
})

const PulseStat = memo(({ label, main, total, sub, icon: Icon, color, onClick, loading }: any) => {
   const hasTotal = total > 0;
   const isWarning = hasTotal && main < total;
   const statusColor = isWarning ? 'var(--warning)' : color;

   return (
      <div className="card hover-lift" onClick={onClick} style={{ cursor: 'pointer', padding: 18, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 14 }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
               <div style={{ width: 30, height: 30, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: statusColor, flexShrink: 0 }}>
                  <Icon size={14} strokeWidth={2.2} />
               </div>
               <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            </div>
            {hasTotal && (
               <span className={`badge ${isWarning ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                  {isWarning ? 'Attention' : 'Healthy'}
               </span>
            )}
         </div>

         <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
               {loading ? '—' : (main || 0)}
            </span>
            {hasTotal && (
               <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>/ {loading ? '—' : (total || 0)}</span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sub}</span>
         </div>

         {hasTotal && (
            <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
               <div style={{ height: '100%', width: `${Math.min((main / total) * 100, 100)}%`, background: statusColor, transition: 'width 1s ease' }} />
            </div>
         )}
      </div>
   )
})

const MiniStat = memo(({ label, count, icon: Icon, onClick, color }: any) => (
   <div className="card hover-lift" style={{ cursor: 'pointer', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 10 }} onClick={onClick}>
      <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: color || 'var(--brand-primary)', flexShrink: 0 }}>
         <Icon size={13} strokeWidth={2.2} />
      </div>
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{count || 0}</span>
   </div>
))

const CapacityCard = memo(({ label, allocatable, usage, total, unit, color, icon: Icon }: any) => {
   const formatValue = (v: number, u: string) => {
      if (u === 'B') {
         const gb = v / (1024 * 1024 * 1024);
         return `${gb.toFixed(1)} GiB`;
      }
      if (u === 'm') {
         return `${(v / 1000).toFixed(1)} C`;
      }
      return `${v}${u}`;
   };

   const pct = total > 0 ? (usage && usage > 0 ? (usage / total) * 100 : ((total - allocatable) / total) * 100) : 0;
   const safePct = Number.isFinite(pct) ? pct : 0;
   const displayUsage = (usage && usage > 0) ? usage : ((total - allocatable) || 0);

   return (
      <div className="card" style={{ padding: 18, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <Icon size={14} color={color} strokeWidth={2.2} />
               <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{safePct.toFixed(0)}%</span>
         </div>

         <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {formatValue(displayUsage || 0, unit)} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {formatValue(total || 0, unit)}</span>
         </div>

         <div style={{ height: 5, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginTop: 14 }}>
            <div style={{ height: '100%', width: `${Math.min(safePct, 100)}%`, background: color, borderRadius: 'var(--radius-full)', transition: 'width 1s ease' }} />
         </div>
      </div>
   )
})

PulseStat.displayName = 'PulseStat'
MiniStat.displayName = 'MiniStat'
PulseDashboard.displayName = 'PulseDashboard'
CapacityCard.displayName = 'CapacityCard'
