import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, Bell, History, Zap, FileCode, ShieldAlert, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import {
  Alert, Box, CircularProgress, MenuItem, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { Modal, SectionHeader, EmptyState, SearchInput, TabSwitcher, PageHeader, Button } from '../components/ui'

// Sub-components
import { RuleCard } from '../components/alerts/RuleCard'
import { HistoryRow } from '../components/alerts/HistoryRow'
import { apiError, errMessage } from '../utils/errors'
import { parseAlertRulesXml } from '../utils/alertRulesXml'

interface Rule {
  id: number; name: string; server_id: number;
  condition_type: string; condition_op: string; condition_value: string;
  action_type: string; action_command: string; severity: string; enabled: boolean;
  cooldown_minutes?: number;
  git_managed?: boolean;
}
interface HistoryAction {
  id: number; created_at: string; server_id: number; trigger_info: string;
  command: string; output: string; status: string;
}
interface ServerData { id: number; name: string; host: string }

const emptyForm = {
  name: '', server_id: 0, condition_type: 'cpu',
  condition_op: 'gt', condition_value: '80', severity: 'warning',
  action_type: 'notify', action_command: '', enabled: true,
  cooldown_minutes: 5,
}

// escapeXmlText escapes the characters that are unsafe in XML element text content.
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// escapeXmlAttr escapes the characters that are unsafe inside a double-quoted XML attribute.
function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;')
}

const METRICS: { value: string; label: string; hint: string }[] = [
  { value: 'cpu', label: 'CPU usage (%)', hint: 'Latest CPU utilization of the server' },
  { value: 'mem', label: 'Memory usage (%)', hint: 'Latest memory utilization of the server' },
  { value: 'disk', label: 'Disk usage (%)', hint: 'Latest root disk utilization' },
  { value: 'load', label: 'Load average (1m)', hint: 'Compare against the CPU core count of the host' },
  { value: 'pod_status', label: 'Failing pods (K8s)', hint: 'Fires when any pod is not Running/Succeeded — no threshold needed' },
  { value: 'log_keyword', label: 'Log keyword', hint: 'Not evaluated by the healing engine yet — rule will be saved but never fires' },
]

const OPERATORS = [
  { value: 'gt', label: 'above (>)' },
  { value: 'lt', label: 'below (<)' },
  { value: 'gte', label: 'at or above (≥)' },
]

export function AlertRules() {
  const [rules, setRules] = useState<Rule[]>([])
  const [history, setHistory] = useState<HistoryAction[]>([])
  const [servers, setServers] = useState<ServerData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [tab, setTab] = useState<'rules' | 'history' | 'xml'>('rules')
  const [xmlContent, setXmlContent] = useState('')
  const { can } = usePermission()
  const toast = useToastStore()
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [searchHistory, setSearchHistory] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [rRes, hRes, sRes] = await Promise.all([
        api.get('/api/alert-rules'),
        api.get('/api/healing-actions'),
        api.get('/api/servers'),
      ])
      setRules(rRes.data || [])
      setHistory(hRes.data || [])
      setServers(sRes.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const saveRule = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error('Name required', 'Give the rule a descriptive name.')
      return
    }
    try {
      const payload = { ...form, server_id: Number(form.server_id), cooldown_minutes: Number(form.cooldown_minutes) || 5 }
      if (editId) await api.put(`/api/alert-rules/${editId}`, payload)
      else await api.post('/api/alert-rules', payload)
      setShowForm(false)
      loadData()
      toast.success(editId ? 'Rule updated' : 'Rule created', `"${form.name}" is ${form.enabled ? 'active' : 'saved (paused)'}.`)
    } catch (e: unknown) {
      toast.error('Save failed', apiError(e) || 'Could not save the rule')
    }
  }, [editId, form, loadData, toast])

  const toggleEnable = useCallback(async (rule: Rule) => {
    await api.put(`/api/alert-rules/${rule.id}`, { ...rule, enabled: !rule.enabled })
    loadData()
  }, [loadData])

  const deleteRule = useCallback(async (id: number) => {
    try {
      await api.delete(`/api/alert-rules/${id}`)
      toast.success('Rule deleted', 'The alert rule has been removed.')
      setConfirmDelete(null)
      loadData()
    } catch (e: unknown) {
      toast.error('Delete failed', apiError(e) || 'Could not delete the rule')
      setConfirmDelete(null)
    }
  }, [loadData, toast])

  const getServerName = useCallback((id: number) => {
    if (id === 0) return 'All servers'
    return servers.find(s => s.id === id)?.name || `Server #${id}`
  }, [servers])

  const generateXml = useCallback(() => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- InfraEye alert / self-healing rules -->\n<AlertRules>\n'
    rules.forEach(r => {
      xml += `  <Rule id="${r.id}" name="${escapeXmlAttr(r.name)}" serverId="${r.server_id}" enabled="${r.enabled}">\n`
      xml += `    <Condition type="${escapeXmlAttr(r.condition_type)}" op="${escapeXmlAttr(r.condition_op)}" value="${escapeXmlAttr(r.condition_value)}" />\n`
      xml += `    <Action type="${escapeXmlAttr(r.action_type)}">${escapeXmlText(r.action_command)}</Action>\n`
      xml += `  </Rule>\n`
    })
    xml += '</AlertRules>'
    setXmlContent(xml)
  }, [rules])

  const parseXml = useCallback(async () => {
    setLoading(true)
    try {
      const newRules = parseAlertRulesXml(xmlContent)

      if (newRules.length === 0) throw new Error('No <Rule> elements found in the XML')
      await api.post('/api/alert-rules/batch', newRules)
      toast.success('Rules imported', `${newRules.length} rule${newRules.length === 1 ? '' : 's'} applied.`)
      setTab('rules')
      loadData()
    } catch (e: unknown) {
      toast.error('Import failed', errMessage(e))
    } finally {
      setLoading(false)
    }
  }, [xmlContent, loadData, toast])

  const handleEdit = useCallback((rule: Rule) => {
    setForm({ ...emptyForm, ...rule })
    setEditId(rule.id)
    setShowForm(true)
  }, [])

  const filteredHistory = useMemo(() => {
    if (!searchHistory) return history
    const s = searchHistory.toLowerCase()
    return history.filter(h =>
      getServerName(h.server_id).toLowerCase().includes(s) ||
      h.trigger_info.toLowerCase().includes(s) ||
      h.output.toLowerCase().includes(s) ||
      h.status.toLowerCase().includes(s)
    )
  }, [history, searchHistory, getServerName])

  const enabledCount = useMemo(() => rules.filter(r => r.enabled).length, [rules])
  const selectedMetric = METRICS.find(m => m.value === form.condition_type)
  const needsThreshold = form.condition_type !== 'pod_status'

  const openCreate = () => { setShowForm(true); setForm(emptyForm); setEditId(null) }
  const canManage = can('manage-alerts')

  return (
    <div className="page">
      <PageHeader
        title="Alert Rules"
        subtitle="Self-healing automation — notify or run an SSH remediation when a condition fires. Checked every 60s."
        actions={canManage && <Button icon={<Plus size={15} />} onClick={openCreate}>New Rule</Button>}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <TabSwitcher
            tabs={[
              { id: 'rules', label: 'Rules', icon: Bell, count: rules.length },
              { id: 'history', label: 'History', icon: History, count: history.length },
              { id: 'xml', label: 'Import / Export', icon: FileCode },
            ]}
            active={tab}
            onChange={(id) => { if (id === 'xml') generateXml(); setTab(id as typeof tab) }}
          />
        </Box>
        {tab === 'rules' && rules.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 2, whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>
            {enabledCount} of {rules.length} active
          </Typography>
        )}
      </Box>

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        size="lg"
        title={editId ? 'Edit rule' : 'New alert rule'}
        icon={Zap}
        subtitle="When a condition fires, notify or remediate automatically"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" form="alert-rule-form">{editId ? 'Save changes' : 'Create rule'}</Button>
          </>
        }
      >
        <Box
          component="form" id="alert-rule-form"
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          onSubmit={(e: React.FormEvent) => { e.preventDefault(); saveRule() }}
        >
          {editId && (form as Rule).git_managed && (
            <Alert severity="warning">This rule was created by Git sync — saving changes here will stop future syncs from managing it.</Alert>
          )}

          <TextField label="Name" autoFocus fullWidth value={form.name} placeholder="e.g. High CPU on web servers"
            onChange={e => setForm({ ...form, name: e.target.value })} />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1.4fr 1fr' }, gap: 2 }}>
            <TextField select label="Applies to" value={form.server_id} onChange={e => setForm({ ...form, server_id: Number(e.target.value) })}>
              <MenuItem value={0}>All servers</MenuItem>
              {servers.map(s => <MenuItem key={s.id} value={s.id}>{s.name} ({s.host})</MenuItem>)}
            </TextField>
            <TextField select label="Severity" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
              <MenuItem value="warning">Warning</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </TextField>
          </Box>

          <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="overline" color="text.secondary">Trigger</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: needsThreshold ? '1.4fr 1fr 0.8fr' : '1fr' }, gap: 1.5 }}>
              <TextField select label="Metric" value={form.condition_type} onChange={e => setForm({ ...form, condition_type: e.target.value })}>
                {METRICS.map(m => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
              </TextField>
              {needsThreshold && (
                <>
                  <TextField select label="Operator" value={form.condition_op} onChange={e => setForm({ ...form, condition_op: e.target.value })}>
                    {OPERATORS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                  </TextField>
                  <TextField label="Threshold" placeholder="80" value={form.condition_value} onChange={e => setForm({ ...form, condition_value: e.target.value })} />
                </>
              )}
            </Box>
            {selectedMetric && (
              <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: selectedMetric.value === 'log_keyword' ? 'warning.main' : 'text.secondary' }}>
                {selectedMetric.value === 'log_keyword' && <AlertTriangle size={13} />}
                {selectedMetric.hint}
              </Typography>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="overline" color="text.secondary">Response</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1.4fr 1fr' }, gap: 1.5 }}>
              <TextField select label="Action" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                <MenuItem value="notify">Notify only</MenuItem>
                <MenuItem value="ssh_command">Run SSH command</MenuItem>
              </TextField>
              <TextField label="Cooldown (minutes)" type="number" slotProps={{ htmlInput: { min: 1 } }}
                value={form.cooldown_minutes} onChange={e => setForm({ ...form, cooldown_minutes: Number(e.target.value) })} />
            </Box>
            {form.action_type === 'ssh_command' && (
              <>
                <TextField
                  label="Command" multiline minRows={3} fullWidth placeholder="systemctl restart nginx"
                  value={form.action_command} onChange={e => setForm({ ...form, action_command: e.target.value })}
                  slotProps={{ htmlInput: { style: { fontFamily: 'var(--font-mono)', fontSize: 13 } } }}
                />
                <Alert severity="warning" icon={<ShieldAlert size={16} />}>
                  Runs automatically over SSH with the connection user's privileges every time the rule fires (rate-limited by the cooldown). Prefer idempotent, non-destructive commands.
                </Alert>
              </>
            )}
          </Paper>
        </Box>
      </Modal>

      {tab === 'xml' && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 2.5, pt: 2, pb: 0.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
            <SectionHeader
              icon={FileCode}
              title="Rules as XML"
              subtitle="Export the current rules, edit them, and apply to bulk-import."
              action={
                <>
                  <Button variant="secondary" size="sm" onClick={generateXml}>Regenerate</Button>
                  <Button size="sm" onClick={parseXml}>Apply XML</Button>
                </>
              }
            />
          </Box>
          <TextField
            multiline fullWidth minRows={20} maxRows={20} value={xmlContent}
            onChange={e => setXmlContent(e.target.value)}
            slotProps={{
              htmlInput: { spellCheck: false, style: { fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6 } },
              input: { sx: { borderRadius: 0, p: 2.5, '& fieldset': { border: 'none' } } },
            }}
          />
        </Paper>
      )}

      {tab === 'rules' && (
        loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 15 }}><CircularProgress /></Box>
        ) : rules.length === 0 ? (
          <Paper variant="outlined" sx={{ borderStyle: 'dashed' }}>
            <EmptyState
              icon={Bell}
              title="No alert rules yet"
              description="Rules watch your servers' metrics every minute and react automatically — send a notification, or run an SSH command to self-heal before anyone is paged."
              action={canManage && <Button icon={<Plus size={14} />} onClick={openCreate}>Create your first rule</Button>}
            />
          </Paper>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 2, pb: 5 }}>
            {rules.map(rule => (
              <RuleCard key={rule.id} rule={rule} serverName={getServerName(rule.server_id)} canManage={canManage} onEdit={handleEdit} onDelete={deleteRule} onToggle={toggleEnable} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} />
            ))}
          </Box>
        )
      )}

      {tab === 'history' && (
        <Box>
          <Box sx={{ mb: 2, maxWidth: 420 }}>
            <SearchInput value={searchHistory} onChange={setSearchHistory} placeholder="Search history — server, trigger, output…" />
          </Box>
          <Paper variant="outlined">
            {filteredHistory.length === 0 ? (
              <EmptyState
                icon={History}
                title={history.length === 0 ? 'No remediations have fired yet' : 'Nothing matches the search'}
                description={history.length === 0 ? "That's a good sign — it means nothing has needed automatic remediation." : undefined}
              />
            ) : (
              <TableContainer sx={{ maxHeight: 'calc(100vh - 340px)' }}>
                <Table stickyHeader size="small" sx={{ minWidth: 860 }}>
                  <TableHead>
                    <TableRow>
                      {['Time', 'Server', 'Trigger', 'Status', 'Output'].map(h => <TableCell key={h}>{h}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredHistory.map(h => (
                      <HistoryRow key={h.id} history={h} serverName={getServerName(h.server_id)} />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Box>
      )}
    </div>
  )
}
