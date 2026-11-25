import { ShieldAlert, ShieldCheck, ExternalLink, AlertTriangle } from 'lucide-react'
import { Link } from '@mui/material'
import { TableRow } from '@mui/material'
import { api } from '../api/client'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
import { fmtAgo } from '../utils/fmtAgo'
import { AuditPage, AuditStats, ScanBadge, ScanTargetCard, MetaText, FindingsTable, Cell, TargetList } from '../components/audit/AuditParts'
import { LinuxIcon, DistroIcon } from '../components/OSIcons'
import type { KernelAuditResult } from '../types/audit'

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
  // Kernel scanning needs a live Linux SSH shell — exclude kubeconfig-only
  // clusters and non-Linux hosts (macOS has no comparable kernel CVE surface here).
  return list.filter(s => s.host && !s.has_kubeconfig && s.os !== 'darwin')
}

export function Audit() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand, scannedCount } = useSecurityScan<ServerData, KernelAuditResult>({
    targetType: 'server', scanType: 'kernel', loadTargets: loadServers,
    scanUrl: id => `/api/servers/${id}/audit/kernel`,
    scanErrorMessage: 'Could not run kernel audit',
  })

  const vulnerableServerCount = Object.values(results).filter(r => r.highCount > 0).length

  return (
    <AuditPage
      loading={loading}
      icon={ShieldAlert}
      title="Kernel Vulnerability Scanner"
      description="Cross-references each server's running kernel against known privilege-escalation CVEs, live over SSH."
      notice={<>
        Detections are version-range checks derived from{' '}
        <Link href="https://github.com/gotr00t0day/kernelpwned" target="_blank" rel="noreferrer">kernelpwned</Link>'s
        vulnerability database, not a live CVE feed. Distros frequently backport security fixes without changing
        the reported kernel version, which can produce false positives — treat results as a starting point and
        confirm against your distro's official advisories before acting.
      </>}
    >
      <AuditStats stats={[
        { label: 'Linux Servers', value: targets.length },
        { label: 'Scanned', value: scannedCount },
        { label: 'Flagged', value: vulnerableServerCount, danger: vulnerableServerCount > 0 },
        { label: 'Tracked CVEs', value: 10 },
      ]} />

      <TargetList empty={targets.length === 0 ? { icon: ShieldAlert, text: 'No SSH-connected Linux servers to scan.' } : null}>
        {targets.map(s => {
          const state: ScanState<KernelAuditResult> | undefined = results[s.id]
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
              meta={state && <>
                {state.result?.kernel_version && <MetaText>KERNEL {state.result.kernel_version}</MetaText>}
                {state.scannedAt && <MetaText>{state.cached ? 'LAST SCAN ' : 'SCANNED '}{fmtAgo(state.scannedAt)}</MetaText>}
              </>}
              badge={state && (state.highCount > 0
                ? <ScanBadge tone="error" icon={<AlertTriangle size={12} />}>{state.highCount} flagged</ScanBadge>
                : <ScanBadge tone="success" icon={<ShieldCheck size={12} />}>Clean</ScanBadge>)}
            >
              {state?.result && (
                <FindingsTable columns={['Status', 'CVE', 'Name', 'Detail', 'PoC']}>
                  {(state.result.findings ?? []).map(f => (
                    <TableRow key={f.cve} hover>
                      <Cell><ScanBadge tone={f.vulnerable ? 'error' : 'success'}>{f.vulnerable ? 'Vulnerable' : 'Not Vulnerable'}</ScanBadge></Cell>
                      <Cell mono sx={{ fontWeight: 700 }}>{f.cve}</Cell>
                      <Cell sx={{ fontSize: 13, fontWeight: 600 }}>{f.name}</Cell>
                      <Cell sx={{ color: 'text.secondary', maxWidth: 320 }}>{f.vulnerable ? f.detail : f.description}</Cell>
                      <Cell>
                        <Link href={f.poc_url} target="_blank" rel="noreferrer" aria-label={`PoC for ${f.cve}`} sx={{ display: 'inline-flex' }}>
                          <ExternalLink size={12} />
                        </Link>
                      </Cell>
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
