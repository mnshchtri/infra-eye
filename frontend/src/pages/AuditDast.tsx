import { useEffect, useState, useCallback } from 'react'
import {
  Radar, Loader2, RefreshCw, ChevronDown, ChevronUp, Info, AlertTriangle,
  Plus, Trash2, Pencil, Globe, ShieldAlert, CheckCircle2, XCircle, Wrench
} from 'lucide-react'
import { api } from '../api/client'
import { Modal } from '../components/ui'
import { ToolPathModal } from '../components/audit/ToolPathModal'
import { ExportMenu } from '../components/audit/ExportMenu'
import { ScanConsole } from '../components/audit/ScanConsole'
import { dastFindingsToRows } from '../utils/reportExport'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'
import { useScanConsole } from '../hooks/useScanConsole'
import { errMessage } from '../utils/errors'
import type { DastTarget, DastScanResult, DastEnvironment, ScanTool } from '../types/audit'

function fmtAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const riskColor: Record<string, string> = {
  critical: 'var(--danger)', high: 'var(--danger)', medium: 'var(--warning)',
  low: 'var(--text-muted)', info: 'var(--text-muted)',
}

const emptyForm = { name: '', target_url: '', notes: '' }

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

export function AuditDast() {
  const toast = useToastStore()
  const { can } = usePermission()
  const canManage = can('manage-code-audit')

  const [targets, setTargets] = useState<DastTarget[]>([])
  const [env, setEnv] = useState<DastEnvironment | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState<Record<number, boolean>>({})
  const [results, setResults] = useState<Record<number, DastScanResult>>({})
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [confirmFull, setConfirmFull] = useState<DastTarget | null>(null)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [pathEditTool, setPathEditTool] = useState<ScanTool | null>(null)
  const { logs: scanLogs, connect: connectScanLog, disconnect: disconnectScanLog } = useScanConsole()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [targetsRes, toolsRes] = await Promise.all([
        api.get<DastTarget[]>('/api/audit/dast/targets'),
        api.get<{ dast_environment: DastEnvironment }>('/api/audit/tools'),
      ])
      setTargets(targetsRes.data)
      setEnv(toolsRes.data.dast_environment)
    } catch {
      setTargets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function openEdit(t: DastTarget) {
    setEditId(t.id)
    setForm({ name: t.name, target_url: t.target_url, notes: t.notes || '' })
    setShowForm(true)
  }

  async function saveTarget() {
    if (!form.name.trim() || !form.target_url.trim()) {
      toast.error('Missing fields', 'Name and target URL are required')
      return
    }
    try {
      if (editId) {
        await api.put(`/api/audit/dast/targets/${editId}`, form)
      } else {
        await api.post('/api/audit/dast/targets', form)
      }
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error('Save failed', errMessage(err))
    }
  }

  async function deleteTarget(id: number) {
    try {
      await api.delete(`/api/audit/dast/targets/${id}`)
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      toast.error('Delete failed', errMessage(err))
    }
  }

  async function runScan(id: number, mode: 'baseline' | 'full', confirm = false) {
    setScanning(prev => ({ ...prev, [id]: true }))
    await connectScanLog(id, `/ws/audit/dast/targets/${id}/scan-log`)
    try {
      const res = await api.post<{ success: boolean; error?: string; result?: DastScanResult }>(
        `/api/audit/dast/targets/${id}/scan`, { mode, confirm }
      )
      if (!res.data.success || !res.data.result) {
        toast.error('Scan failed', res.data.error || 'Could not run DAST scan')
        return
      }
      setResults(prev => ({ ...prev, [id]: res.data.result! }))
      setExpanded(prev => ({ ...prev, [id]: true }))
    } catch (err: unknown) {
      toast.error('Scan failed', errMessage(err))
    } finally {
      setScanning(prev => ({ ...prev, [id]: false }))
      disconnectScanLog(id)
    }
  }

  function requestFullScan(t: DastTarget) {
    setConfirmChecked(false)
    setConfirmFull(t)
  }

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
            <Radar size={22} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4 }}>DAST Scanner</h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Dynamic testing of running web applications and APIs using OWASP ZAP.
            </div>
          </div>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={openCreate} style={{ gap: 8 }}>
            <Plus size={14} /> Add target
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 24, flexShrink: 0, padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        {env?.ready ? <CheckCircle2 size={13} color="var(--success)" style={{ marginTop: 2, flexShrink: 0 }} /> : <XCircle size={13} color="var(--warning)" style={{ marginTop: 2, flexShrink: 0 }} />}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {env?.zap_api_configured ? (
            <>Using an external ZAP daemon at <code style={{ fontFamily: 'var(--font-mono)' }}>{env.zap_api_url}</code>.</>
          ) : env?.docker?.available ? (
            <>Running ZAP on demand via Docker ({env.docker.path}).</>
          ) : (
            <>No DAST engine available — install Docker to run ZAP on demand, or set <code style={{ fontFamily: 'var(--font-mono)' }}>ZAP_API_URL</code> to point at a running ZAP daemon.</>
          )}
          {' '}<b>Baseline</b> scans are passive-only (spider + observe). <b>Full</b> scans actively attack the target — only run those against infrastructure you're authorized to test.
        </div>
        {canManage && !env?.zap_api_configured && (
          <button onClick={() => env && setPathEditTool(env.docker)} title="Set custom Docker path" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
            <Wrench size={13} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }} className="fade-up">
        {targets.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center' }}>
            <Radar size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>No DAST targets added yet.</p>
            {canManage && <button className="btn btn-secondary" onClick={openCreate} style={{ marginTop: 12 }}>Add target</button>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {targets.map(t => {
              const result = results[t.id]
              const isScanning = !!scanning[t.id]
              const isExpanded = !!expanded[t.id]
              const highTotal = result ? result.critical_count + result.high_count : 0

              return (
                <div key={t.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 0, flexShrink: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Globe size={16} />
                    </div>

                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.target_url}</div>
                    </div>

                    {result && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {result.mode.toUpperCase()} · {fmtAgo(result.scanned_at)}
                        </span>
                        {highTotal > 0 ? (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--danger)18', color: 'var(--danger)', border: '1px solid var(--danger)30', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} /> {highTotal} CRITICAL/HIGH
                          </span>
                        ) : result.finding_count > 0 ? (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--warning)18', color: 'var(--warning)', border: '1px solid var(--warning)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {result.finding_count} ALERTS
                          </span>
                        ) : (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--success)18', color: 'var(--success)', border: '1px solid var(--success)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            CLEAN
                          </span>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                      {canManage && (
                        <>
                          <button onClick={() => openEdit(t)} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px 10px' }}>
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleteId(t.id)} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--danger)', padding: '8px 10px' }}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      <button className="btn btn-secondary" onClick={() => runScan(t.id, 'baseline')} disabled={isScanning || !env?.ready} style={{ gap: 8, padding: '8px 14px' }}>
                        {isScanning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
                        <span>Baseline scan</span>
                      </button>
                      {canManage && (
                        <button className="btn btn-secondary" onClick={() => requestFullScan(t)} disabled={isScanning || !env?.ready} style={{ gap: 8, padding: '8px 14px', color: 'var(--danger)' }}>
                          <ShieldAlert size={14} />
                          <span>Full scan</span>
                        </button>
                      )}
                      {result && (
                        <ExportMenu
                          meta={{
                            title: `DAST Report — ${t.name}`, subject: t.target_url, extra: `Mode: ${result.mode}`,
                            scannedAt: result.scanned_at,
                            counts: { critical: result.critical_count, high: result.high_count, medium: result.medium_count, low: result.low_count },
                          }}
                          rows={dastFindingsToRows(result.findings)}
                          raw={result}
                        />
                      )}
                      {result && (
                        <button onClick={() => setExpanded(prev => ({ ...prev, [t.id]: !prev[t.id] }))} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px 10px' }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {isScanning && <ScanConsole lines={scanLogs[t.id] || []} />}

                  {result && isExpanded && (
                    (result.findings ?? []).length === 0 ? (
                      <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)' }}>No alerts.</div>
                    ) : (
                      <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: 90 }} />
                            <col style={{ width: 100 }} />
                            <col style={{ width: 200 }} />
                            <col style={{ width: 220 }} />
                            <col />
                          </colgroup>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              {['Risk', 'Confidence', 'Alert', 'URL', 'Detail'].map(h => (
                                <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(result.findings ?? []).map((f, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 800, color: riskColor[f.risk] || 'var(--text-muted)', verticalAlign: 'top' }}>{f.risk}</td>
                                <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', verticalAlign: 'top' }}>{f.confidence}</td>
                                <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, verticalAlign: 'top', wordBreak: 'break-word' }}>{f.name}</td>
                                <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', verticalAlign: 'top', wordBreak: 'break-all' }}>{f.url}</td>
                                <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', verticalAlign: 'top', wordBreak: 'break-word' }}>
                                  {f.description}
                                  {f.solution && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}><b>Fix:</b> {f.solution}</div>}
                                </td>
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

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? 'Edit target' : 'Add target'}
        icon={Globe}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="dast-target-form" className="btn btn-primary">{editId ? 'Save changes' : 'Add target'}</button>
          </>
        }
      >
        <form id="dast-target-form" style={{ display: 'flex', flexDirection: 'column', gap: 18 }} onSubmit={e => { e.preventDefault(); saveTarget() }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Name</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Staging app" autoFocus />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Target URL</label>
            <input className="input" value={form.target_url} onChange={e => setForm({ ...form, target_url: e.target.value })} placeholder="https://staging.example.com" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. authorized for testing per ticket #123" />
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Remove target"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => deleteId !== null && deleteTarget(deleteId)}>Remove</button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>This removes the saved target and its scan history.</p>
      </Modal>

      <Modal
        isOpen={confirmFull !== null}
        onClose={() => setConfirmFull(null)}
        title="Confirm active scan"
        icon={ShieldAlert}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmFull(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              disabled={!confirmChecked}
              onClick={() => { if (confirmFull) { runScan(confirmFull.id, 'full', true); setConfirmFull(null) } }}
            >
              Run full scan
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            A full scan runs OWASP ZAP's active scanner against <b>{confirmFull?.target_url}</b> — it sends real
            attack payloads (SQL injection, XSS, path traversal, and more) at every discovered parameter. This can
            trigger WAFs or rate limits, generate a large volume of traffic, and — against a fragile application —
            cause real disruption.
          </p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} style={{ marginTop: 3 }} />
            I am authorized to actively security-test this target and accept the risk of disruption.
          </label>
        </div>
      </Modal>

      <ToolPathModal
        tool={pathEditTool}
        onClose={() => setPathEditTool(null)}
        onSaved={updated => setEnv(prev => prev ? { ...prev, docker: updated, ready: prev.zap_api_configured || updated.available } : prev)}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
