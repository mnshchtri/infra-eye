import {
  KeyRound, Loader2, RefreshCw, ChevronDown, ChevronUp, Info, CheckCircle2, XCircle, Database
} from 'lucide-react'
import { api } from '../api/client'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
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

function fmtAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function AuditResources() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand } = useSecurityScan<ResourceData, ResourceAuditResult>({
    targetType: 'resource', scanType: 'resource', loadTargets: loadResources,
    scanUrl: id => `/api/resources/${id}/audit/security`,
    scanErrorMessage: 'Could not run resource audit',
  })

  if (loading) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', paddingBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <KeyRound size={22} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4 }}>
              Resource Security
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Checks gateway exposure, configured auth, and TLS posture for each cataloged database/HTTP/TCP resource.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 24, flexShrink: 0, padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <Info size={13} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Passive checks only — a TCP dial and, for HTTPS resources, a TLS handshake to read the certificate. No credentials are guessed or submitted.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }} className="fade-up">
        {targets.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center' }}>
            <Database size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>No resources to scan.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {targets.map(r => {
              const state: ScanState<ResourceAuditResult> | undefined = results[r.id]
              const isScanning = !!scanning[r.id]
              const isExpanded = !!expanded[r.id]

              return (
                <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 0, flexShrink: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Database size={18} color="var(--text-primary)" />
                    </div>

                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{r.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.protocol}://{r.host}:{r.port}</div>
                    </div>

                    {state && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {state.scannedAt && (
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {state.cached ? 'LAST SCAN ' : 'SCANNED '}{fmtAgo(state.scannedAt)}
                          </span>
                        )}
                        {state.highCount > 0 ? (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--danger)18', color: 'var(--danger)', border: '1px solid var(--danger)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {state.findingCount} FAILED
                          </span>
                        ) : (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--success)18', color: 'var(--success)', border: '1px solid var(--success)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            CLEAN
                          </span>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                      <button className="btn btn-secondary" onClick={() => scan(r.id)} disabled={isScanning} style={{ gap: 8, padding: '8px 14px' }}>
                        {isScanning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
                        <span>{state?.result ? 'Rescan' : 'Scan'}</span>
                      </button>
                      {state?.result && (
                        <button onClick={() => toggleExpand(r.id)} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px 10px' }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {state?.result && isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['Status', 'Check', 'Severity', 'Detail'].map(h => (
                              <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {state.result.findings.map((f, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '10px 16px' }}>
                                {f.passed
                                  ? <CheckCircle2 size={15} color="var(--success)" />
                                  : <XCircle size={15} color="var(--danger)" />}
                              </td>
                              <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{f.check}</td>
                              <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: f.severity === 'high' ? 'var(--danger)' : f.severity === 'medium' ? 'var(--warning)' : 'var(--text-muted)' }}>
                                {f.severity}
                              </td>
                              <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 420 }}>{f.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
