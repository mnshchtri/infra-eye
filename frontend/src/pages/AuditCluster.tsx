import {
  Network, Loader2, RefreshCw, ChevronDown, ChevronUp, Info, AlertTriangle
} from 'lucide-react'
import { api } from '../api/client'
import { KubernetesIcon } from '../components/OSIcons'
import { useSecurityScan, type ScanState } from '../hooks/useSecurityScan'
import type { ClusterAuditResult } from '../types/audit'

interface ServerData {
  id: number
  name: string
  host: string
  is_k8s: boolean
  kube_config?: string
  status: string
}

async function loadClusters(): Promise<ServerData[]> {
  const res = await api.get('/api/servers')
  const list: ServerData[] = Array.isArray(res.data) ? res.data : []
  return list.filter(s => s.is_k8s && s.kube_config)
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

const severityColor: Record<string, string> = {
  high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--text-muted)', info: 'var(--text-muted)',
}

export function AuditCluster() {
  const { targets, loading, scanning, results, expanded, scan, toggleExpand } = useSecurityScan<ServerData, ClusterAuditResult>({
    targetType: 'server', scanType: 'cluster', loadTargets: loadClusters,
    scanUrl: id => `/api/servers/${id}/audit/cluster`,
    scanErrorMessage: 'Could not run cluster audit',
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
            <Network size={22} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4 }}>
              Cluster Security
            </h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Checks workload security context, RBAC bindings, and network exposure across each connected cluster.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 24, flexShrink: 0, padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <Info size={13} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Findings come from read-only List calls against the cluster API (pods, RBAC bindings, services, network policies).
          The Kubernetes EOL-version check is a point-in-time list, not a live feed — verify against upstream support policy.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }} className="fade-up">
        {targets.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center' }}>
            <Network size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>No connected Kubernetes clusters to scan.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {targets.map(s => {
              const state: ScanState<ClusterAuditResult> | undefined = results[s.id]
              const isScanning = !!scanning[s.id]
              const isExpanded = !!expanded[s.id]

              return (
                <div key={s.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 0, flexShrink: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <KubernetesIcon size={18} />
                    </div>

                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.host || 'kubeconfig'}{state?.result?.server_version ? ` · v${state.result.server_version}` : ''}</div>
                    </div>

                    {state && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {state.scannedAt && (
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {state.cached ? 'LAST SCAN ' : 'SCANNED '}{fmtAgo(state.scannedAt)}
                          </span>
                        )}
                        {state.highCount > 0 ? (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--danger)18', color: 'var(--danger)', border: '1px solid var(--danger)30', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} /> {state.highCount} HIGH
                          </span>
                        ) : state.findingCount > 0 ? (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--warning)18', color: 'var(--warning)', border: '1px solid var(--warning)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {state.findingCount} FINDINGS
                          </span>
                        ) : (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--success)18', color: 'var(--success)', border: '1px solid var(--success)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            CLEAN
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
                    state.result.findings.length === 0 ? (
                      <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)' }}>No findings.</div>
                    ) : (
                      <div style={{ borderTop: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              {['Severity', 'Category', 'Resource', 'Detail'].map(h => (
                                <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {state.result.findings.map((f, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 800, color: severityColor[f.severity] || 'var(--text-muted)' }}>{f.severity}</td>
                                <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{f.category}</td>
                                <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{f.resource}</td>
                                <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 420 }}>{f.detail}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
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
