import { useState, useEffect, useRef } from 'react'
import { Plus, Server, Trash2, Pencil, Wifi, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { api } from '../api/client'
import { useNavigate, useSearchParams } from 'react-router-dom'

interface ServerData {
  id: number; name: string; host: string; port: number;
  ssh_user: string; auth_type: string; tags: string;
  description: string; status: string; ssh_key_path: string;
}

const emptyForm = {
  name: '', host: '', port: 22, ssh_user: 'root',
  auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa',
  ssh_password: '', tags: '', description: '',
}

export function Servers() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [servers, setServers] = useState<ServerData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string }>>({})

  useEffect(() => {
    loadServers()
    if (searchParams.get('add')) setShowForm(true)
  }, [])

  async function loadServers() {
    setLoading(true)
    try {
      const res = await api.get('/api/servers')
      setServers(res.data)
    } finally {
      setLoading(false)
    }
  }

  async function saveServer() {
    setSaving(true)
    try {
      if (editId) {
        await api.put(`/api/servers/${editId}`, form)
      } else {
        await api.post('/api/servers', form)
      }
      setShowForm(false)
      setEditId(null)
      setForm(emptyForm)
      loadServers()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function editServer(s: ServerData) {
    setForm({
      name: s.name, host: s.host, port: s.port, ssh_user: s.ssh_user,
      auth_type: s.auth_type, ssh_key_path: s.ssh_key_path || '',
      ssh_password: '', tags: s.tags, description: s.description,
    })
    setEditId(s.id)
    setShowForm(true)
  }

  async function deleteServer(id: number) {
    if (!confirm('Delete this server? This cannot be undone.')) return
    await api.delete(`/api/servers/${id}`)
    loadServers()
  }

  async function testConnection(id: number) {
    setTesting(id)
    try {
      const res = await api.post(`/api/servers/${id}/test`)
      setTestResults(prev => ({ ...prev, [id]: { ok: res.data.status === 'online', msg: res.data.output || res.data.error || '' } }))
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, msg: 'Connection failed' } }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Servers</h1>
          <p className="page-subtitle">Manage your connected infrastructure</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm) }}>
          <Plus size={14} /> Add Server
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal fade-in" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">{editId ? 'Edit Server' : 'Add Server'}</h2>
            <div className="modal-form">
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="prod-web-01" />
                </div>
                <div className="form-group">
                  <label className="form-label">Host / IP *</label>
                  <input className="input" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.100" />
                </div>
                <div className="form-group">
                  <label className="form-label">SSH Port</label>
                  <input className="input" type="number" value={form.port} onChange={e => setForm({ ...form, port: +e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">SSH User *</label>
                  <input className="input" value={form.ssh_user} onChange={e => setForm({ ...form, ssh_user: e.target.value })} placeholder="root" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Auth Type</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {['key', 'password'].map(t => (
                    <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" value={t} checked={form.auth_type === t} onChange={() => setForm({ ...form, auth_type: t })} />
                      {t === 'key' ? '🔑 SSH Key' : '🔒 Password'}
                    </label>
                  ))}
                </div>
              </div>

              {form.auth_type === 'key' ? (
                <div className="form-group">
                  <label className="form-label">Private Key Path</label>
                  <input className="input" value={form.ssh_key_path} onChange={e => setForm({ ...form, ssh_key_path: e.target.value })} placeholder="~/.ssh/id_rsa" />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">SSH Password</label>
                  <input className="input" type="password" value={form.ssh_password} onChange={e => setForm({ ...form, ssh_password: e.target.value })} />
                </div>
              )}

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Tags (comma-separated)</label>
                  <input className="input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="production, k8s, web" />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveServer} disabled={saving}>
                {saving ? <><Loader2 size={14} className="spin-icon" /> Saving…</> : editId ? 'Update' : 'Add Server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : servers.length === 0 ? (
        <div className="empty-state">
          <Server size={48} />
          <p>No servers yet</p>
          <span>Add your first server to start monitoring</span>
        </div>
      ) : (
        <div className="servers-table-wrap card" style={{ padding: 0 }}>
          <table className="servers-table">
            <thead>
              <tr>
                <th>Server</th><th>Host</th><th>Auth</th><th>Tags</th>
                <th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map(s => (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className={`status-dot ${s.status}`} />
                      <div>
                        <strong style={{ cursor: 'pointer', color: 'var(--text-primary)' }}
                          onClick={() => navigate(`/servers/${s.id}`)}>
                          {s.name}
                        </strong>
                        {s.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
                    {s.ssh_user}@{s.host}:{s.port}
                  </td>
                  <td><span className="badge badge-info">{s.auth_type}</span></td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {s.tags?.split(',').filter(Boolean).map(t => (
                        <span key={t} className="server-tag">{t.trim()}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {testResults[s.id] !== undefined ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        {testResults[s.id].ok
                          ? <><CheckCircle2 size={14} color="var(--success)" /> <span style={{ color: 'var(--success)' }}>Connected</span></>
                          : <><XCircle size={14} color="var(--danger)" /> <span style={{ color: 'var(--danger)' }}>Failed</span></>}
                      </div>
                    ) : (
                      <span className={`badge badge-${s.status}`}>{s.status}</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary" style={{ padding: '6px 10px' }}
                        onClick={() => testConnection(s.id)} disabled={testing === s.id}>
                        {testing === s.id ? <Loader2 size={13} className="spin-icon" /> : <Wifi size={13} />}
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => editServer(s)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-danger" style={{ padding: '6px 10px' }} onClick={() => deleteServer(s.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
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
