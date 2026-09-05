import {
  ShieldAlert, ShieldCheck, Loader2, RefreshCw, ExternalLink,
  ChevronDown, ChevronUp, AlertTriangle, Info
} from 'lucide-react'
import { api } from '../api/client'
import { LinuxIcon, DistroIcon } from '../components/OSIcons'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
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

function fmtAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function Audit() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand, scannedCount } = useSecurityScan<ServerData, KernelAuditResult>({
    targetType: 'server', scanType: 'kernel', loadTargets: loadServers,
    scanUrl: id => `/api/servers/${id}/audit/kernel`,
    scanErrorMessage: 'Could not run kernel audit',
  })

  const vulnerableServerCount = Object.values(results).filter(r => r.highCount > 0).length

  if (loading) return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', paddingBottom: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 0,
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <ShieldAlert size={22} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4 }}>
              Kernel Vulnerability Scanner
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Cross-references each server's running kernel against known privilege-escalation CVEs, live over SSH.
            </div>
          </div>
        </div>
      </div>

      {/* Provenance / caveat banner */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 24, flexShrink: 0,
        padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--bg-elevated)'
      }}>
        <Info size={14} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Detections are version-range checks derived from{' '}
          <a href="https://github.com/gotr00t0day/kernelpwned" target="_blank" rel="noreferrer" style={{ color: 'var(--brand-primary)' }}>kernelpwned</a>'s
          vulnerability database, not a live CVE feed. Distros frequently backport security fixes without changing
          the reported kernel version, which can produce false positives — treat results as a starting point and
          confirm against your distro's official advisories before acting.
        </div>
      </div>

      {/* Stat row */}
      <div className="grid-stats-4" style={{ marginBottom: 24, flexShrink: 0 }}>
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{targets.length}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>Linux Servers</div>
        </div>
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{scannedCount}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>Scanned</div>
        </div>
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)', color: vulnerableServerCount > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{vulnerableServerCount}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>Flagged</div>
        </div>
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>10</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>Tracked CVEs</div>
        </div>
      </div>

      {/* Server list */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }} className="fade-up">
        {targets.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center' }}>
            <ShieldAlert size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>No SSH-connected Linux servers to scan.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {targets.map(s => {
              const state: ScanState<KernelAuditResult> | undefined = results[s.id]
              const isScanning = !!scanning[s.id]
              const isExpanded = !!expanded[s.id]

              return (
                <div key={s.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 0, flexShrink: 0,
                      background: 'var(--bg-app)', border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {s.distro ? <DistroIcon distro={s.distro} size={18} /> : <LinuxIcon size={18} color="var(--text-primary)" />}
                    </div>

                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.host}</div>
                    </div>

                    {state && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {state.result?.kernel_version && (
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            KERNEL {state.result.kernel_version}
                          </span>
                        )}
                        {state.scannedAt && (
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {state.cached ? 'LAST SCAN ' : 'SCANNED '}{fmtAgo(state.scannedAt)}
                          </span>
                        )}
                        {state.highCount > 0 ? (
                          <span style={{
                            padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)',
                            background: 'var(--danger)18', color: 'var(--danger)', border: '1px solid var(--danger)30',
                            textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4
                          }}>
                            <AlertTriangle size={12} /> {state.highCount} FLAGGED
                          </span>
                        ) : (
                          <span style={{
                            padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)',
                            background: 'var(--success)18', color: 'var(--success)', border: '1px solid var(--success)30',
                            textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4
                          }}>
                            <ShieldCheck size={12} /> CLEAN
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
                        <button
                          onClick={() => toggleExpand(s.id)}
                          style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px 10px' }}
                        >
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
                            {['Status', 'CVE', 'Name', 'Detail', 'PoC'].map(h => (
                              <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(state.result.findings ?? []).map(f => (
                            <tr key={f.cve} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '10px 16px' }}>
                                <span style={{
                                  padding: '3px 8px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)',
                                  background: f.vulnerable ? 'var(--danger)18' : 'var(--success)18',
                                  color: f.vulnerable ? 'var(--danger)' : 'var(--success)',
                                  border: `1px solid ${f.vulnerable ? 'var(--danger)30' : 'var(--success)30'}`,
                                  textTransform: 'uppercase', letterSpacing: '0.05em'
                                }}>
                                  {f.vulnerable ? 'Vulnerable' : 'Not Vulnerable'}
                                </span>
                              </td>
                              <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{f.cve}</td>
                              <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700 }}>{f.name}</td>
                              <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 320 }}>
                                {f.vulnerable ? f.detail : f.description}
                              </td>
                              <td style={{ padding: '10px 16px' }}>
                                <a href={f.poc_url} target="_blank" rel="noreferrer" style={{ color: 'var(--brand-primary)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                                  <ExternalLink size={12} />
                                </a>
                              </td>
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
