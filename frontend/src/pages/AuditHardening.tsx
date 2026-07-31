import {
  Lock, Loader2, RefreshCw, ChevronDown, ChevronUp, Info, CheckCircle2, XCircle
} from 'lucide-react'
import { api } from '../api/client'
import { LinuxIcon, DistroIcon } from '../components/OSIcons'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
import type { HardeningAuditResult } from '../types/audit'

interface ServerData {
  id: number
  name: string
  host: string
  os: string
  distro?: string
  status: string
  kube_config?: string
}

async function loadServers(): Promise<ServerData[]> {
  const res = await api.get('/api/servers')
  const list: ServerData[] = Array.isArray(res.data) ? res.data : []
  return list.filter(s => s.host && !s.kube_config && s.os !== 'darwin')
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

export function AuditHardening() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand } = useSecurityScan<ServerData, HardeningAuditResult>({
    targetType: 'server', scanType: 'hardening', loadTargets: loadServers,
    scanUrl: id => `/api/servers/${id}/audit/hardening`,
    scanErrorMessage: 'Could not run hardening audit',
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
            <Lock size={22} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4 }}>
              Server Hardening
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Checks SSH config, firewall, sudoers, and account posture on each Linux server, live over SSH.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 24, flexShrink: 0, padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <Info size={13} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Checks are best-effort read-only probes over the existing SSH connection (some, like the empty-password check, need root and degrade gracefully without it).
          "Last scanned" badges reflect the most recent scan on record — click Rescan for a live result.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }} className="fade-up">
        {targets.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center' }}>
            <Lock size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>No SSH-connected Linux servers to scan.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {targets.map(s => {
              const state: ScanState<HardeningAuditResult> | undefined = results[s.id]
              const isScanning = !!scanning[s.id]
              const isExpanded = !!expanded[s.id]

              return (
                <div key={s.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 0, flexShrink: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {s.distro ? <DistroIcon distro={s.distro} size={18} /> : <LinuxIcon size={18} color="var(--text-primary)" />}
                    </div>

                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.host}</div>
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
                            HARDENED
                          </span>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                      <button className="btn btn-secondary" onClick={() => scan(s.id)} disabled={isScanning} style={{ gap: 8, padding: '8px 14px' }}>
                        {isScanning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
                        <span>{state?.result ? 'Rescan' : 'Scan'}</span>
                      </button>
                      {state?.result && (
                        <button onClick={() => toggleExpand(s.id)} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px 10px' }}>
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
                          {state.result.checks.map(chk => (
                            <tr key={chk.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '10px 16px' }}>
                                {chk.passed
                                  ? <CheckCircle2 size={15} color="var(--success)" />
                                  : <XCircle size={15} color="var(--danger)" />}
                              </td>
                              <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700 }}>{chk.title}</td>
                              <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', color: chk.severity === 'high' ? 'var(--danger)' : chk.severity === 'medium' ? 'var(--warning)' : 'var(--text-muted)' }}>
                                {chk.severity}
                              </td>
                              <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 420 }}>{chk.detail}</td>
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
