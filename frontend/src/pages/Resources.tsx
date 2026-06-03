import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Plus, Database, Play, Trash2, Server, ShieldCheck, CheckCircle2, 
  X, Search, Loader2, Globe, Cpu, Layers, Activity, Pencil,
  ExternalLink
} from 'lucide-react'
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
  database?: string
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
  database: '',
}

const typeIcons: Record<string, any> = {
  database: Database,
  service: Globe,
  cache: Activity,
  custom: Cpu,
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
  const [searchQuery, setSearchQuery] = useState('')

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

  const filteredResources = useMemo(() => {
    return resources.filter(r => 
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.resource_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.protocol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.tags && r.tags.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  }, [resources, searchQuery])

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
      database: resource.database || '',
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
      <div className="page-header">
        <div>
          <h1 className="page-title">Resources</h1>
          <p className="page-subtitle hidden-mobile">Manage and audit secure database and service connections.</p>
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
              placeholder="Search resources..."
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
          <button
            className="btn btn-primary"
            onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm) }}
            style={{ height: 40 }}
          >
            <Plus size={14} />
            <span className="hidden-mobile">Add Resource</span>
          </button>
        </div>
      </div>

      <div className="table-container fade-up">
        <table className="k-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Type</th>
              <th>Endpoint</th>
              <th>Gateway</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 48, textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <Loader2 size={24} className="spin" color="var(--brand-primary)" />
                    <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Synchronizing Resources...</span>
                  </div>
                </td>
              </tr>
            ) : filteredResources.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 60, textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)' }}>
                    <Layers size={48} style={{ marginBottom: 16, opacity: 0.2 }} />
                    <div style={{ fontWeight: 800, fontSize: 14, textTransform: 'uppercase' }}>No Resources Detected</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>Add a new database or service to begin management.</div>
                    {searchQuery && (
                      <button className="btn btn-secondary" style={{ marginTop: 20, height: 32 }} onClick={() => setSearchQuery('')}>Clear Filter</button>
                    )}
                  </div>
                </td>
              </tr>
            ) : filteredResources.map((resource) => {
              const Icon = typeIcons[resource.resource_type] || Cpu
              return (
                <tr key={resource.id} onClick={() => goToResource(resource.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 32, height: 32,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <Icon size={16} color="var(--brand-primary)" />
                      </div>
                      <div>
                        <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: 13, textTransform: 'uppercase' }}>{resource.name}</div>
                        {resource.tags && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontWeight: 800 }}>{resource.tags.toUpperCase()}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      {resource.resource_type.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span style={{ opacity: 0.6 }}>{resource.protocol}://</span>{resource.host}:{resource.port}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${resource.use_gateway ? 'badge-online' : ''}`} style={{ border: '1px solid var(--border)', background: resource.use_gateway ? 'var(--brand-glow)' : 'var(--bg-elevated)', color: resource.use_gateway ? 'var(--brand-primary)' : 'var(--text-muted)' }}>
                      {resource.use_gateway ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${resource.status === 'online' ? 'online' : 'warning'}`}>
                      {resource.status.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn-icon-sm" title="Test connectivity" onClick={(e) => { e.stopPropagation(); testResource(resource.id) }} disabled={testingId === resource.id}>
                        {testingId === resource.id ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                      </button>
                      <button className="btn-icon-sm" title="Modify configuration" onClick={(e) => { e.stopPropagation(); openEdit(resource) }}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn-icon-sm danger" title="Decommission resource" onClick={(e) => { e.stopPropagation(); deleteResource(resource.id) }}>
                        <Trash2 size={13} />
                      </button>
                      <button className="btn-icon-sm" title="View details" onClick={(e) => { e.stopPropagation(); goToResource(resource.id) }}>
                        <ExternalLink size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
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
            style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', padding: 'clamp(20px, 5vw, 32px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 44, height: 44, background: 'var(--brand-primary)', borderTop: '4px solid var(--brand-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Database size={24} color="var(--text-inverse)" />
                </div>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
                    {editId ? 'UPDATE_RESOURCE' : 'PROVISION_RESOURCE'}
                  </h2>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {editId ? 'Modify target endpoint parameters' : 'Establish secure connection to new infrastructure'}
                  </p>
                </div>
              </div>
              <button className="btn-icon-sm" onClick={() => setShowForm(false)}><X size={14} /></button>
            </div>

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
              <div className="input-group">
                <label className="input-label">Identity Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="production-db-01" />
              </div>
              <div className="input-group">
                <label className="input-label">Resource Type</label>
                <select className="input" value={form.resource_type} onChange={(e) => setForm({ ...form, resource_type: e.target.value })}>
                  <option value="database">DATABASE</option>
                  <option value="service">SERVICE</option>
                  <option value="cache">CACHE</option>
                  <option value="custom">CUSTOM</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Protocol</label>
                <select className="input" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
                  <option value="postgres">POSTGRES</option>
                  <option value="mysql">MYSQL</option>
                  <option value="redis">REDIS</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div className="input-group">
                <label className="input-label">Gateway Tunneling</label>
                <select className="input" value={form.use_gateway ? 'true' : 'false'} onChange={(e) => setForm({ ...form, use_gateway: e.target.value === 'true' })}>
                  <option value="true">ENABLED (SECURE)</option>
                  <option value="false">DISABLED (DIRECT)</option>
                </select>
              </div>
            </div>

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
              <div className="input-group">
                <label className="input-label">Target Host</label>
                <input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="internal.db.local" />
              </div>
              <div className="input-group">
                <label className="input-label">Target Port</label>
                <input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} placeholder="5432" />
              </div>
            </div>

            <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
              <div className="input-group">
                <label className="input-label">Service Username</label>
                <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="infra_operator" />
              </div>
              <div className="input-group">
                <label className="input-label">Authentication Strategy</label>
                <select className="input" value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })}>
                  <option value="none">NONE / ANONYMOUS</option>
                  <option value="password">PASSWORD-BASED</option>
                  <option value="token">TOKEN-BASED / API KEY</option>
                </select>
              </div>
            </div>

            {(form.protocol === 'postgres' || form.protocol === 'mysql') && (
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label className="input-label">Target Database Schema</label>
                <input className="input" value={form.database || ''} onChange={(e) => setForm({ ...form, database: e.target.value })} placeholder="main_prod" />
              </div>
            )}

            {form.auth_type === 'password' && (
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label className="input-label">Access Password</label>
                <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            )}
            {form.auth_type === 'token' && (
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label className="input-label">Security Token / Secret Key</label>
                <input className="input" type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
              </div>
            )}

            <div className="input-group" style={{ marginBottom: 16 }}>
              <label className="input-label">Description / Purpose</label>
              <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Operational notes..." style={{ height: 60, resize: 'none' }} />
            </div>

            <div className="input-group" style={{ marginBottom: 24 }}>
              <label className="input-label">Organizational Tags</label>
              <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="PROD, DB, CRITICAL" />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={saveResource} disabled={saving}>
                {saving ? <><Loader2 size={14} className="spin" /> SAVING...</> : editId ? 'UPDATE RESOURCE' : 'PROVISION RESOURCE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
