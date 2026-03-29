import { useEffect, useState } from 'react'
import { Plus, Bell, Trash2, Pencil, Activity, Server, History } from 'lucide-react'
import { api } from '../api/client'
import { format } from 'date-fns'

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

export function AlertRules() {
  const [rules, setRules] = useState<Rule[]>([])
  const [history, setHistory] = useState<HistoryAction[]>([])
  const [servers, setServers] = useState<ServerData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [tab, setTab] = useState<'rules' | 'history'>('rules')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [rRes, hRes, sRes] = await Promise.all([
        api.get('/api/alert-rules'),
        api.get('/api/healing-actions'),
        api.get('/api/servers')
      ])
      setRules(rRes.data || [])
      setHistory(hRes.data || [])
      setServers(sRes.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function saveRule() {
    try {
      if (editId) await api.put(`/api/alert-rules/${editId}`, { ...form, server_id: Number(form.server_id) })
      else await api.post('/api/alert-rules', { ...form, server_id: Number(form.server_id) })
      setShowForm(false)
      loadData()
    } catch (e: any) { alert(e.response?.data?.error || 'Save failed') }
  }

  async function toggleEnable(rule: Rule) {
    await api.put(`/api/alert-rules/${rule.id}`, { ...rule, enabled: !rule.enabled })
    loadData()
  }

  async function deleteRule(id: number) {
    if (!confirm('Delete rule?')) return
    await api.delete(`/api/alert-rules/${id}`)
    loadData()
  }

  function getServerName(id: number) {
    if (id === 0) return 'All Servers'
    return servers.find(s => s.id === id)?.name || `ID:${id}`
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Self-Healing Rules</h1>
          <p className="page-subtitle">Define conditions that automatically trigger SSH remediation commands</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setForm(emptyForm); setEditId(null) }}>
          <Plus size={14} /> Create Rule
        </button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>
          <Bell size={14} /> Active Rules
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <History size={14} /> Action History
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal fade-in" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">{editId ? 'Edit Rule' : 'New Alert Rule'}</h2>
            <div className="modal-form">
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Rule Name *</label>
                  <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Target Server</label>
                  <select className="input" value={form.server_id} onChange={e => setForm({ ...form, server_id: Number(e.target.value) })}>
                    <option value={0}>All Servers</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid-3">
                <div className="form-group">
                  <label className="form-label">Metric Type</label>
                  <select className="input" value={form.condition_type} onChange={e => setForm({ ...form, condition_type: e.target.value })}>
                    <option value="cpu">CPU %</option>
                    <option value="mem">Memory %</option>
                    <option value="disk">Disk %</option>
                    <option value="load">Load Average</option>
                    <option value="log_keyword">Log Keyword Found</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Operator</label>
                  <select className="input" value={form.condition_op} onChange={e => setForm({ ...form, condition_op: e.target.value })}>
                    <option value="gt">Greater than (&gt;)</option>
                    <option value="lt">Less than (&lt;)</option>
                    <option value="gte">Greater or equal (&gt;=)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Value Threshold</label>
                  <input className="input" value={form.condition_value} onChange={e => setForm({ ...form, condition_value: e.target.value })} placeholder="80" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Action to Take</label>
                <select className="input" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                  <option value="ssh_command">Execute SSH Command</option>
                  <option value="notify">Notify Only</option>
                </select>
              </div>

              {form.action_type === 'ssh_command' && (
                <div className="form-group">
                  <label className="form-label">Remediation Bash Command</label>
                  <textarea className="input" rows={3} style={{ fontFamily: 'monospace' }} value={form.action_command}
                    onChange={e => setForm({ ...form, action_command: e.target.value })}
                    placeholder="systemctl restart nginx && echo 'Restarted NGINX'" />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRule}>Save Rule</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : tab === 'rules' ? (
        <div className="grid-3 fade-in">
          {rules.length === 0 ? (
            <div className="empty-state" style={{ gridColumn: 'span 3' }}>No rules defined.</div>
          ) : rules.map(rule => (
            <div key={rule.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontWeight: 600 }}>{rule.name}</h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <label className="switch">
                    <input type="checkbox" checked={rule.enabled} onChange={() => toggleEnable(rule)} />
                    <span className="slider round"></span>
                  </label>
                  <button className="btn btn-secondary" style={{ padding: 4 }} onClick={() => { setForm(rule as any); setEditId(rule.id); setShowForm(true) }}><Pencil size={12} /></button>
                  <button className="btn btn-danger" style={{ padding: 4 }} onClick={() => deleteRule(rule.id)}><Trash2 size={12} /></button>
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Target: {getServerName(rule.server_id)}
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }}>
                <span style={{ color: 'var(--info)' }}>IF</span> {rule.condition_type} {rule.condition_op} {rule.condition_value}
              </div>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: rule.action_type === 'ssh_command' ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {rule.action_type === 'ssh_command' ? 'EXECUTE:' : 'ACTION:'}
                </strong>
                <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                  {rule.action_command || rule.action_type}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card fade-in" style={{ padding: 0 }}>
          <table className="servers-table">
            <thead>
              <tr><th>Time</th><th>Server</th><th>Trigger</th><th>Command</th><th>Status</th></tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id}>
                  <td>{format(new Date(h.created_at), 'MMM d, HH:mm:ss')}</td>
                  <td>{getServerName(h.server_id)}</td>
                  <td style={{ fontSize: 12 }}>{h.trigger_info}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{h.command || 'notify'}</td>
                  <td>
                    <span className={`badge badge-${h.status === 'success' ? 'success' : 'danger'}`}>
                      {h.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
