import { useEffect, useState } from 'react'
import { Plus, Bell, Trash2, Pencil, History, X, Zap, Shield, Activity } from 'lucide-react'
import { api } from '../api/client'
import { format } from 'date-fns'
import { usePermission } from '../hooks/usePermission'

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
  const { can } = usePermission()

  useEffect(() => { loadData() }, [])

  async function loadData() {
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
    if (!confirm('Delete this rule?')) return
    await api.delete(`/api/alert-rules/${id}`)
    loadData()
  }

  function getServerName(id: number) {
    if (id === 0) return 'All Servers'
    return servers.find(s => s.id === id)?.name || `Server #${id}`
  }

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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 32, background: 'var(--bg-elevated)', borderRadius: 14, padding: 4, width: 'fit-content', border: '1px solid var(--border)' }}>
        {(['rules', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
              transition: 'all 0.2s', cursor: 'pointer', border: 'none',
              display: 'flex', alignItems: 'center', gap: 7,
              ...(tab === t
                ? { background: 'var(--brand-primary)', color: 'var(--text-primary)', boxShadow: '0 4px 12px var(--brand-glow)' }
                : { background: 'transparent', color: 'var(--text-muted)' }
              ),
            }}
          >
            {t === 'rules' ? <><Bell size={13} /> Active Rules</> : <><History size={13} /> Action History</>}
          </button>
        ))}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => setShowForm(false)}
        >
          <div
            className="fade-up"
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
              borderRadius: 24, padding: 36, width: '100%', maxWidth: 560,
              boxShadow: 'var(--shadow-lg)',
              maxHeight: '90vh', overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {editId ? 'Edit Rule' : 'New Alert Rule'}
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Define a condition and remediation action</p>
              </div>
              <button
                onClick={() => setShowForm(false)}
                style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label className="input-label">Rule Name</label>
                <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="High CPU Alert" />
              </div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label className="input-label">Target Server</label>
                <select className="input" value={form.server_id} onChange={e => setForm({ ...form, server_id: Number(e.target.value) })}>
                  <option value={0}>All Servers</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Metric Type</label>
                <select className="input" value={form.condition_type} onChange={e => setForm({ ...form, condition_type: e.target.value })}>
                  <option value="cpu">CPU %</option>
                  <option value="mem">Memory %</option>
                  <option value="disk">Disk %</option>
                  <option value="load">Load Average</option>
                  <option value="log_keyword">Log Keyword</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Operator</label>
                <select className="input" value={form.condition_op} onChange={e => setForm({ ...form, condition_op: e.target.value })}>
                  <option value="gt">Greater than (&gt;)</option>
                  <option value="lt">Less than (&lt;)</option>
                  <option value="gte">Greater or equal (&gt;=)</option>
                </select>
              </div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label className="input-label">Threshold Value</label>
                <input className="input" value={form.condition_value} onChange={e => setForm({ ...form, condition_value: e.target.value })} placeholder="80" />
              </div>
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label className="input-label">Action</label>
                <select className="input" value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                  <option value="ssh_command">Execute SSH Command</option>
                  <option value="notify">Notify Only</option>
                </select>
              </div>
              {form.action_type === 'ssh_command' && (
                <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="input-label">Remediation Command</label>
                  <textarea
                    className="input"
                    rows={3}
                    style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, resize: 'vertical' }}
                    value={form.action_command}
                    onChange={e => setForm({ ...form, action_command: e.target.value })}
                    placeholder="systemctl restart nginx && echo 'Restarted'"
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={saveRule}>Save Rule</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : tab === 'rules' ? (
        rules.length === 0 ? (
          <div className="empty-state">
            <div style={{ width: 72, height: 72, borderRadius: 22, background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bell size={32} color="var(--brand-primary)" />
            </div>
            <p>No rules defined</p>
            <span>Create rules to automatically remediate issues in your infrastructure</span>
            {can('manage-alerts') && (
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setShowForm(true)}>
                <Plus size={14} /> Create First Rule
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
            {rules.map((rule, i) => {
              const condColor = CONDITION_COLORS[rule.condition_type] || 'var(--brand-primary)'
              return (
                <div key={rule.id} className="card fade-up" style={{ animationDelay: `${i * 60}ms`, padding: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 11, background: `${condColor}15`, border: `1px solid ${condColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Activity size={16} color={condColor} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{rule.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{getServerName(rule.server_id)}</div>
                      </div>
                    </div>
                    {can('manage-alerts') && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {/* Toggle */}
                        <div
                          onClick={() => toggleEnable(rule)}
                          style={{
                            width: 36, height: 20, borderRadius: 20, cursor: 'pointer', transition: 'all 0.3s', position: 'relative',
                            background: rule.enabled ? 'var(--success)' : 'rgba(255,255,255,0.1)',
                          }}
                        >
                          <div style={{
                            position: 'absolute', top: 2, left: rule.enabled ? 18 : 2, width: 16, height: 16,
                            borderRadius: '50%', background: '#fff', transition: 'left 0.3s',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                          }} />
                        </div>
                        <button style={{ padding: '5px 8px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => { setForm(rule as any); setEditId(rule.id); setShowForm(true) }}>
                          <Pencil size={11} />
                        </button>
                        <button style={{ padding: '5px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--danger)', cursor: 'pointer' }} onClick={() => deleteRule(rule.id)}>
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Condition block */}
                  <div style={{ background: '#f1f5f9', padding: '10px 14px', borderRadius: 10, marginBottom: 12, border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: condColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>IF </span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: '"JetBrains Mono", monospace' }}>
                      {rule.condition_type} {rule.condition_op === 'gt' ? '>' : rule.condition_op === 'lt' ? '<' : '>='} {rule.condition_value}
                    </span>
                  </div>

                  {/* Action block */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {rule.action_type === 'ssh_command'
                      ? <Zap size={13} color="var(--warning)" style={{ marginTop: 2, flexShrink: 0 }} />
                      : <Shield size={13} color="var(--info)" style={{ marginTop: 2, flexShrink: 0 }} />
                    }
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace', wordBreak: 'break-all' }}>
                      {rule.action_command || rule.action_type}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        /* History tab */
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {history.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <History size={36} color="var(--text-muted)" />
              <p>No actions triggered yet</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Server', 'Trigger', 'Command', 'Result'].map(h => (
                    <th key={h} style={{ padding: '14px 20px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={h.id} style={{ borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--text-muted)', fontFamily: '"JetBrains Mono", monospace' }}>
                      {format(new Date(h.created_at), 'MMM d, HH:mm:ss')}
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{getServerName(h.server_id)}</td>
                    <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--text-secondary)' }}>{h.trigger_info}</td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: 'var(--text-muted)', background: '#f1f5f9', padding: '3px 8px', borderRadius: 6 }}>
                        {h.command || 'notify'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span className={`badge badge-${h.status === 'success' ? 'online' : 'offline'}`}>
                        {h.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
