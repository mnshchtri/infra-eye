import { KeyRound, CheckCircle2, XCircle, Database } from 'lucide-react'
import { TableRow } from '@mui/material'
import { api } from '../api/client'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
import { fmtAgo } from '../utils/fmtAgo'
import { severityColor } from '../utils/severityColor'
import { AuditPage, ScanBadge, ScanTargetCard, MetaText, FindingsTable, Cell, TargetList } from '../components/audit/AuditParts'
import type { ResourceAuditResult } from '../types/audit'

interface ResourceData {
  id: number
  name: string
  host: string
  port: number
  protocol: string
  resource_type: string
  auth_type: string
}

async function loadResources(): Promise<ResourceData[]> {
  const res = await api.get('/api/resources')
  return Array.isArray(res.data) ? res.data : []
}

export function AuditResources() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand } = useSecurityScan<ResourceData, ResourceAuditResult>({
    targetType: 'resource', scanType: 'resource', loadTargets: loadResources,
    scanUrl: id => `/api/resources/${id}/audit/security`,
    scanErrorMessage: 'Could not run resource audit',
  })

  return (
    <AuditPage
      loading={loading}
      icon={KeyRound}
      title="Resource Security"
      description="Checks gateway exposure, configured auth, and TLS posture for each cataloged database/HTTP/TCP resource."
      notice="Passive checks only — a TCP dial and, for HTTPS resources, a TLS handshake to read the certificate. No credentials are guessed or submitted."
    >
      <TargetList empty={targets.length === 0 ? { icon: Database, text: 'No resources to scan.' } : null}>
        {targets.map(r => {
          const state: ScanState<ResourceAuditResult> | undefined = results[r.id]
          return (
            <ScanTargetCard
              key={r.id}
              icon={<Database size={18} />}
              name={r.name}
              subtitle={`${r.protocol}://${r.host}:${r.port}`}
              scanning={!!scanning[r.id]}
              hasResult={!!state?.result}
              expanded={!!expanded[r.id]}
              onScan={() => scan(r.id)}
              onToggle={() => toggleExpand(r.id)}
              meta={state?.scannedAt && <MetaText>{state.cached ? 'LAST SCAN ' : 'SCANNED '}{fmtAgo(state.scannedAt)}</MetaText>}
              badge={state && (state.highCount > 0
                ? <ScanBadge tone="error">{state.findingCount} failed</ScanBadge>
                : <ScanBadge tone="success">Clean</ScanBadge>)}
            >
              {state?.result && (
                <FindingsTable columns={['Status', 'Check', 'Severity', 'Detail']}>
                  {(state.result.findings ?? []).map((f, i) => (
                    <TableRow key={i} hover>
                      <Cell>{f.passed ? <CheckCircle2 size={15} color="var(--success)" /> : <XCircle size={15} color="var(--danger)" />}</Cell>
                      <Cell mono sx={{ fontSize: 13, fontWeight: 600 }}>{f.check}</Cell>
                      <Cell mono sx={{ textTransform: 'uppercase', color: severityColor(f.severity) }}>{f.severity}</Cell>
                      <Cell sx={{ color: 'text.secondary', maxWidth: 420 }}>{f.detail}</Cell>
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
