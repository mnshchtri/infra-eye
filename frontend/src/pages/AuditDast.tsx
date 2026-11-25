import { useEffect, useState, useCallback } from 'react'
import {
  Radar, AlertTriangle, Plus, Trash2, Pencil, Globe, ShieldAlert, CheckCircle2, XCircle, Wrench,
} from 'lucide-react'
import { Box, Checkbox, FormControlLabel, IconButton, TableRow, TextField, Tooltip, Typography } from '@mui/material'
import { api } from '../api/client'
import { Modal, Button } from '../components/ui'
import { AuditPage, ScanTargetCard, ScanBadge, MetaText, FindingsTable, Cell, TargetList } from '../components/audit/AuditParts'
import { fmtAgo } from '../utils/fmtAgo'
import { ToolPathModal } from '../components/audit/ToolPathModal'
import { ExportMenu } from '../components/audit/ExportMenu'
import { ScanConsole } from '../components/audit/ScanConsole'
import { dastFindingsToRows } from '../utils/reportExport'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'
import { useScanConsole } from '../hooks/useScanConsole'
import { errMessage } from '../utils/errors'
import type { DastTarget, DastScanResult, DastEnvironment, ScanTool } from '../types/audit'

const riskPalette: Record<string, string> = {
  critical: 'error.main', high: 'error.main', medium: 'warning.main', low: 'text.secondary', info: 'text.secondary',
}

const emptyForm = { name: '', target_url: '', notes: '' }


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
      const persisted: Record<number, DastScanResult> = {}
      for (const t of targetsRes.data) {
        if (t.last_result) persisted[t.id] = t.last_result
      }
      setResults(persisted)
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

  return (
    <AuditPage
      loading={loading}
      icon={Radar}
      title="DAST Scanner"
      description="Dynamic testing of running web applications and APIs using OWASP ZAP."
      actions={canManage && <Button icon={<Plus size={14} />} onClick={openCreate}>Add target</Button>}
      noticeIcon={env?.ready ? <CheckCircle2 size={16} /> : <XCircle size={16} color="var(--warning)" />}
      noticeAction={canManage && !env?.zap_api_configured && (
        <Tooltip title="Set custom Docker path">
          <IconButton onClick={() => env && setPathEditTool(env.docker)} aria-label="Set custom Docker path"><Wrench size={14} /></IconButton>
        </Tooltip>
      )}
      notice={<>
        {env?.zap_api_configured ? (
          <>Using an external ZAP daemon at <code style={{ fontFamily: 'var(--font-mono)' }}>{env.zap_api_url}</code>.</>
        ) : env?.docker?.available ? (
          <>Running ZAP on demand via Docker ({env.docker.path}).</>
        ) : (
          <>No DAST engine available — install Docker to run ZAP on demand, or set <code style={{ fontFamily: 'var(--font-mono)' }}>ZAP_API_URL</code> to point at a running ZAP daemon.</>
        )}
        {' '}<b>Baseline</b> scans are passive-only (spider + observe). <b>Full</b> scans actively attack the target — only run those against infrastructure you're authorized to test.
      </>}
    >
      <TargetList empty={targets.length === 0 ? { icon: Radar, text: 'No DAST targets added yet.' } : null}>
        {targets.map(t => {
          const result = results[t.id]
          const isScanning = !!scanning[t.id]
          const highTotal = result ? result.critical_count + result.high_count : 0
          return (
            <ScanTargetCard
              key={t.id}
              icon={<Globe size={16} />}
              name={t.name}
              subtitle={t.target_url}
              scanning={isScanning}
              scanDisabled={!env?.ready}
              hasResult={!!result}
              expanded={!!expanded[t.id]}
              onScan={() => runScan(t.id, 'baseline')}
              onToggle={() => setExpanded(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
              meta={result && <MetaText>{result.mode.toUpperCase()} · {fmtAgo(result.scanned_at)}</MetaText>}
              badge={result && (highTotal > 0
                ? <ScanBadge tone="error" icon={<AlertTriangle size={12} />}>{highTotal} critical/high</ScanBadge>
                : result.finding_count > 0
                ? <ScanBadge tone="warning">{result.finding_count} alerts</ScanBadge>
                : <ScanBadge tone="success">Clean</ScanBadge>)}
              actions={canManage && (
                <>
                  <Tooltip title="Edit"><IconButton onClick={() => openEdit(t)} aria-label="Edit target"><Pencil size={14} /></IconButton></Tooltip>
                  <Tooltip title="Remove"><IconButton color="error" onClick={() => setDeleteId(t.id)} aria-label="Remove target"><Trash2 size={14} /></IconButton></Tooltip>
                </>
              )}
              trailing={<>
                {canManage && (
                  <Button variant="danger" size="sm" icon={<ShieldAlert size={14} />} disabled={isScanning || !env?.ready} onClick={() => requestFullScan(t)}>Full scan</Button>
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
              </>}
              console={isScanning ? <ScanConsole lines={scanLogs[t.id] || []} /> : undefined}
            >
              {result && ((result.findings ?? []).length === 0 ? (
                <Box sx={{ px: 2.5, py: 2 }}><Typography variant="body2" color="text.secondary">No alerts.</Typography></Box>
              ) : (
                <FindingsTable columns={['Risk', 'Confidence', 'Alert', 'URL', 'Detail']}>
                  {(result.findings ?? []).map((f, i) => (
                    <TableRow key={i} hover sx={{ verticalAlign: 'top' }}>
                      <Cell mono sx={{ textTransform: 'uppercase', fontWeight: 700, color: riskPalette[f.risk] || 'text.secondary' }}>{f.risk}</Cell>
                      <Cell sx={{ color: 'text.secondary' }}>{f.confidence}</Cell>
                      <Cell sx={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>{f.name}</Cell>
                      <Cell mono sx={{ color: 'text.secondary', wordBreak: 'break-all' }}>{f.url}</Cell>
                      <Cell sx={{ color: 'text.secondary', wordBreak: 'break-word' }}>
                        {f.description}
                        {f.solution && <Box sx={{ mt: 0.5 }}><b>Fix:</b> {f.solution}</Box>}
                      </Cell>
                    </TableRow>
                  ))}
                </FindingsTable>
              ))}
            </ScanTargetCard>
          )
        })}
      </TargetList>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? 'Edit target' : 'Add target'}
        icon={Globe}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" form="dast-target-form">{editId ? 'Save changes' : 'Add target'}</Button>
          </>
        }
      >
        <Box component="form" id="dast-target-form" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          onSubmit={(e: React.FormEvent) => { e.preventDefault(); saveTarget() }}>
          <TextField label="Name" autoFocus fullWidth value={form.name} placeholder="e.g. Staging app" onChange={e => setForm({ ...form, name: e.target.value })} />
          <TextField label="Target URL" fullWidth value={form.target_url} placeholder="https://staging.example.com" onChange={e => setForm({ ...form, target_url: e.target.value })} />
          <TextField label="Notes (optional)" fullWidth multiline minRows={2} value={form.notes} placeholder="e.g. authorized for testing per ticket #123" onChange={e => setForm({ ...form, notes: e.target.value })} />
        </Box>
      </Modal>

      <Modal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Remove target"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteId !== null && deleteTarget(deleteId)}>Remove</Button>
          </>
        }
      >
        <Typography variant="body1" color="text.secondary">This removes the saved target and its scan history.</Typography>
      </Modal>

      <Modal
        isOpen={confirmFull !== null}
        onClose={() => setConfirmFull(null)}
        title="Confirm active scan"
        icon={ShieldAlert}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmFull(null)}>Cancel</Button>
            <Button variant="danger" disabled={!confirmChecked}
              onClick={() => { if (confirmFull) { runScan(confirmFull.id, 'full', true); setConfirmFull(null) } }}>
              Run full scan
            </Button>
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body1" color="text.secondary">
            A full scan runs OWASP ZAP's active scanner against <b>{confirmFull?.target_url}</b> — it sends real
            attack payloads (SQL injection, XSS, path traversal, and more) at every discovered parameter. This can
            trigger WAFs or rate limits, generate a large volume of traffic, and — against a fragile application —
            cause real disruption.
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} />}
            label="I am authorized to actively security-test this target and accept the risk of disruption."
          />
        </Box>
      </Modal>

      <ToolPathModal
        tool={pathEditTool}
        onClose={() => setPathEditTool(null)}
        onSaved={updated => setEnv(prev => prev ? { ...prev, docker: updated, ready: prev.zap_api_configured || updated.available } : prev)}
      />
    </AuditPage>
  )
}
