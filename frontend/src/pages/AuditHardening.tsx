import { Lock, CheckCircle2, XCircle } from 'lucide-react'
import { TableRow } from '@mui/material'
import { api } from '../api/client'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
import { fmtAgo } from '../utils/fmtAgo'
import { severityColor } from '../utils/severityColor'
import { AuditPage, ScanBadge, ScanTargetCard, MetaText, FindingsTable, Cell, TargetList } from '../components/audit/AuditParts'
import { LinuxIcon, DistroIcon } from '../components/OSIcons'
import type { HardeningAuditResult } from '../types/audit'

interface ServerData {
  id: number
  name: string
  host: string
  os: string
  distro?: string
  status: string
  has_kubeconfig?: boolean
}

async function loadServers(): Promise<ServerData[]> {
  const res = await api.get('/api/servers')
  const list: ServerData[] = Array.isArray(res.data) ? res.data : []
  return list.filter(s => s.host && !s.has_kubeconfig && s.os !== 'darwin')
}

export function AuditHardening() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand } = useSecurityScan<ServerData, HardeningAuditResult>({
    targetType: 'server', scanType: 'hardening', loadTargets: loadServers,
    scanUrl: id => `/api/servers/${id}/audit/hardening`,
    scanErrorMessage: 'Could not run hardening audit',
  })

  return (
    <AuditPage
      loading={loading}
      icon={Lock}
      title="Server Hardening"
      description="Checks SSH config, firewall, sudoers, and account posture on each Linux server, live over SSH."
      notice={<>
        Checks are best-effort read-only probes over the existing SSH connection (some, like the empty-password check, need root and degrade gracefully without it).
        "Last scanned" badges reflect the most recent scan on record — click Rescan for a live result.
      </>}
    >
      <TargetList empty={targets.length === 0 ? { icon: Lock, text: 'No SSH-connected Linux servers to scan.' } : null}>
        {targets.map(s => {
          const state: ScanState<HardeningAuditResult> | undefined = results[s.id]
          return (
            <ScanTargetCard
              key={s.id}
              icon={s.distro ? <DistroIcon distro={s.distro} size={18} /> : <LinuxIcon size={18} color="var(--text-primary)" />}
              name={s.name}
              subtitle={s.host}
              scanning={!!scanning[s.id]}
              hasResult={!!state?.result}
              expanded={!!expanded[s.id]}
              onScan={() => scan(s.id)}
              onToggle={() => toggleExpand(s.id)}
              meta={state?.scannedAt && <MetaText>{state.cached ? 'LAST SCAN ' : 'SCANNED '}{fmtAgo(state.scannedAt)}</MetaText>}
              badge={state && (state.highCount > 0
                ? <ScanBadge tone="error">{state.findingCount} failed</ScanBadge>
                : <ScanBadge tone="success">Hardened</ScanBadge>)}
            >
              {state?.result && (
                <FindingsTable columns={['Status', 'Check', 'Severity', 'Detail']}>
                  {(state.result.checks ?? []).map(chk => (
                    <TableRow key={chk.id} hover>
                      <Cell>{chk.passed ? <CheckCircle2 size={15} color="var(--success)" /> : <XCircle size={15} color="var(--danger)" />}</Cell>
                      <Cell sx={{ fontSize: 13, fontWeight: 600 }}>{chk.title}</Cell>
                      <Cell mono sx={{ textTransform: 'uppercase', color: severityColor(chk.severity) }}>{chk.severity}</Cell>
                      <Cell sx={{ color: 'text.secondary', maxWidth: 420 }}>{chk.detail}</Cell>
                    </TableRow>
                  ))}
                </FindingsTable>
              )}
            </ScanTargetCard>
          )
        })}
      </TargetList>
    </AuditPage>
  )
}
