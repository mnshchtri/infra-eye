import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, Bell, History, Zap, FileCode, ShieldAlert, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import { Modal, SectionHeader, EmptyState, SearchInput, TabSwitcher } from '../components/ui'

// Sub-components
import { RuleCard } from '../components/alerts/RuleCard'
import { HistoryRow } from '../components/alerts/HistoryRow'
import { apiError, errMessage } from '../utils/errors'

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

const CONDITION_COLORS: Record<string, string> = {
  cpu: '#f59e0b', mem: '#3b82f6', disk: '#ec4899',
  load: '#10b981', log_keyword: '#ef4444',
  pod_status: '#8b5cf6',
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
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml')
      if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('The XML is not well-formed — check for unescaped characters like < or & in rule values.')
      }
      const ruleNodes = xmlDoc.getElementsByTagName('Rule')

      const newRules = Array.from(ruleNodes).map(node => ({
        name: node.getAttribute('name') || 'Rule',
        server_id: parseInt(node.getAttribute('serverId') || '0'),
        enabled: node.getAttribute('enabled') !== 'false',
        condition_type: node.getElementsByTagName('Condition')[0]?.getAttribute('type') || 'cpu',
        condition_op: node.getElementsByTagName('Condition')[0]?.getAttribute('op') || 'gt',
        condition_value: node.getElementsByTagName('Condition')[0]?.getAttribute('value') || '80',
        action_type: node.getElementsByTagName('Action')[0]?.getAttribute('type') || 'ssh_command',
        action_command: node.getElementsByTagName('Action')[0]?.textContent || '',
      }))

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

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
  }
  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

  return (
    <div className="page">
      {/* ── Header ── */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Alert Rules</h1>
          <p className="page-subtitle" style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 4 }}>
            Self-healing automation — notify or run an SSH remediation when a condition fires. Checked every 60s.
          </p>
        </div>
        {can('manage-alerts') && (
          <button
            className="btn btn-primary"
            onClick={() => { setShowForm(true); setForm(emptyForm); setEditId(null) }}
            style={{ gap: 8 }}
          >
            <Plus size={15} /> <span className="hidden-mobile">New Rule</span>
          </button>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="tabs-scroll-x" style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <TabSwitcher
          tabs={[
            { id: 'rules', label: 'Rules', icon: Bell, count: rules.length },
            { id: 'history', label: 'History', icon: History, count: history.length },
            { id: 'xml', label: 'Import / Export', icon: FileCode },
          ]}
          active={tab}
          onChange={(id) => { if (id === 'xml') generateXml(); setTab(id as typeof tab) }}
        />
        {tab === 'rules' && rules.length > 0 && (
          <span className="hidden-mobile" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {enabledCount} of {rules.length} active
          </span>
        )}
      </div>

      {/* ── Create / Edit modal ── */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        size="lg"
        title={editId ? 'Edit rule' : 'New alert rule'}
        icon={Zap}
        subtitle="When a condition fires, notify or remediate automatically"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="alert-rule-form" className="btn btn-primary">{editId ? 'Save changes' : 'Create rule'}</button>
          </>
        }
      >
        {editId && (form as Rule).git_managed && (
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
            This rule was created by Git sync — saving changes here will stop future syncs from managing it.
          </p>
        )}

        <form id="alert-rule-form" style={{ display: 'flex', flexDirection: 'column', gap: 18 }} onSubmit={e => { e.preventDefault(); saveRule() }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Name</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. High CPU on web servers" autoFocus />
          </div>

          <div className="alert-form-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Applies to</label>
              <select className="input" value={form.server_id} onChange={e => setForm({ ...form, server_id: Number(e.target.value) })}>
                <option value={0}>All servers</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
              </select>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Severity</label>
              <select className="input" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Trigger */}
          <div style={{ padding: 16, background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Trigger</div>
            <div className="alert-form-grid" style={{ display: 'grid', gridTemplateColumns: needsThreshold ? '1.4fr 1fr 0.8fr' : '1fr', gap: 12 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Metric</label>
                <select className="input" value={form.condition_type} onChange={e => setForm({ ...form, condition_type: e.target.value })}>
                  {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {needsThreshold && (
                <>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Operator</label>
                    <select className="input" value={form.condition_op} onChange={e => setForm({ ...form, condition_op: e.target.value })}>
                      {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div style={fieldStyle}>
                    <label style={labelStyle}>Threshold</label>
                    <input className="input" value={form.condition_value} onChange={e => setForm({ ...form, condition_value: e.target.value })} placeholder="80" />
                  </div>
                </>
              )}
            </div>
            {selectedMetric && (
              <p style={{ fontSize: 12.5, color: selectedMetric.value === 'log_keyword' ? 'var(--warning)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {selectedMetric.value === 'log_keyword' && <AlertTriangle size={13} />}
                {selectedMetric.hint}
              </p>
            )}
          </div>

          {/* Response */}
          <div style={{ padding: 16, background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Response</div>
            <div className="alert-form-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
              <div style={fieldStyle}>
                <label style={labelStyle}>Action</label>
                <select className="input" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                  <option value="notify">Notify only</option>
                  <option value="ssh_command">Run SSH command</option>
                </select>
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Cooldown (minutes)</label>
                <input className="input" type="number" min={1} value={form.cooldown_minutes} onChange={e => setForm({ ...form, cooldown_minutes: Number(e.target.value) })} />
              </div>
            </div>
            {form.action_type === 'ssh_command' && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Command</label>
                <textarea
                  className="input" rows={3}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 13, resize: 'vertical' }}
                  value={form.action_command}
                  onChange={e => setForm({ ...form, action_command: e.target.value })}
                  placeholder="systemctl restart nginx"
                />
                <p style={{ fontSize: 12.5, color: 'var(--warning)', display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.5 }}>
                  <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  Runs automatically over SSH with the connection user's privileges every time the rule fires (rate-limited by the cooldown). Prefer idempotent, non-destructive commands.
                </p>
              </div>
            )}
          </div>
        </form>
      </Modal>

      {/* ── XML import / export ── */}
      {tab === 'xml' && (
        <div className="fade-in">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              <SectionHeader
                className="section-header-flush"
                icon={FileCode}
                title="Rules as XML"
                subtitle="Export the current rules, edit them, and apply to bulk-import."
                action={
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={generateXml}>Regenerate</button>
                    <button className="btn btn-primary btn-sm" onClick={parseXml}>Apply XML</button>
                  </>
                }
              />
            </div>
            <textarea
              className="input"
              value={xmlContent}
              onChange={e => setXmlContent(e.target.value)}
              style={{ width: '100%', height: 480, border: 'none', borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 13, padding: 20, background: 'var(--term-bg-subtle)', color: 'var(--term-text)', lineHeight: 1.6, resize: 'none' }}
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* ── Rules grid ── */}
      {tab === 'rules' && (
        <>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0' }}>
              <div className="loader-spin" style={{ width: 36, height: 36, border: '2px solid var(--border)', borderTopColor: 'var(--brand-primary)' }} />
            </div>
          ) : rules.length === 0 ? (
            <div style={{ border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
              <EmptyState
                icon={Bell}
                title="No alert rules yet"
                description="Rules watch your servers' metrics every minute and react automatically — send a notification, or run an SSH command to self-heal before anyone is paged."
                action={can('manage-alerts') && (
                  <button className="btn btn-primary" style={{ gap: 8 }} onClick={() => { setShowForm(true); setForm(emptyForm); setEditId(null) }}>
                    <Plus size={14} /> Create your first rule
                  </button>
                )}
              />
            </div>
          ) : (
            <div className="alert-rules-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 16, paddingBottom: 40 }}>
              {rules.map(rule => (
                <RuleCard key={rule.id} rule={rule} serverName={getServerName(rule.server_id)} condColor={CONDITION_COLORS[rule.condition_type] || 'var(--brand-primary)'} canManage={can('manage-alerts')} onEdit={handleEdit} onDelete={deleteRule} onToggle={toggleEnable} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <div className="fade-in">
          <div style={{ marginBottom: 16, maxWidth: 420 }}>
            <SearchInput
              value={searchHistory}
              onChange={setSearchHistory}
              placeholder="Search history — server, trigger, output…"
            />
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {filteredHistory.length === 0 ? (
              <EmptyState
                icon={History}
                title={history.length === 0 ? 'No remediations have fired yet' : 'Nothing matches the search'}
                description={history.length === 0 ? 'That\'s a good sign — it means nothing has needed automatic remediation.' : undefined}
              />
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
                <table className="k-table" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      {['Time', 'Server', 'Trigger', 'Status', 'Output'].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map(h => (
                      <HistoryRow key={h.id} history={h} serverName={getServerName(h.server_id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .loader-spin { border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
