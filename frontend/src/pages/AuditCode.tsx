import { useEffect, useState, useCallback } from 'react'
import {
  FileCode2, AlertTriangle, Plus, Trash2, Pencil, GitBranch, KeyRound, CheckCircle2, XCircle, Wrench,
} from 'lucide-react'
import {
  Alert, Box, Checkbox, FormControlLabel, IconButton, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { api } from '../api/client'
import { Modal, Button } from '../components/ui'
import { AuditPage, ScanTargetCard, ScanBadge, MetaText, FindingsTable, Cell, TargetList } from '../components/audit/AuditParts'
import { fmtAgo } from '../utils/fmtAgo'
import { ToolPathModal } from '../components/audit/ToolPathModal'
import { ExportMenu } from '../components/audit/ExportMenu'
import { ScanConsole } from '../components/audit/ScanConsole'
import { codeFindingsToRows } from '../utils/reportExport'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'
import { useScanConsole } from '../hooks/useScanConsole'
import { errMessage } from '../utils/errors'
import type { CodeRepo, CodeScanResult, ScanTool } from '../types/audit'

const severityPalette: Record<string, string> = {
  critical: 'error.main', high: 'error.main', medium: 'warning.main', low: 'text.secondary', info: 'text.secondary',
}

const emptyForm = { name: '', repo_url: '', branch: 'main', pat: '' }


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
      const persisted: Record<number, CodeScanResult> = {}
      for (const r of reposRes.data) {
        if (r.last_result) persisted[r.id] = r.last_result
      }
      setResults(persisted)
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

  return (
    <AuditPage
      loading={loading}
      icon={FileCode2}
      title="Code Security"
      description="SAST, secrets, dependency (SCA) and CodeQL scanning for any Git repository."
      actions={canManage && <Button icon={<Plus size={14} />} onClick={openCreate}>Add repository</Button>}
      notice={<>
        InfraEye orchestrates scanners already on this backend host — nothing is bundled. {toolsAvailableCount} of {tools.length} detected.
        Select which to run per scan below; a repo is shallow-cloned into an isolated temp checkout and deleted immediately after.
        {canManage && <> Not found on a machine it's installed on? Click the wrench to point InfraEye at the exact binary.</>}
      </>}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {tools.map(t => (
          <Tooltip key={t.id} title={t.available ? t.path : t.using_override ? `Custom path "${t.custom_path}" not found` : `${t.purpose} — ${t.install_hint}`}>
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.5, pr: 0.5, border: 1, borderColor: 'divider', borderRadius: 1,
              opacity: t.available ? 1 : 0.55, bgcolor: selectedTools.includes(t.id) && t.available ? 'action.selected' : 'transparent',
            }}>
              <FormControlLabel
                disabled={!t.available}
                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontFamily: 'var(--font-mono)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 0.75 } }}
                control={<Checkbox checked={selectedTools.includes(t.id)} onChange={() => toggleTool(t.id)} />}
                label={<>
                  {t.available ? <CheckCircle2 size={12} color="var(--success)" /> : <XCircle size={12} color={t.using_override ? 'var(--warning)' : 'var(--text-muted)'} />}
                  {t.name}
                </>}
              />
              {t.using_override && <KeyRound size={11} color="var(--warning)" />}
              {canManage && (
                <Tooltip title="Set custom path">
                  <IconButton onClick={() => setPathEditTool(t)} aria-label={`Set custom path for ${t.name}`}><Wrench size={12} /></IconButton>
                </Tooltip>
              )}
            </Box>
          </Tooltip>
        ))}
      </Box>

      <TargetList empty={repos.length === 0 ? { icon: FileCode2, text: 'No repositories added yet.' } : null}>
        {repos.map(r => {
          const result = results[r.id]
          const highTotal = result ? result.critical_count + result.high_count : 0
          return (
            <ScanTargetCard
              key={r.id}
              icon={<GitBranch size={16} />}
              name={r.name}
              subtitle={<Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                {r.repo_url} · {r.branch}
                {r.pat_set && <Tooltip title="Private repo (PAT configured)"><span style={{ display: 'flex' }}><KeyRound size={11} /></span></Tooltip>}
              </Box>}
              scanning={!!scanning[r.id]}
              scanDisabled={selectedTools.length === 0}
              hasResult={!!result}
              expanded={!!expanded[r.id]}
              onScan={() => scan(r.id)}
              onToggle={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
              meta={result && <MetaText>SCANNED {fmtAgo(result.scanned_at)}</MetaText>}
              badge={result && (highTotal > 0
                ? <ScanBadge tone="error" icon={<AlertTriangle size={12} />}>{highTotal} critical/high</ScanBadge>
                : result.finding_count > 0
                ? <ScanBadge tone="warning">{result.finding_count} findings</ScanBadge>
                : <ScanBadge tone="success">Clean</ScanBadge>)}
              actions={canManage && (
                <>
                  <Tooltip title="Edit"><IconButton onClick={() => openEdit(r)} aria-label="Edit repository"><Pencil size={14} /></IconButton></Tooltip>
                  <Tooltip title="Remove"><IconButton color="error" onClick={() => setDeleteId(r.id)} aria-label="Remove repository"><Trash2 size={14} /></IconButton></Tooltip>
                </>
              )}
              trailing={result && (
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
              console={scanning[r.id] ? <ScanConsole lines={scanLogs[r.id] || []} /> : undefined}
            >
              {result && (
                <>
                  {result.tool_errors && Object.keys(result.tool_errors).length > 0 && (
                    <Alert severity="warning" sx={{ borderRadius: 0 }}>
                      {Object.entries(result.tool_errors).map(([tool, msg]) => (
                        <div key={tool}><b>{tool}:</b> {msg}</div>
                      ))}
                    </Alert>
                  )}
                  {(result.findings ?? []).length === 0 ? (
                    <Box sx={{ px: 2.5, py: 2 }}><Typography variant="body2" color="text.secondary">No findings.</Typography></Box>
                  ) : (
                    <FindingsTable columns={['Severity', 'Tool', 'Category', 'Rule', 'Location', 'Detail']}>
                      {(result.findings ?? []).map((f, i) => (
                        <TableRow key={i} hover sx={{ verticalAlign: 'top' }}>
                          <Cell mono sx={{ textTransform: 'uppercase', fontWeight: 700, color: severityPalette[f.severity] || 'text.secondary' }}>{f.severity}</Cell>
                          <Cell sx={{ color: 'text.secondary' }}>{f.tool}</Cell>
                          <Cell sx={{ color: 'text.secondary', textTransform: 'uppercase' }}>{f.category}</Cell>
                          <Cell mono sx={{ wordBreak: 'break-word' }}>{f.rule_id}</Cell>
                          <Cell mono sx={{ color: 'text.secondary', wordBreak: 'break-word' }}>
                            {f.file}{f.line ? `:${f.line}` : ''}{f.package ? ` (${f.package})` : ''}
                          </Cell>
                          <Cell sx={{ color: 'text.secondary', wordBreak: 'break-word' }}>
                            {f.title}
                            {f.description && <Box sx={{ mt: 0.5 }}>{f.description}</Box>}
                            {f.fixed_in && <Box sx={{ mt: 0.5, color: 'success.main' }}>Fixed in {f.fixed_in}</Box>}
                          </Cell>
                        </TableRow>
                      ))}
                    </FindingsTable>
                  )}
                </>
              )}
            </ScanTargetCard>
          )
        })}
      </TargetList>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? 'Edit repository' : 'Add repository'}
        icon={GitBranch}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" form="code-repo-form">{editId ? 'Save changes' : 'Add repository'}</Button>
          </>
        }
      >
        <Box component="form" id="code-repo-form" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          onSubmit={(e: React.FormEvent) => { e.preventDefault(); saveRepo() }}>
          <TextField label="Name" autoFocus fullWidth value={form.name} placeholder="e.g. infra-eye" onChange={e => setForm({ ...form, name: e.target.value })} />
          <TextField label="Repository URL" fullWidth value={form.repo_url} placeholder="https://github.com/org/repo.git" onChange={e => setForm({ ...form, repo_url: e.target.value })} />
          <TextField label="Branch" fullWidth value={form.branch} placeholder="main" onChange={e => setForm({ ...form, branch: e.target.value })} />
          <TextField
            label={`Personal access token ${editId ? '(leave blank to keep current)' : '(optional — only needed for private repos)'}`}
            type="password" fullWidth value={form.pat} placeholder={editId ? '••••••••' : ''}
            onChange={e => setForm({ ...form, pat: e.target.value })}
          />
        </Box>
      </Modal>

      <Modal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Remove repository"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteId !== null && deleteRepo(deleteId)}>Remove</Button>
          </>
        }
      >
        <Typography variant="body1" color="text.secondary">
          This removes the saved repository and its scan history. It does not affect the actual Git repository.
        </Typography>
      </Modal>

      <ToolPathModal
        tool={pathEditTool}
        onClose={() => setPathEditTool(null)}
        onSaved={updated => setTools(prev => prev.map(t => t.id === updated.id ? updated : t))}
      />
    </AuditPage>
  )
}
