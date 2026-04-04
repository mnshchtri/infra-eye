import { useState, useEffect } from 'react'
import { 
  Plus, Server, Trash2, Pencil, Wifi, CheckCircle2, XCircle, 
  Loader2, X, WifiOff, HelpCircle, Search, Terminal, Settings, Activity 
} from 'lucide-react'
import { WindowsIcon, LinuxIcon, AppleIcon, KubernetesIcon } from '../components/OSIcons'
import { api } from '../api/client'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'

interface ServerData {
  id: number; name: string; host: string; port: number;
  ssh_user: string; auth_type: string; tags: string;
  description: string; status: string; ssh_key_path: string;
  os: string;
  kube_config?: string;
}

const emptyForm = {
  name: '', host: '', port: 22, ssh_user: 'root',
  auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa',
  ssh_password: '', tags: '', description: '',
}

const statusColors: Record<string, string> = {
  online: 'var(--success)',
  offline: 'var(--danger)',
  unknown: 'var(--warning)',
}

export function Servers() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { can } = usePermission()
  const toast = useToastStore()
  const [servers, setServers] = useState<ServerData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [disconnecting, setDisconnecting] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string }>>({})
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadServers()
    if (searchParams.get('add')) setShowForm(true)
  }, [])

  async function loadServers() {
    setLoading(true)
    try {
      const res = await api.get('/api/servers')
      // Show all servers, including direct-API K8s clusters.
      setServers(res.data)
    } finally {
      setLoading(false)
    }
  }

  async function saveServer() {
    setSaving(true)
    try {
      if (editId) await api.put(`/api/servers/${editId}`, form)
      else await api.post('/api/servers', form)
      setShowForm(false)
      setEditId(null)
      setForm(emptyForm)
      toast.success(editId ? 'Server updated' : 'Server added', 'SSH credentials saved successfully.')
      loadServers()
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.error || 'Could not save server.')
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
    try {
      await api.delete(`/api/servers/${id}`)
      toast.success('Server deleted', 'Server and all data permanently removed.')
      setConfirmDelete(null)
      loadServers()
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.error)
      setConfirmDelete(null)
    }
  }

  async function testConnection(id: number) {
    setTesting(id)
    try {
      const res = await api.post(`/api/servers/${id}/test`)
      setTestResults(prev => ({ ...prev, [id]: { ok: res.data.status === 'online', msg: res.data.output || '' } }))
      if (res.data.status === 'online') {
        setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'online', os: res.data.os } : s))
        toast.success('Connected', `Server is online (${res.data.os || 'linux'})`)
      } else {
        toast.error('Connection failed', 'Could not reach the server.')
      }
    } catch {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, msg: 'Connection failed' } }))
      toast.error('Connection failed', 'Could not reach the server.')
    } finally {
      setTesting(null)
    }
  }

  async function disconnectServer(id: number) {
    setDisconnecting(id)
    try {
      await api.post(`/api/servers/${id}/disconnect`)
      setTestResults(prev => ({ ...prev, [id]: { ok: false, msg: 'Disconnected' } }))
      setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'offline' } : s))
      toast.info('Disconnected', 'SSH session closed and metrics collection stopped.')
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Disconnect failed'
      toast.error('Disconnect failed', errorMsg)
    } finally {
      setDisconnecting(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">Servers</h1>
          <p className="page-subtitle hidden-mobile">Manage and monitor connected infrastructure</p>
        </div>
        <div className="page-header-actions" style={{ marginLeft: 'auto' }}>
          <div className="search-container">
            <Search 
              size={14} 
              color="var(--text-muted)" 
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} 
            />
            <input
              type="text"
              placeholder="Search..."
              className="input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 38, height: 40 }}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                style={{ 
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {can('manage-servers') && (
            <button
              className="btn btn-primary"
              onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm) }}
              style={{ height: 40 }}
            >
              <Plus size={14} /> 
              <span className="hidden-mobile">Add Server</span><span className="show-mobile-only">Add</span>
            </button>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setShowForm(false)}
        >
          <div
            className="card fade-up modal-content"
            style={{
              padding: 'clamp(20px, 5vw, 32px)', width: '100%', maxWidth: 640,
              maxHeight: '90vh', overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 44, height: 44, background: 'var(--brand-primary)', borderTop: '4px solid var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Plus size={24} color="var(--text-inverse)" />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
                    {editId ? 'UPDATE_SERVER_CREDENTIALS' : 'PROVISION_CONTROL_NODE'}
                  </h2>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {editId ? 'Modify infrastructure access parameters' : 'Establish secure handshake with new infrastructure'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="btn-icon-sm"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
              {[
                { label: 'Name', key: 'name', placeholder: 'prod-web-01' },
                { label: 'Host', key: 'host', placeholder: '192.168.1.100' },
                { label: 'Port', key: 'port', placeholder: '22', type: 'number' },
                { label: 'User', key: 'ssh_user', placeholder: 'root' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key} className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">{label}</label>
                  <input
                    className="input"
                    type={type || 'text'}
                    value={(form as any)[key]}
                    onChange={e => setForm({ ...form, [key]: type === 'number' ? +e.target.value : e.target.value })}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>

            {/* Auth type */}
            <div className="input-group">
              <label className="input-label">Authentication Method</label>
              <div style={{ display: 'flex', gap: 0 }}>
                {['key', 'password'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, auth_type: t })}
                    style={{
                      flex: 1, padding: '12px', fontSize: 10, fontWeight: 900,
                      border: '1px solid var(--border)', transition: 'all 0.2s', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                      ...(form.auth_type === t
                        ? { background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)', color: 'var(--text-inverse)' }
                        : { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }
                      ),
                    }}
                  >
                    {t === 'key' ? 'SSH Key File' : 'Interactive Password'}
                  </button>
                ))}
              </div>
            </div>

            {form.auth_type === 'key' ? (
              <div className="input-group">
                <label className="input-label">Private Key Path</label>
                <input className="input" value={form.ssh_key_path} onChange={e => setForm({ ...form, ssh_key_path: e.target.value })} placeholder="~/.ssh/id_rsa" />
              </div>
            ) : (
              <div className="input-group">
                <label className="input-label">SSH Password</label>
                <input className="input" type="password" value={form.ssh_password} onChange={e => setForm({ ...form, ssh_password: e.target.value })} />
              </div>
            )}

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 24 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Tags</label>
                <input className="input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="production, mail" />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Description</label>
                <input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional note" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={saveServer} disabled={saving}>
                {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : editId ? 'Update Server' : 'Add Server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '100px 0' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : servers.length === 0 ? (
        <div className="empty-state">
          <div style={{ width: 72, height: 72, borderRadius: 22, background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Server size={32} color="var(--brand-primary)" />
          </div>
          <p>No servers connected yet</p>
          <span>Add your first server to start monitoring your infrastructure</span>
          {can('manage-servers') && (
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setShowForm(true)}>
              <Plus size={14} /> Add Your First Server
            </button>
          )}
        </div>
      ) : (
        <div className="table-container fade-up">
          <table className="k-table">
            <thead>
              <tr>
                {['Server', 'OS', 'Connection', 'Auth', 'Tags', 'Status', 'Actions'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filtered = servers.filter(s => 
                  s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  s.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (s.tags && s.tags.toLowerCase().includes(searchQuery.toLowerCase())) ||
                  (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
                );

                if (filtered.length === 0) {
                  return (
                    <tr>
                      <td colSpan={7} style={{ padding: '60px 0', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)' }}>
                          <Search size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                          <div style={{ fontWeight: 600, fontSize: 14 }}>No matching servers found</div>
                          <div style={{ fontSize: 12, marginTop: 4 }}>Try adjusting your search or clear it to see all servers.</div>
                          <button 
                            className="btn btn-secondary" 
                            style={{ marginTop: 16, height: 32, padding: '0 12px', fontSize: 11 }}
                            onClick={() => setSearchQuery('')}
                          >
                            Clear Search
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return filtered.map((s, i) => (
                  <tr
                    key={s.id}
                    className="fade-up"
                    style={{
                      borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                      transition: 'background 0.15s',
                      animationDelay: `${i * 50}ms`,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 0,
                          background: 'var(--bg-elevated)',
                          border: `1px solid var(--border)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          {s.kube_config
                            ? <KubernetesIcon size={18} />
                            : s.os === 'darwin' ? <AppleIcon size={14} color="var(--brand-primary)" />
                            : s.os === 'windows' ? <WindowsIcon size={14} color="var(--brand-primary)" />
                            : s.os === 'linux' ? <LinuxIcon size={14} color="var(--brand-primary)" />
                            : <Server size={14} color="var(--brand-primary)" />}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{ fontWeight: 900, color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'uppercase' }}
                            onClick={() => navigate(`/servers/${s.id}`)}
                          >
                            {s.name}
                          </div>
                          {s.description && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontWeight: 800 }}>{s.description.toUpperCase()}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                         <span style={{ fontSize: 11, fontWeight: 800 }}>{s.os?.toUpperCase() || 'HOST'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {s.host
                        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{s.ssh_user}@{s.host}</span>
                        : <span className="badge badge-online" style={{ fontSize: 9 }}>DIRECT API</span>
                      }
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        {s.auth_type.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {s.tags?.split(',').filter(Boolean).map(t => (
                          <span key={t} className="server-tag" style={{ fontSize: 9 }}>{t.trim().toUpperCase()}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {testResults[s.id] !== undefined ? (
                        <span className={`badge ${testResults[s.id].ok ? 'badge-online' : 'badge-offline'}`}>
                          {testResults[s.id].ok ? 'CONNECTED' : 'FAILED'}
                        </span>
                      ) : (
                        <span className={`badge badge-${s.status}`} style={{ fontSize: 9 }}>{s.status.toUpperCase()}</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {can('manage-servers') && (
                          s.status === 'online' ? (
                            <button
                              title="Disconnect"
                              style={{
                                padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                                color: 'var(--danger)', cursor: 'pointer', transition: 'all 0.15s',
                                display: 'flex', alignItems: 'center',
                              }}
                              onClick={() => disconnectServer(s.id)} disabled={disconnecting === s.id}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
                            >
                              {disconnecting === s.id
                                ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                : <WifiOff size={13} />}
                            </button>
                          ) : (
                            <button
                              title="Connect"
                              style={{
                                padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                                background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
                                color: 'var(--success)', cursor: 'pointer', transition: 'all 0.15s',
                                display: 'flex', alignItems: 'center',
                              }}
                              onClick={() => testConnection(s.id)} disabled={testing === s.id}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,197,94,0.15)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'rgba(34,197,94,0.08)'}
                            >
                              {testing === s.id
                                ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Wifi size={13} />}
                            </button>
                          )
                        )}
                        {can('manage-servers') && (
                          <button
                            title="Edit"
                            style={{
                              padding: '7px 10px', borderRadius: 8, fontSize: 12,
                              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                              color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s',
                              display: 'flex', alignItems: 'center',
                            }}
                            onClick={() => editServer(s)}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-app)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {can('delete-server') && (
                          confirmDelete === s.id ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                style={{
                                  padding: '7px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                                  background: 'var(--danger)', border: 'none',
                                  color: '#fff', cursor: 'pointer',
                                }}
                                onClick={() => deleteServer(s.id)}
                              >
                                Confirm
                              </button>
                              <button
                                style={{
                                  padding: '7px 10px', borderRadius: 8, fontSize: 11,
                                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                  color: 'var(--text-muted)', cursor: 'pointer',
                                }}
                                onClick={() => setConfirmDelete(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              title="Delete"
                              style={{
                                padding: '7px 10px', borderRadius: 8, fontSize: 12,
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                                color: 'var(--danger)', cursor: 'pointer', transition: 'all 0.15s',
                                display: 'flex', alignItems: 'center',
                              }}
                              onClick={() => setConfirmDelete(s.id)}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger)'; e.currentTarget.style.color = '#fff' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = 'var(--danger)' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
