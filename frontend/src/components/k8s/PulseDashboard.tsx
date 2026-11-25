import { memo } from 'react'
import {
  Server, Boxes, LayoutGrid, Globe,
  FileCode, Key, Database, Activity,
  Shield, HardDrive, Box as BoxIcon, Clock,
  Binary, AlertTriangle, RefreshCw, Zap,
  Activity as PulseIcon
} from 'lucide-react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { Button } from '../ui/Button'
import { PageHeader } from '../ui/PageHeader'
import type { ResourceType } from './K8sResourceExplorer'
import type { IconComponent } from '../../types/k8s'

/** The `stats` block of the Pulse websocket frame (see sendNativeFrame). */
export interface PulseStats {
   k8sVersion?: string
   nodes: number; nodesReady: number
   pods: number; podsRunning: number
   deployments: number; deploymentsReady: number
   replicasets: number; replicasetsReady: number
   statefulsets: number; statefulsetsReady: number
   daemonsets: number; daemonsetsReady: number
   jobs: number; cronjobs: number
   services: number; endpoints: number; ingresses: number
   configmaps: number; secrets: number
   pvs: number; pvcs: number; storageclasses: number
   resourcequotas: number; hpa: number; namespaces: number
   eventsWarning: number
   cpuTotal: number; cpuAllocatable: number; cpuUsage: number
   memTotal: number; memAllocatable: number; memUsage: number
   diskTotal: number; diskAllocatable: number; diskUsage: number
}

interface PulseDashboardProps {
   cluster: { id: number; name: string; host?: string };
   stats: PulseStats | null;
   namespace: string;
   error: string | null;
   // Per-resource failures from a reachable cluster — a credential scoped to
   // some namespaces, or an API group the cluster doesn't serve. The counts
   // for these are zero because the lookup failed, not because they're empty,
   // so they must not be shown as ordinary zeroes.
   partialErrors: Record<string, string> | null;
   connecting: boolean;
   onJump: (r: ResourceType) => void;
   onResync: () => void;
}

type Tone = 'primary' | 'info' | 'success' | 'warning' | 'error'

const Meta = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
    <Typography component="span" variant="body2" color="text.secondary">{label}</Typography>
    <Typography component="span" variant="body2" sx={{ fontWeight: 600, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value}</Typography>
  </Box>
)

const StatusBadge = ({ connecting, error, degraded }: { connecting: boolean; error: boolean; degraded: boolean }) => {
  // Reachability outranks everything: reporting "Online" next to a screen of
  // zeroes, when the zeroes exist because the cluster never answered, is the
  // one state this badge must never show.
  const color = error ? 'error' : connecting || degraded ? 'warning' : 'success'
  const label = error ? 'Unreachable' : connecting ? 'Connecting…' : degraded ? 'Partial access' : 'Online'
  return <Chip size="small" color={color} label={label} />
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="subtitle2" component="h3" color="text.secondary" sx={{ mb: 1.5 }}>{children}</Typography>
)

export const PulseDashboard = memo(({ cluster, stats, namespace, error, partialErrors, connecting, onJump, onResync }: PulseDashboardProps) => {
   const failed = partialErrors ? Object.keys(partialErrors) : []
   const degraded = failed.length > 0
   return (
      <Box sx={{ maxWidth: '100%' }}>
         <PageHeader
            title={cluster.name}
            actions={
               <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} onClick={onResync} title="Reconnect the live data stream">Refresh</Button>
            }
         />
         <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: -1, mb: 3, flexWrap: 'wrap' }}>
            <StatusBadge connecting={connecting} error={!!error} degraded={degraded} />
            {stats?.k8sVersion && <Chip size="small" variant="outlined" label={stats.k8sVersion} sx={{ fontFamily: 'var(--font-mono)' }} />}
            <Meta label="Host" value={cluster.host || 'auto'} />
            <Meta label="Scope" value={namespace === 'All' ? 'Cluster scope' : namespace} />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' }, alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
               <Clock size={12} /> <Typography component="span" variant="body2">Live streaming</Typography>
            </Box>
         </Box>

         {error ? (
            <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
               <Box sx={{ color: 'error.main', mb: 1.5 }}><Zap size={22} /></Box>
               <Typography variant="h6" component="h2">Could not reach the cluster</Typography>
               <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>The real-time stream failed. Check the cluster connection and try again.</Typography>
               <Alert severity="error" sx={{ mx: 'auto', mb: 2.5, maxWidth: 560, textAlign: 'left', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                  {error}
               </Alert>
               <Button icon={<RefreshCw size={14} />} onClick={onResync}>Reconnect</Button>
            </Card>
         ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
               {degraded && (
                  <Alert severity="warning" icon={<AlertTriangle size={16} />}>
                     <b>Some resources could not be read.</b>{' '}
                     Counts below show 0 for {failed.join(', ')} because the lookup failed, not because none exist.
                     <Box sx={{ mt: 0.75, fontSize: 11.5, color: 'text.secondary', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                        {partialErrors && partialErrors[failed[0]]}
                     </Box>
                  </Alert>
               )}
               {stats && (
                  <>
                     <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 1.5 }}>
                        <PulseStat
                           label="Nodes" main={stats.nodesReady || 0} total={stats.nodes || 0} sub="Ready"
                           icon={Server} tone="info" onClick={() => onJump('nodes')} loading={connecting}
                        />
                        <PulseStat
                           label="Pods" main={stats.podsRunning || 0} total={stats.pods || 0} sub="Running"
                           icon={Boxes} tone="primary" onClick={() => onJump('pods')} loading={connecting}
                        />
                        <PulseStat
                           label="Deployments" main={stats.deploymentsReady || 0} total={stats.deployments || 0} sub="Healthy"
                           icon={LayoutGrid} tone="success" onClick={() => onJump('deployments')} loading={connecting}
                        />
                     </Box>

                     {(stats.cpuTotal > 0 || stats.memTotal > 0) && (
                        <section>
                           <SectionTitle>Resource metrics</SectionTitle>
                           <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 1.5 }}>
                              <CapacityCard
                                 label="CPU resources"
                                 allocatable={stats.cpuAllocatable}
                                 usage={stats.cpuUsage}
                                 total={stats.cpuTotal}
                                 unit="m"
                                 tone="info"
                                 icon={Activity}
                              />
                              <CapacityCard
                                 label="Memory resources"
                                 allocatable={stats.memAllocatable}
                                 usage={stats.memUsage}
                                 total={stats.memTotal}
                                 unit="B"
                                 tone="success"
                                 icon={BoxIcon}
                              />
                           </Box>
                        </section>
                     )}

                     <section>
                        <SectionTitle>Resource counts</SectionTitle>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px, 100%), 1fr))', gap: 1.25 }}>
                           <MiniStat label="Services" count={stats.services} icon={Globe} onClick={() => onJump('services')} />
                           <MiniStat label="Endpoints" count={stats.endpoints} icon={Boxes} onClick={() => onJump('endpoints')} />
                           <MiniStat label="Ingresses" count={stats.ingresses} icon={Globe} onClick={() => onJump('ingresses')} />
                           <MiniStat label="ConfigMaps" count={stats.configmaps} icon={FileCode} onClick={() => onJump('configmaps')} />
                           <MiniStat label="Secrets" count={stats.secrets} icon={Key} onClick={() => onJump('secrets')} />
                           <MiniStat label="ResourceQuotas" count={stats.resourcequotas} icon={Shield} onClick={() => onJump('resourcequotas')} />
                           <MiniStat label="HPA" count={stats.hpa} icon={PulseIcon} onClick={() => onJump('hpa')} />
                           <MiniStat label="PVCs" count={stats.pvcs} icon={HardDrive} onClick={() => onJump('pvcs')} />
                           <MiniStat label="PVs" count={stats.pvs} icon={Database} onClick={() => onJump('pvs')} />
                           <MiniStat label="StorageClasses" count={stats.storageclasses} icon={BoxIcon} onClick={() => onJump('storageclasses')} />
                           <MiniStat label="Jobs" count={stats.jobs} icon={Zap} onClick={() => onJump('jobs')} />
                           <MiniStat label="CronJobs" count={stats.cronjobs} icon={Binary} onClick={() => onJump('cronjobs')} />
                           <MiniStat
                             label="Warning events" count={stats.eventsWarning} icon={AlertTriangle}
                             tone={stats.eventsWarning > 0 ? 'warning' : undefined}
                             onClick={() => onJump('events')}
                           />
                        </Box>
                     </section>
                  </>
               )}
            </Box>
         )}
      </Box>
   )
})

const PulseStat = memo(({ label, main, total, sub, icon: Icon, tone, onClick, loading }: {
   label: string; main: number; total: number; sub: string;
   icon: IconComponent; tone: Tone; onClick: () => void; loading: boolean;
 }) => {
   const hasTotal = total > 0;
   const isWarning = hasTotal && main < total;
   const statusTone: Tone = isWarning ? 'warning' : tone;

   return (
      <Card variant="outlined">
         <CardActionArea onClick={onClick} sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: 1, bgcolor: 'action.selected', display: 'grid', placeItems: 'center', color: `${statusTone}.main`, flexShrink: 0 }}>
                     <Icon size={15} />
                  </Box>
                  <Typography variant="subtitle2" noWrap>{label}</Typography>
               </Box>
               {hasTotal && <Chip size="small" color={isWarning ? 'warning' : 'success'} label={isWarning ? 'Attention' : 'Healthy'} />}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
               <Typography component="span" sx={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                  {loading ? '—' : (main || 0)}
               </Typography>
               {hasTotal && (
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>/ {loading ? '—' : (total || 0)}</Typography>
               )}
               <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{sub}</Typography>
            </Box>

            {hasTotal && (
               <LinearProgress variant="determinate" color={statusTone} value={Math.min((main / total) * 100, 100)} sx={{ height: 4, borderRadius: 2 }} />
            )}
         </CardActionArea>
      </Card>
   )
})

const MiniStat = memo(({ label, count, icon: Icon, onClick, tone }: {
   label: string; count: number; icon: IconComponent; onClick: () => void; tone?: Tone;
 }) => (
   <Card variant="outlined">
      <CardActionArea onClick={onClick} sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25 }}>
         <Box sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: 'action.selected', display: 'grid', placeItems: 'center', color: `${tone ?? 'primary'}.main`, flexShrink: 0 }}>
            <Icon size={14} />
         </Box>
         <Typography variant="body2" noWrap sx={{ flex: 1 }}>{label}</Typography>
         <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: tone ? `${tone}.main` : 'text.primary' }}>{count || 0}</Typography>
      </CardActionArea>
   </Card>
))

const CapacityCard = memo(({ label, allocatable, usage, total, unit, tone, icon: Icon }: {
   label: string; allocatable: number; usage: number; total: number;
   unit: string; tone: Tone; icon: IconComponent;
 }) => {
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
      <Card variant="outlined" sx={{ p: 2 }}>
         <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: `${tone}.main` }}>
               <Icon size={15} />
               <Typography variant="subtitle2" color="text.primary">{label}</Typography>
            </Box>
            <Typography variant="subtitle1" sx={{ fontFamily: 'var(--font-mono)', color: `${tone}.main` }}>{safePct.toFixed(0)}%</Typography>
         </Box>

         <Typography sx={{ fontSize: 19, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {formatValue(displayUsage || 0, unit)} <Typography component="span" variant="body2" color="text.secondary">/ {formatValue(total || 0, unit)}</Typography>
         </Typography>

         <LinearProgress variant="determinate" color={tone} value={Math.min(safePct, 100)} sx={{ height: 5, borderRadius: 3, mt: 1.5 }} />
      </Card>
   )
})

PulseStat.displayName = 'PulseStat'
MiniStat.displayName = 'MiniStat'
PulseDashboard.displayName = 'PulseDashboard'
CapacityCard.displayName = 'CapacityCard'
