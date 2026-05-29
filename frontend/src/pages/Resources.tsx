import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Database, Play, Trash2, Server, ShieldCheck, CheckCircle2, X } from 'lucide-react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'

interface ResourceData {
  id: number
  created_at?: string
  updated_at?: string
  name: string
  description?: string
  tags?: string
  resource_type: string
  protocol: string
  host: string
  port: number
  username?: string
  auth_type: string
  use_gateway: boolean
  status: string
}

const emptyForm = {
  name: '',
  description: '',
  tags: '',
  resource_type: 'database',
  protocol: 'postgres',
  host: '',
  port: 5432,
  username: '',
  password: '',
  secret: '',
  auth_type: 'none',
  use_gateway: true,
}

export function Resources() {
  const { can } = usePermission()
  const navigate = useNavigate()
  const toast = useToastStore()
  const [resources, setResources] = useState<ResourceData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<any>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)

  const canManage = can('manage-resources')

  useEffect(() => {
    loadResources()
  }, [])

  async function loadResources() {
    setLoading(true)
    try {
      const res = await api.get('/api/resources')
      setResources(res.data)
    } catch (err: any) {
      toast.error('Load failed', err.response?.data?.error || 'Unable to load resources')
    } finally {
      setLoading(false)
    }
  }

  async function saveResource() {
    if (!form.name) {
      toast.error('Validation error', 'Name is required')
      return
    }
    setSaving(true)
    try {
      if (editId) {
        await api.put(`/api/resources/${editId}`, form)
        toast.success('Resource updated', 'Resource settings have been saved.')
      } else {
        await api.post('/api/resources', form)
        toast.success('Resource created', 'New resource has been added.')
      }
      setShowForm(false)
      setEditId(null)
      setForm(emptyForm)
      loadResources()
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.error || 'Unable to save resource')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(resource: ResourceData) {
    setEditId(resource.id)
    setForm({
      name: resource.name,
      description: resource.description || '',
      tags: resource.tags || '',
      resource_type: resource.resource_type || 'database',
      protocol: resource.protocol || 'postgres',
      host: resource.host || '',
      port: resource.port || 5432,
      username: resource.username || '',
      password: '',
      secret: '',
      auth_type: resource.auth_type || 'none',
      use_gateway: resource.use_gateway,
    })
    setShowForm(true)
  }

  async function deleteResource(id: number) {
    if (!window.confirm('Delete this resource?')) return
    try {
      await api.delete(`/api/resources/${id}`)
      toast.success('Resource removed', 'The resource entry was deleted.')
      loadResources()
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.error || 'Unable to delete resource')
    }
  }

  async function testResource(id: number) {
    setTestingId(id)
    try {
      const res = await api.post(`/api/resources/${id}/test`)
      if (res.data.status === 'online') {
        toast.success('Connection successful', res.data.message || 'Resource is reachable')
      } else {
        toast.error('Connection failed', res.data.error || 'Could not reach resource')
      }
      loadResources()
    } catch (err: any) {
      toast.error('Test failed', err.response?.data?.error || 'Unable to test resource')
    } finally {
      setTestingId(null)
    }
  }

  function goToResource(id: number) {
    navigate(`/resources/${id}`)
  }

  if (!canManage) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Resources</h1>
            <p className="page-subtitle">You do not have permission to view resource management.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title">Resources</h1>
          <p className="page-subtitle hidden-mobile">Manage database and infrastructure resources through a secure gateway.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm) }}
          style={{ height: 40 }}
        >
          <Plus size={14} />
          <span className="hidden-mobile">Add Resource</span>
        </button>
      </div>

      <div className="card" style={{ padding: 20, overflowX: 'auto' }}>
        <table className="k-table" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Protocol</th>
              <th>Host</th>
              <th>Port</th>
              <th>Status</th>
              <th>Gateway</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center' }}>Loading resources...</td></tr>
            ) : resources.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center' }}>No resources configured yet.</td></tr>
            ) : resources.map((resource) => (
              <tr key={resource.id} style={{ cursor: 'pointer' }} onClick={() => goToResource(resource.id)}>
                <td>{resource.name}</td>
                <td>{resource.resource_type}</td>
                <td>{resource.protocol}</td>
                <td>{resource.host}</td>
                <td>{resource.port || '—'}</td>
                <td style={{ textTransform: 'capitalize' }}>{resource.status}</td>
                <td>{resource.use_gateway ? 'Enabled' : 'Disabled'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn-icon" title="Test connection" onClick={(e) => { e.stopPropagation(); testResource(resource.id) }} disabled={testingId === resource.id}>
                      <Play size={14} />
                    </button>
                    <button className="btn-icon" title="Edit resource" onClick={(e) => { e.stopPropagation(); openEdit(resource) }}>
                      <Server size={14} />
                    </button>
                    <button className="btn-icon" title="Delete resource" onClick={(e) => { e.stopPropagation(); deleteResource(resource.id) }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowForm(false)}
        >
          <div
            className="card fade-up modal-content"
            style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', padding: '28px 28px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}> {editId ? 'Edit Resource' : 'Add Resource'}</h2>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Define a secured database or service target for InfraEye.</p>
              </div>
              <button className="btn-icon" onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
              <div className="input-group">
                <label className="input-label">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Postgres DB" />
              </div>
              <div className="input-group">
                <label className="input-label">Type</label>
                <select className="input" value={form.resource_type} onChange={(e) => setForm({ ...form, resource_type: e.target.value })}>
                  <option value="database">Database</option>
                  <option value="service">Service</option>
                  <option value="cache">Cache</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Protocol</label>
                <select className="input" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
                  <option value="postgres">Postgres</option>
                  <option value="mysql">MySQL</option>
                  <option value="redis">Redis</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Gateway Tunnel</label>
                <select className="input" value={form.use_gateway ? 'true' : 'false'} onChange={(e) => setForm({ ...form, use_gateway: e.target.value === 'true' })}>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            </div>

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
              <div className="input-group">
                <label className="input-label">Host</label>
                <input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="db.internal.local" />
              </div>
              <div className="input-group">
                <label className="input-label">Port</label>
                <input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} placeholder="5432" />
              </div>
            </div>

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
              <div className="input-group">
                <label className="input-label">Username</label>
                <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="infraeye" />
              </div>
              <div className="input-group">
                <label className="input-label">Authentication</label>
                <select className="input" value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })}>
                  <option value="none">None</option>
                  <option value="password">Password</option>
                  <option value="token">Token</option>
                </select>
              </div>
            </div>

            {form.auth_type === 'password' && (
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label className="input-label">Password</label>
                <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            )}
            {form.auth_type === 'token' && (
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label className="input-label">Secret / API Key</label>
                <input className="input" type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
              </div>
            )}

            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional notes about the resource" />
            </div>

            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label">Tags</label>
              <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="prod, db, postgres" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
              <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)} style={{ height: 42 }}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={saveResource} disabled={saving} style={{ height: 42 }}>
                {saving ? 'Saving...' : editId ? 'Update Resource' : 'Create Resource'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
