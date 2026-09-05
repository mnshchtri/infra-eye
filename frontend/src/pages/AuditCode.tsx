import { useEffect, useState, useCallback } from 'react'
import {
  FileCode2, Loader2, RefreshCw, ChevronDown, ChevronUp, Info, AlertTriangle,
  Plus, Trash2, Pencil, GitBranch, KeyRound, CheckCircle2, XCircle, Wrench, Download
} from 'lucide-react'
import { api } from '../api/client'
import { Modal } from '../components/ui'
import { ToolPathModal } from '../components/audit/ToolPathModal'
import { ExportMenu } from '../components/audit/ExportMenu'
import { ScanConsole } from '../components/audit/ScanConsole'
import { codeFindingsToRows } from '../utils/reportExport'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'
import { useScanConsole } from '../hooks/useScanConsole'
import { errMessage } from '../utils/errors'
import type { CodeRepo, CodeScanResult, ScanTool } from '../types/audit'

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
  critical: 'var(--danger)', high: 'var(--danger)', medium: 'var(--warning)',
  low: 'var(--text-muted)', info: 'var(--text-muted)',
}

const emptyForm = { name: '', repo_url: '', branch: 'main', pat: '' }

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

export function AuditCode() {
  const toast = useToastStore()
  const { can } = usePermission()
  const canManage = can('manage-code-audit')

  const [repos, setRepos] = useState<CodeRepo[]>([])
  const [tools, setTools] = useState<ScanTool[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState<Record<number, boolean>>({})
  const [results, setResults] = useState<Record<number, CodeScanResult>>({})
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [selectedTools, setSelectedTools] = useState<string[]>(['gitleaks', 'semgrep', 'trivy'])
  const [pathEditTool, setPathEditTool] = useState<ScanTool | null>(null)
  const { logs: scanLogs, connect: connectScanLog, disconnect: disconnectScanLog } = useScanConsole()

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reposRes, toolsRes] = await Promise.all([
        api.get<CodeRepo[]>('/api/audit/code/repos'),
        api.get<{ code_scan_tools: ScanTool[] }>('/api/audit/tools'),
      ])
      setRepos(reposRes.data)
      setTools(toolsRes.data.code_scan_tools)
    } catch {
      setRepos([])
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

  function openEdit(r: CodeRepo) {
    setEditId(r.id)
    setForm({ name: r.name, repo_url: r.repo_url, branch: r.branch, pat: '' })
    setShowForm(true)
  }

  async function saveRepo() {
    if (!form.name.trim() || !form.repo_url.trim()) {
      toast.error('Missing fields', 'Name and repository URL are required')
      return
    }
    const body: Record<string, unknown> = { name: form.name, repo_url: form.repo_url, branch: form.branch || 'main' }
    if (form.pat) body.pat = form.pat
    try {
      if (editId) {
        await api.put(`/api/audit/code/repos/${editId}`, body)
      } else {
        await api.post('/api/audit/code/repos', body)
      }
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error('Save failed', errMessage(err))
    }
  }

  async function deleteRepo(id: number) {
    try {
      await api.delete(`/api/audit/code/repos/${id}`)
      setDeleteId(null)
      load()
    } catch (err: unknown) {
      toast.error('Delete failed', errMessage(err))
    }
  }

  function toggleTool(id: string) {
    setSelectedTools(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  async function scan(id: number) {
    setScanning(prev => ({ ...prev, [id]: true }))
    await connectScanLog(id, `/ws/audit/code/repos/${id}/scan-log`)
    try {
      const res = await api.post<{ success: boolean; error?: string; result?: CodeScanResult }>(
        `/api/audit/code/repos/${id}/scan`, { tools: selectedTools }
      )
      if (!res.data.success || !res.data.result) {
        toast.error('Scan failed', res.data.error || 'Could not run code scan')
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

  const toolsAvailableCount = tools.filter(t => t.available).length

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
            <FileCode2 size={22} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: 22, marginBottom: 4 }}>Code Security</h1>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              SAST, secrets, dependency (SCA) and CodeQL scanning for any Git repository.
            </div>
          </div>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={openCreate} style={{ gap: 8 }}>
            <Plus size={14} /> Add repository
          </button>
        )}
      </div>

      {/* Tool availability */}
      <div style={{ marginBottom: 24, flexShrink: 0, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px' }}>
          <Info size={13} color="var(--text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            InfraEye orchestrates scanners already on this backend host — nothing is bundled. {toolsAvailableCount} of {tools.length} detected.
            Select which to run per scan below; a repo is shallow-cloned into an isolated temp checkout and deleted immediately after.
            {canManage && <> Not found on a machine it's installed on? Click the wrench to point InfraEye at the exact binary.</>}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 16px 14px' }}>
          {tools.map(t => (
            <div key={t.id}
              title={t.available ? t.path : t.using_override ? `Custom path "${t.custom_path}" not found` : `${t.purpose} — ${t.install_hint}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 10px', fontSize: 12, fontFamily: 'var(--font-mono)',
                border: '1px solid var(--border)',
                opacity: t.available ? 1 : 0.5, background: selectedTools.includes(t.id) && t.available ? 'var(--brand-primary)18' : 'transparent',
              }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: t.available ? 'pointer' : 'not-allowed' }}>
                <input type="checkbox" disabled={!t.available} checked={selectedTools.includes(t.id)} onChange={() => toggleTool(t.id)} />
                {t.available ? <CheckCircle2 size={12} color="var(--success)" /> : <XCircle size={12} color={t.using_override ? 'var(--warning)' : 'var(--text-muted)'} />}
                {t.name}
              </label>
              {t.using_override && <KeyRound size={11} color="var(--warning)" />}
              {canManage && (
                <button onClick={() => setPathEditTool(t)} title="Set custom path" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px', display: 'flex' }}>
                  <Wrench size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }} className="fade-up">
        {repos.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center' }}>
            <FileCode2 size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>No repositories added yet.</p>
            {canManage && <button className="btn btn-secondary" onClick={openCreate} style={{ marginTop: 12 }}>Add repository</button>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {repos.map(r => {
              const result = results[r.id]
              const isScanning = !!scanning[r.id]
              const isExpanded = !!expanded[r.id]
              const highTotal = result ? result.critical_count + result.high_count : 0

              return (
                <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 0, flexShrink: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <GitBranch size={16} />
                    </div>

                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{r.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{r.repo_url}</span>
                        <span>·</span>
                        <span>{r.branch}</span>
                        {r.pat_set && <span title="Private repo (PAT configured)" style={{ display: 'flex' }}><KeyRound size={11} /></span>}
                      </div>
                    </div>

                    {result && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          SCANNED {fmtAgo(result.scanned_at)}
                        </span>
                        {highTotal > 0 ? (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--danger)18', color: 'var(--danger)', border: '1px solid var(--danger)30', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} /> {highTotal} CRITICAL/HIGH
                          </span>
                        ) : result.finding_count > 0 ? (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--warning)18', color: 'var(--warning)', border: '1px solid var(--warning)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {result.finding_count} FINDINGS
                          </span>
                        ) : (
                          <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 900, fontFamily: 'var(--font-mono)', background: 'var(--success)18', color: 'var(--success)', border: '1px solid var(--success)30', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            CLEAN
                          </span>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                      {canManage && (
                        <>
                          <button onClick={() => openEdit(r)} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px 10px' }}>
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleteId(r.id)} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--danger)', padding: '8px 10px' }}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      <button className="btn btn-secondary" onClick={() => scan(r.id)} disabled={isScanning || selectedTools.length === 0} style={{ gap: 8, padding: '8px 14px' }}>
                        {isScanning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
                        <span>{result ? 'Rescan' : 'Scan'}</span>
                      </button>
                      {result && (
                        <ExportMenu
                          meta={{
                            title: `Code Security Report — ${r.name}`, subject: r.repo_url, extra: `Branch: ${r.branch}`,
                            scannedAt: result.scanned_at, toolsRun: result.tools_run, toolErrors: result.tool_errors,
                            counts: { critical: result.critical_count, high: result.high_count, medium: result.medium_count, low: result.low_count },
                          }}
                          rows={codeFindingsToRows(result.findings)}
                          raw={result}
                        />
                      )}
                      {result && (
                        <button onClick={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))} style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px 10px' }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {isScanning && <ScanConsole lines={scanLogs[r.id] || []} />}

                  {result && isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                      {result.tool_errors && Object.keys(result.tool_errors).length > 0 && (
                        <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--warning)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {Object.entries(result.tool_errors).map(([tool, msg]) => (
                            <div key={tool}><b>{tool}:</b> {msg}</div>
                          ))}
                        </div>
                      )}
                      {(result.findings ?? []).length === 0 ? (
                        <div style={{ padding: '16px 20px', fontSize: 12, color: 'var(--text-muted)' }}>No findings.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <colgroup>
                              <col style={{ width: 90 }} />
                              <col style={{ width: 90 }} />
                              <col style={{ width: 110 }} />
                              <col style={{ width: 160 }} />
                              <col style={{ width: 220 }} />
                              <col />
                            </colgroup>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['Severity', 'Tool', 'Category', 'Rule', 'Location', 'Detail'].map(h => (
                                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textAlign: 'left', background: 'var(--bg-elevated)' }}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(result.findings ?? []).map((f, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 800, color: severityColor[f.severity] || 'var(--text-muted)', verticalAlign: 'top' }}>{f.severity}</td>
                                  <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', verticalAlign: 'top' }}>{f.tool}</td>
                                  <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', verticalAlign: 'top' }}>{f.category}</td>
                                  <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', verticalAlign: 'top', wordBreak: 'break-word' }}>{f.rule_id}</td>
                                  <td style={{ padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', verticalAlign: 'top', wordBreak: 'break-word' }}>
                                    {f.file}{f.line ? `:${f.line}` : ''}{f.package ? ` (${f.package})` : ''}
                                  </td>
                                  <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-secondary)', verticalAlign: 'top', wordBreak: 'break-word' }}>
                                    {f.title}
                                    {f.description && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{f.description}</div>}
                                    {f.fixed_in && <div style={{ color: 'var(--success)', marginTop: 4 }}>Fixed in {f.fixed_in}</div>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
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
        title={editId ? 'Edit repository' : 'Add repository'}
        icon={GitBranch}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="code-repo-form" className="btn btn-primary">{editId ? 'Save changes' : 'Add repository'}</button>
          </>
        }
      >
        <form id="code-repo-form" style={{ display: 'flex', flexDirection: 'column', gap: 18 }} onSubmit={e => { e.preventDefault(); saveRepo() }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Name</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. infra-eye" autoFocus />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Repository URL</label>
            <input className="input" value={form.repo_url} onChange={e => setForm({ ...form, repo_url: e.target.value })} placeholder="https://github.com/org/repo.git" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Branch</label>
            <input className="input" value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} placeholder="main" />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Personal access token {editId ? '(leave blank to keep current)' : '(optional — only needed for private repos)'}</label>
            <input className="input" type="password" value={form.pat} onChange={e => setForm({ ...form, pat: e.target.value })} placeholder={editId ? '••••••••' : ''} />
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Remove repository"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => deleteId !== null && deleteRepo(deleteId)}>Remove</button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          This removes the saved repository and its scan history. It does not affect the actual Git repository.
        </p>
      </Modal>

      <ToolPathModal
        tool={pathEditTool}
        onClose={() => setPathEditTool(null)}
        onSaved={updated => setTools(prev => prev.map(t => t.id === updated.id ? updated : t))}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
