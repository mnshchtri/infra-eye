import { useEffect, useState, useCallback, useMemo, memo } from 'react'
import { Plus, Bell, Trash2, Pencil, History, X, Zap, Activity, FileCode } from 'lucide-react'
import { api } from '../api/client'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'

// Sub-components
import { RuleCard } from '../components/alerts/RuleCard'
import { HistoryRow } from '../components/alerts/HistoryRow'

interface Rule {
  id: number; name: string; server_id: number;
  condition_type: string; condition_op: string; condition_value: string;
  action_type: string; action_command: string; severity: string; enabled: boolean;
}
interface HistoryAction {
  id: number; created_at: string; server_id: number; trigger_info: string;
  command: string; output: string; status: string;
}
interface ServerData { id: number; name: string; host: string }

const emptyForm = {
  name: '', server_id: 0, condition_type: 'cpu',
  condition_op: 'gt', condition_value: '80', severity: 'warning',
  action_type: 'notify', action_command: '', enabled: true
}

const CONDITION_COLORS: Record<string, string> = {
  cpu: 'var(--warning)', mem: 'var(--info)', disk: 'var(--brand-primary)',
  load: 'var(--success)', log_keyword: 'var(--danger)',
  pod_status: 'var(--info)',
}

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
    try {
      if (editId) await api.put(`/api/alert-rules/${editId}`, { ...form, server_id: Number(form.server_id) })
      else await api.post('/api/alert-rules', { ...form, server_id: Number(form.server_id) })
      setShowForm(false)
      loadData()
      toast.success(editId ? 'Rule updated' : 'Rule created', 'The self-healing rule is now active.')
    } catch (e: any) {
      toast.error('Save failed', e.response?.data?.error || 'Could not save rule')
    }
  }, [editId, form, loadData, toast])

  const toggleEnable = useCallback(async (rule: Rule) => {
    await api.put(`/api/alert-rules/${rule.id}`, { ...rule, enabled: !rule.enabled })
    loadData()
  }, [loadData])

  const deleteRule = useCallback(async (id: number) => {
    try {
      await api.delete(`/api/alert-rules/${id}`)
      toast.success('Rule deleted', 'The self-healing rule has been removed.')
      setConfirmDelete(null)
      loadData()
    } catch (e: any) {
      toast.error('Delete failed', e.response?.data?.error || 'Could not delete rule')
      setConfirmDelete(null)
    }
  }, [loadData, toast])

  const getServerName = useCallback((id: number) => {
    if (id === 0) return 'All Servers'
    return servers.find(s => s.id === id)?.name || `Server #${id}`
  }, [servers])

  const generateXml = useCallback(() => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<AlertRules>\n'
    rules.forEach(r => {
      xml += `  <Rule id="${r.id}" name="${r.name}" serverId="${r.server_id}" enabled="${r.enabled}">\n`
      xml += `    <Condition type="${r.condition_type}" op="${r.condition_op}" value="${r.condition_value}" />\n`
      xml += `    <Action type="${r.action_type}">${r.action_command}</Action>\n`
      xml += `  </Rule>\n`
    })
    xml += '</AlertRules>'
    setXmlContent(xml)
  }, [rules])

  const parseXml = useCallback(async () => {
    setLoading(true)
    try {
      const parser = new DOMParser()
      const xmlDoc = parser.parseFromString(xmlContent, "text/xml")
      const ruleNodes = xmlDoc.getElementsByTagName("Rule")
      
      const newRules = Array.from(ruleNodes).map(node => ({
        name: node.getAttribute("name") || "Rule",
        server_id: parseInt(node.getAttribute("serverId") || "0"),
        enabled: node.getAttribute("enabled") !== "false",
        condition_type: node.getElementsByTagName("Condition")[0]?.getAttribute("type") || "cpu",
        condition_op: node.getElementsByTagName("Condition")[0]?.getAttribute("op") || "gt",
        condition_value: node.getElementsByTagName("Condition")[0]?.getAttribute("value") || "80",
        action_type: node.getElementsByTagName("Action")[0]?.getAttribute("type") || "ssh_command",
        action_command: node.getElementsByTagName("Action")[0]?.textContent || ""
      }))

      if (newRules.length === 0) throw new Error("No valid rules found in XML")
      await api.post('/api/alert-rules/batch', newRules)
      toast.success("Infrastructure synchronized", `${newRules.length} rules updated.`)
      setTab('rules')
      loadData()
    } catch (e: any) {
      toast.error("Sync Failed", e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }, [xmlContent, loadData, toast])

  const handleEdit = useCallback((rule: Rule) => {
    setForm(rule as any)
    setEditId(rule.id)
    setShowForm(true)
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Self-Healing Rules</h1>
          <p className="page-subtitle">Automated remediation — define conditions that trigger SSH commands</p>
        </div>
        {can('manage-alerts') && (
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setForm(emptyForm); setEditId(null) }}>
            <Plus size={14} /> Create Rule
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 32, background: 'var(--bg-elevated)', borderRadius: 14, padding: 4, width: 'fit-content', border: '1px solid var(--border)' }}>
        {(['rules', 'history', 'xml'] as const).map(t => (
          <button
            key={t}
            onClick={() => { if (t === 'xml') generateXml(); setTab(t); }}
            style={{
              padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
              transition: 'all 0.2s', cursor: 'pointer', border: 'none',
              display: 'flex', alignItems: 'center', gap: 7,
              ...(tab === t
                ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)', boxShadow: '0 4px 12px var(--brand-glow)' }
                : { background: 'transparent', color: 'var(--text-muted)' }
              ),
            }}
          >
            {t === 'rules' && <><Bell size={13} /> Active Rules</>}
            {t === 'history' && <><History size={13} /> Action History</>}
            {t === 'xml' && <><FileCode size={13} /> Source (XML)</>}
          </button>
        ))}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'var(--glass-bg)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setShowForm(false)}>
          <div className="fade-up" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: 24, padding: 36, width: '100%', maxWidth: 560, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{editId ? 'Edit Rule' : 'New Alert Rule'}</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Define a condition and remediation action</p>
              </div>
              <button onClick={() => setShowForm(false)} style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={15} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}><label className="input-label">Rule Name</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="High CPU Alert" /></div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}><label className="input-label">Target Server</label><select className="input" value={form.server_id} onChange={e => setForm({ ...form, server_id: Number(e.target.value) })}><option value={0}>All Servers</option>{servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="input-group">
                <label className="input-label">Metric Type</label>
                <select className="input" value={form.condition_type} onChange={e => setForm({ ...form, condition_type: e.target.value })}>
                  <option value="cpu">CPU %</option><option value="mem">Memory %</option><option value="disk">Disk %</option>
                  <option value="load">Load Average</option><option value="log_keyword">Log Keyword</option><option value="pod_status">Pods Not Running (K8s)</option>
                </select>
              </div>
              <div className="input-group" style={{ display: form.condition_type === 'pod_status' ? 'none' : 'flex' }}><label className="input-label">Operator</label><select className="input" value={form.condition_op} onChange={e => setForm({ ...form, condition_op: e.target.value })}><option value="gt">Greater than (&gt;)</option><option value="lt">Less than (&lt;)</option><option value="gte">Greater or equal (&gt;=)</option></select></div>
              <div className="input-group" style={{ gridColumn: '1 / -1', display: form.condition_type === 'pod_status' ? 'none' : 'flex' }}><label className="input-label">Threshold Value</label><input className="input" value={form.condition_value} onChange={e => setForm({ ...form, condition_value: e.target.value })} placeholder="80" /></div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}><label className="input-label">Action</label><select className="input" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}><option value="ssh_command">Execute SSH Command</option><option value="notify">Notify Only</option></select></div>
              {form.action_type === 'ssh_command' && (<div className="input-group" style={{ gridColumn: '1 / -1' }}><label className="input-label">Remediation Command</label><textarea className="input" rows={3} style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, resize: 'vertical' }} value={form.action_command} onChange={e => setForm({ ...form, action_command: e.target.value })} placeholder="systemctl restart nginx && echo 'Restarted'" /></div>)}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}><button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>Cancel</button><button className="btn btn-primary" style={{ flex: 2 }} onClick={saveRule}>Save Rule</button></div>
          </div>
        </div>
      )}

      {tab === 'xml' && (
        <div className="fade-in">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileCode size={22} color="var(--brand-primary)" /></div>
                <div><h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Rule Definitions (XML)</h2><p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Advanced configuration for infrastructure automation</p></div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}><button className="btn btn-secondary" onClick={generateXml}>Reset View</button><button className="btn btn-primary" onClick={parseXml}>Sync Rules</button></div>
            </div>
            <textarea className="input" value={xmlContent} onChange={e => setXmlContent(e.target.value)} style={{ width: '100%', height: 450, border: 'none', borderRadius: 0, fontFamily: '"JetBrains Mono", monospace', fontSize: 13, padding: 32, background: 'var(--bg-app)', color: 'var(--brand-primary)', lineHeight: 1.6, resize: 'none' }} spellCheck={false} />
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}><div className="spinner" /></div>
          ) : rules.length === 0 ? (
            <div className="empty-state">
              <div style={{ width: 72, height: 72, borderRadius: 22, background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Bell size={32} color="var(--brand-primary)" /></div>
              <p>No rules defined</p><span>Create rules to automatically remediate issues in your infrastructure</span>
              {can('manage-alerts') && (<button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => { setShowForm(true); setForm(emptyForm); setEditId(null) }}><Plus size={14} /> Create First Rule</button>)}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 24 }}>
              {rules.map((rule, i) => (
                <RuleCard key={rule.id} rule={rule} serverName={getServerName(rule.server_id)} condColor={CONDITION_COLORS[rule.condition_type] || 'var(--brand-primary)'} canManage={can('manage-alerts')} onEdit={handleEdit} onDelete={deleteRule} onToggle={toggleEnable} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <div className="card fade-in" style={{ padding: 0, overflow: 'hidden' }}>
          {history.length === 0 ? (
            <div className="empty-state" style={{ padding: '80px 0' }}><History size={40} color="var(--text-muted)" /><p>Remediation log is clear</p></div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead><tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>{['Time', 'Server', 'Trigger Event', 'Remediation Output'].map(h => (<th key={h} style={{ padding: '16px 24px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>))}</tr></thead>
              <tbody>{history.map((h, i) => (<HistoryRow key={h.id} history={h} serverName={getServerName(h.server_id)} isLast={i === history.length - 1} />))}</tbody>
            </table>
          )}
        </div>
      )}

      <style>{`
        .spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--brand-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .btn-icon { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; background: var(--bg-card); transition: all 0.2s; box-shadow: var(--shadow-sm); }
        .btn-icon:hover { border-color: var(--brand-primary); color: var(--brand-primary); background: var(--bg-elevated); transform: translateY(-1px); box-shadow: var(--shadow-md); }
        .btn-icon.danger:hover { border-color: var(--danger); color: var(--danger); background: var(--danger)10; }
      `}</style>
    </div>
  )
}
