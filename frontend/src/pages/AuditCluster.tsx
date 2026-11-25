import { Network, AlertTriangle } from 'lucide-react'
import { Box, Typography } from '@mui/material'
import { TableRow } from '@mui/material'
import { api } from '../api/client'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
import { fmtAgo } from '../utils/fmtAgo'
import { severityColor } from '../utils/severityColor'
import { AuditPage, ScanBadge, ScanTargetCard, MetaText, FindingsTable, Cell, TargetList } from '../components/audit/AuditParts'
import { KubernetesIcon } from '../components/OSIcons'
import type { ClusterAuditResult } from '../types/audit'

interface ServerData {
  id: number
  name: string
  host: string
  is_k8s: boolean
  has_kubeconfig?: boolean
  status: string
}

async function loadClusters(): Promise<ServerData[]> {
  const res = await api.get('/api/servers')
  const list: ServerData[] = Array.isArray(res.data) ? res.data : []
  return list.filter(s => s.is_k8s && s.has_kubeconfig)
}

export function AuditCluster() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand } = useSecurityScan<ServerData, ClusterAuditResult>({
    targetType: 'server', scanType: 'cluster', loadTargets: loadClusters,
    scanUrl: id => `/api/servers/${id}/audit/cluster`,
    scanErrorMessage: 'Could not run cluster audit',
  })

  return (
    <AuditPage
      loading={loading}
      icon={Network}
      title="Cluster Security"
      description="Checks workload security context, RBAC bindings, and network exposure across each connected cluster."
      notice={<>
        Findings come from read-only List calls against the cluster API (pods, RBAC bindings, services, network policies).
        The Kubernetes EOL-version check is a point-in-time list, not a live feed — verify against upstream support policy.
      </>}
    >
      <TargetList empty={targets.length === 0 ? { icon: Network, text: 'No connected Kubernetes clusters to scan.' } : null}>
        {targets.map(s => {
          const state: ScanState<ClusterAuditResult> | undefined = results[s.id]
          const findings = state?.result?.findings ?? []
          return (
            <ScanTargetCard
              key={s.id}
              icon={<KubernetesIcon size={18} />}
              name={s.name}
              subtitle={`${s.host || 'kubeconfig'}${state?.result?.server_version ? ` · v${state.result.server_version}` : ''}`}
              scanning={!!scanning[s.id]}
              hasResult={!!state?.result}
              expanded={!!expanded[s.id]}
              onScan={() => scan(s.id)}
              onToggle={() => toggleExpand(s.id)}
              meta={state?.scannedAt && <MetaText>{state.cached ? 'LAST SCAN ' : 'SCANNED '}{fmtAgo(state.scannedAt)}</MetaText>}
              badge={state && (state.highCount > 0
                ? <ScanBadge tone="error" icon={<AlertTriangle size={12} />}>{state.highCount} high</ScanBadge>
                : state.findingCount > 0
                ? <ScanBadge tone="warning">{state.findingCount} findings</ScanBadge>
                : <ScanBadge tone="success">Clean</ScanBadge>)}
            >
              {state?.result && (findings.length === 0 ? (
                <Box sx={{ px: 2.5, py: 2 }}><Typography variant="body2" color="text.secondary">No findings.</Typography></Box>
              ) : (
                <FindingsTable columns={['Severity', 'Category', 'Resource', 'Detail']}>
                  {findings.map((f, i) => (
                    <TableRow key={i} hover>
                      <Cell mono sx={{ textTransform: 'uppercase', fontWeight: 700, color: severityColor(f.severity) }}>{f.severity}</Cell>
                      <Cell sx={{ color: 'text.secondary', textTransform: 'uppercase' }}>{f.category}</Cell>
                      <Cell mono>{f.resource}</Cell>
                      <Cell sx={{ color: 'text.secondary', maxWidth: 420 }}>{f.detail}</Cell>
                    </TableRow>
                  ))}
                </FindingsTable>
              ))}
            </ScanTargetCard>
          )
        })}
      </TargetList>
    </AuditPage>
  )
}
