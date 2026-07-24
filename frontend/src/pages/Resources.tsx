import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Database, Play, Trash2, X, Search, Loader2, Globe, Cpu,
  Layers, Zap, Server, Pencil, ArrowRight, CircleDot, HardDrive
} from 'lucide-react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'
import { useFolders } from '../hooks/useFolders'
import { FolderBar, type FolderSelection } from '../components/ui/FolderBar'
import { FolderTag } from '../components/ui/FolderTag'

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
  folder_id?: number | null
}

// Protocol → sensible defaults so the form fills itself in as you pick.
const PROTOCOLS: Record<string, { port: number; type: string; icon: any; label: string }> = {
  postgres: { port: 5432, type: 'database', icon: Database, label: 'PostgreSQL' },
  mysql: { port: 3306, type: 'database', icon: Database, label: 'MySQL' },
  redis: { port: 6379, type: 'cache', icon: Zap, label: 'Redis' },
  kafka: { port: 9092, type: 'queue', icon: Layers, label: 'Kafka' },
  minio: { port: 9000, type: 'storage', icon: HardDrive, label: 'MinIO' },
  http: { port: 80, type: 'service', icon: Globe, label: 'HTTP' },
  https: { port: 443, type: 'service', icon: Globe, label: 'HTTPS' },
  tcp: { port: 0, type: 'custom', icon: Cpu, label: 'TCP' },
}

function protoMeta(protocol: string) {
  return PROTOCOLS[protocol?.toLowerCase()] || PROTOCOLS.tcp
}

const emptyForm = {
  name: '', description: '', tags: '',
  resource_type: 'database', protocol: 'postgres', host: '', port: 5432,
  username: '', password: '', secret: '', auth_type: 'none', use_gateway: true, database: '',
  folder_id: null as number | null,
}

function statusMeta(status: string) {
  switch (status) {
    case 'online': return { color: 'var(--success)', label: 'Online', badge: 'badge-online' }
    case 'degraded': return { color: 'var(--warning)', label: 'Degraded', badge: 'badge-warning' }
    case 'offline': return { color: 'var(--danger)', label: 'Offline', badge: 'badge-offline' }
    default: return { color: 'var(--text-muted)', label: 'Unknown', badge: 'badge-neutral' }
  }
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
  const { folders, createFolder, deleteFolder } = useFolders()
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>('all')

  const canManage = can('manage-resources')

  useEffect(() => { loadResources() }, [])

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

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return resources.filter(r => {
      const matchesSearch =
        r.name.toLowerCase().includes(q) ||
        r.host.toLowerCase().includes(q) ||
        r.resource_type.toLowerCase().includes(q) ||
        r.protocol.toLowerCase().includes(q) ||
        (r.tags && r.tags.toLowerCase().includes(q))
      const matchesFolder =
        selectedFolder === 'all' ? true :
        selectedFolder === 'unassigned' ? !r.folder_id :
        r.folder_id === selectedFolder
      return matchesSearch && matchesFolder
    })
  }, [resources, searchQuery, selectedFolder])

  const summary = useMemo(() => ({
    total: resources.length,
    online: resources.filter(r => r.status === 'online').length,
    degraded: resources.filter(r => r.status === 'degraded').length,
    offline: resources.filter(r => r.status === 'offline').length,
  }), [resources])

  function onProtocolChange(protocol: string) {
    const meta = protoMeta(protocol)
    setForm((f: any) => ({
      ...f,
      protocol,
      resource_type: meta.type,
      // Only auto-fill the port if it's still empty or matched the old default.
      port: !f.port || f.port === protoMeta(f.protocol).port ? meta.port : f.port,
    }))
  }

  async function saveResource() {
    if (!form.name) { toast.error('Validation error', 'Name is required'); return }
    if (!form.host) { toast.error('Validation error', 'Host is required'); return }
    setSaving(true)
    try {
      if (editId) {
        await api.put(`/api/resources/${editId}`, form)
        toast.success('Resource updated', 'Connection settings saved.')
      } else {
        await api.post('/api/resources', form)
        toast.success('Resource added', 'New resource is now being monitored.')
      }
      setShowForm(false); setEditId(null); setForm(emptyForm)
      loadResources()
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.error || 'Unable to save resource')
    } finally { setSaving(false) }
  }

  function openEdit(r: ResourceData) {
    setEditId(r.id)
    setForm({
      name: r.name, description: r.description || '', tags: r.tags || '',
      resource_type: r.resource_type || 'database', protocol: r.protocol || 'postgres',
      host: r.host || '', port: r.port || 5432, username: r.username || '',
      password: '', secret: '', auth_type: r.auth_type || 'none',
      use_gateway: r.use_gateway, database: r.database || '',
      folder_id: r.folder_id ?? null,
    })
    setShowForm(true)
  }

  async function moveResourceFolder(id: number, folderId: number | null) {
    try {
      await api.patch(`/api/resources/${id}/folder`, { folder_id: folderId })
      setResources(prev => prev.map(r => r.id === id ? { ...r, folder_id: folderId } : r))
    } catch (err: any) {
      toast.error('Move failed', err.response?.data?.error || 'Could not move resource.')
    }
  }

  async function deleteResource(id: number) {
    if (!window.confirm('Delete this resource? Access grants and history will be removed.')) return
    try {
      await api.delete(`/api/resources/${id}`)
      toast.success('Resource removed', 'The resource was deleted.')
      loadResources()
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.error || 'Unable to delete resource')
    }
  }

  async function testResource(id: number) {
    setTestingId(id)
    try {
      const res = await api.post(`/api/resources/${id}/test`)
      const latency = res.data.latency_ms ? ` · ${res.data.latency_ms.toFixed(0)}ms` : ''
      if (res.data.status === 'online') toast.success('Connection healthy', `Resource is reachable${latency}`)
      else if (res.data.status === 'degraded') toast.error('Degraded', res.data.error || `Reachable but unhealthy${latency}`)
      else toast.error('Connection failed', res.data.error || 'Could not reach resource')
      loadResources()
    } catch (err: any) {
      toast.error('Test failed', err.response?.data?.error || 'Unable to test resource')
    } finally { setTestingId(null) }
  }

  if (!canManage) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Resources</h1>
            <p className="page-subtitle">You don't have permission to view resource management.</p>
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
          <p className="page-subtitle hidden-mobile">Monitor and audit secure database, cache, and service connections.</p>
        </div>
        <div className="page-header-actions" style={{ marginLeft: 'auto' }}>
          <div className="search-container">
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input type="text" placeholder="Search resources..." className="input" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} style={{ paddingLeft: 38, height: 40 }} />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                <X size={14} />
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm) }} style={{ height: 40 }}>
            <Plus size={14} />
            <span className="hidden-mobile">Add Resource</span>
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {!loading && resources.length > 0 && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
          <SummaryPill label="Total" value={summary.total} color="var(--text-primary)" />
          <SummaryPill label="Online" value={summary.online} color="var(--success)" dot />
          <SummaryPill label="Degraded" value={summary.degraded} color="var(--warning)" dot />
          <SummaryPill label="Offline" value={summary.offline} color="var(--danger)" dot />
        </div>
      )}

      {/* Folder filter bar */}
      {!loading && resources.length > 0 && (
        <FolderBar
          folders={folders}
          counts={resources.reduce((acc, r) => {
            if (r.folder_id) acc[r.folder_id] = (acc[r.folder_id] || 0) + 1
            return acc
          }, {} as Record<number, number>)}
          unassignedCount={resources.filter(r => !r.folder_id).length}
          totalCount={resources.length}
          selected={selectedFolder}
          onSelect={setSelectedFolder}
          onCreate={createFolder}
          onDelete={deleteFolder}
          canManage={canManage}
        />
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 80 }}>
          <Loader2 size={24} className="spin" color="var(--brand-primary)" />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading resources…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)', padding: 60 }}>
          <Layers size={44} style={{ marginBottom: 16, opacity: 0.25 }} />
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-secondary)' }}>No resources yet</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Add a database, cache, or service to start monitoring it.</div>
          {searchQuery
            ? <button className="btn btn-secondary" style={{ marginTop: 20, height: 34 }} onClick={() => setSearchQuery('')}>Clear search</button>
            : <button className="btn btn-primary" style={{ marginTop: 20, height: 34 }} onClick={() => { setShowForm(true); setEditId(null); setForm(emptyForm) }}><Plus size={14} /> Add Resource</button>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 16 }}>
          {filtered.map(r => {
            const meta = protoMeta(r.protocol)
            const Icon = meta.icon
            const st = statusMeta(r.status)
            return (
              <div key={r.id} className="card fade-up resource-card" onClick={() => navigate(`/resources/${r.id}`)}
                style={{ cursor: 'pointer', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '18px 18px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 40, height: 40, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={20} color="var(--brand-primary)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{meta.label} · {r.resource_type}</div>
                  </div>
                  <span className={`badge ${st.badge}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <CircleDot size={11} /> {st.label}
                  </span>
                </div>

                <div style={{ padding: '0 18px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ opacity: 0.55 }}>{r.protocol}://</span>{r.host}:{r.port}
                  </div>
                  {r.tags && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {r.tags.split(',').filter(Boolean).slice(0, 4).map(t => (
                        <span key={t} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '2px 7px' }}>{t.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 8px 18px', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.use_gateway ? 'var(--brand-primary)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <Server size={12} /> {r.use_gateway ? 'Gateway' : 'Direct'}
                    </span>
                    <FolderTag
                      folders={folders}
                      value={r.folder_id ?? null}
                      onChange={fid => moveResourceFolder(r.id, fid)}
                      disabled={!canManage}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn-icon-sm" title="Test connection" onClick={() => testResource(r.id)} disabled={testingId === r.id}>
                      {testingId === r.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                    </button>
                    <button className="btn-icon-sm" title="Edit" onClick={() => openEdit(r)}><Pencil size={14} /></button>
                    <button className="btn-icon-sm danger" title="Delete" onClick={() => deleteResource(r.id)}><Trash2 size={14} /></button>
                    <button className="btn-icon-sm primary" title="Open" onClick={() => navigate(`/resources/${r.id}`)}><ArrowRight size={14} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <ResourceForm
          form={form} setForm={setForm} editId={editId} saving={saving} folders={folders}
          onProtocolChange={onProtocolChange} onSave={saveResource} onClose={() => setShowForm(false)}
        />
      )}

      <style>{`
        .resource-card { transition: border-color .15s, transform .15s; }
        .resource-card:hover { border-color: var(--border-bright); transform: translateY(-2px); }
      `}</style>
    </div>
  )
}

function SummaryPill({ label, value, color, dot }: { label: string; value: number; color: string; dot?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />}
      <span style={{ fontSize: 20, fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
    </div>
  )
}

function ResourceForm({ form, setForm, editId, saving, folders, onProtocolChange, onSave, onClose }: any) {
  const isDb = form.protocol === 'postgres' || form.protocol === 'mysql'
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-modal-backdrop)', background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div className="card fade-up modal-content" style={{ width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: 'clamp(20px, 5vw, 32px)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, background: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Database size={22} color="var(--text-inverse)" />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>{editId ? 'Edit resource' : 'Add resource'}</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{editId ? 'Update the connection settings.' : 'Connect a database, cache, or service to monitor.'}</p>
            </div>
          </div>
          <button className="btn-icon-sm" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
          <Field label="Name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="production-db" />
          </Field>
          <Field label="Type">
            <select className="input" value={form.protocol} onChange={(e) => onProtocolChange(e.target.value)}>
              {Object.entries(PROTOCOLS).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
          <Field label="Host">
            <input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="db.internal.local" />
          </Field>
          <Field label="Port">
            <input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
          </Field>
        </div>

        <div className="grid-2-col" style={{ gap: 16, marginBottom: 16 }}>
          <Field label={form.protocol === 'minio' ? 'Access key' : 'Username'}>
            <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={form.protocol === 'minio' ? 'minioadmin' : 'app_user'} />
          </Field>
          <Field label="Auth">
            <select className="input" value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })}>
              <option value="none">None</option>
              <option value="password">Password</option>
              <option value="token">Token / API key</option>
            </select>
          </Field>
        </div>

        {isDb && (
          <Field label="Database" style={{ marginBottom: 16 }}>
            <input className="input" value={form.database || ''} onChange={(e) => setForm({ ...form, database: e.target.value })} placeholder={form.protocol === 'postgres' ? 'postgres' : 'app'} />
          </Field>
        )}
        {(form.auth_type === 'password' || form.protocol === 'postgres' || form.protocol === 'mysql' || form.protocol === 'redis' || form.protocol === 'minio') && form.auth_type !== 'token' && (
          <Field label={form.protocol === 'minio' ? 'Secret key' : 'Password'} style={{ marginBottom: 16 }}>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editId ? 'Leave blank to keep current' : ''} />
          </Field>
        )}
        {form.auth_type === 'token' && (
          <Field label="Token / secret" style={{ marginBottom: 16 }}>
            <input className="input" type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder={editId ? 'Leave blank to keep current' : ''} />
          </Field>
        )}

        <Field label="Connection method" style={{ marginBottom: 16 }}>
          <select className="input" value={form.use_gateway ? 'true' : 'false'} onChange={(e) => setForm({ ...form, use_gateway: e.target.value === 'true' })}>
            <option value="true">Via gateway (secure)</option>
            <option value="false">Direct</option>
          </select>
        </Field>

        <Field label="Description" style={{ marginBottom: 16 }}>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is this resource for?" style={{ height: 60, resize: 'none' }} />
        </Field>

        <div className="grid-2-col" style={{ gap: 16, marginBottom: 24 }}>
          <Field label="Tags">
            <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="prod, critical" />
          </Field>
          <Field label="Folder">
            <select className="input" value={form.folder_id ?? ''} onChange={(e) => setForm({ ...form, folder_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No folder</option>
              {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={onSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : editId ? 'Save changes' : 'Add resource'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, style }: { label: string; children: any; style?: any }) {
  return (
    <div className="input-group" style={{ marginBottom: 0, ...style }}>
      <label className="input-label">{label}</label>
      {children}
    </div>
  )
}
