import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Database, Play, Trash2, Globe, Cpu, Layers, Zap, Server, Pencil, ArrowRight, HardDrive,
} from 'lucide-react'
import {
  Box, Card, Chip, CircularProgress, IconButton, MenuItem, TextField, Tooltip, Typography,
} from '@mui/material'
import { Modal, Button, PageHeader, SearchInput, EmptyState } from '../components/ui'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { usePermission } from '../hooks/usePermission'
import { useFolders } from '../hooks/useFolders'
import { FolderBar, type FolderSelection } from '../components/ui/FolderBar'
import { FolderTag } from '../components/ui/FolderTag'
import { apiError } from '../utils/errors'
import type { FolderItem } from '../hooks/useFolders'
import type { IconComponent } from '../types/k8s'
import type { Dispatch, SetStateAction } from 'react'

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
const PROTOCOLS: Record<string, { port: number; type: string; icon: IconComponent; label: string }> = {
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

type ResourceFormState = typeof emptyForm

function statusMeta(status: string): { color: 'success' | 'warning' | 'error' | 'default'; label: string; dot: string } {
  switch (status) {
    case 'online': return { color: 'success', label: 'Online', dot: 'success.main' }
    case 'degraded': return { color: 'warning', label: 'Degraded', dot: 'warning.main' }
    case 'offline': return { color: 'error', label: 'Offline', dot: 'error.main' }
    default: return { color: 'default', label: 'Unknown', dot: 'text.disabled' }
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
  const [form, setForm] = useState<ResourceFormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ResourceData | null>(null)
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
    } catch (err: unknown) {
      toast.error('Load failed', apiError(err) || 'Unable to load resources')
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
    setForm(f => ({
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
    } catch (err: unknown) {
      toast.error('Save failed', apiError(err) || 'Unable to save resource')
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
    } catch (err: unknown) {
      toast.error('Move failed', apiError(err) || 'Could not move resource.')
    }
  }

  async function deleteResource(id: number) {
    try {
      await api.delete(`/api/resources/${id}`)
      toast.success('Resource removed', 'The resource was deleted.')
      setDeleteTarget(null)
      loadResources()
    } catch (err: unknown) {
      toast.error('Delete failed', apiError(err) || 'Unable to delete resource')
      setDeleteTarget(null)
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
    } catch (err: unknown) {
      toast.error('Test failed', apiError(err) || 'Unable to test resource')
    } finally { setTestingId(null) }
  }

  const openAdd = () => { setShowForm(true); setEditId(null); setForm(emptyForm) }

  if (!canManage) {
    return (
      <div className="page">
        <PageHeader title="Resources" subtitle="You don't have permission to view resource management." />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="Resources"
        subtitle="Monitor and audit secure database, cache, and service connections."
        actions={
          <>
            <Box sx={{ width: 260 }}><SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search resources..." /></Box>
            <Button icon={<Plus size={14} />} onClick={openAdd}>Add Resource</Button>
          </>
        }
      />

      {!loading && resources.length > 0 && (
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2 }}>
          <SummaryPill label="Total" value={summary.total} />
          <SummaryPill label="Online" value={summary.online} dot="success.main" />
          <SummaryPill label="Degraded" value={summary.degraded} dot="warning.main" />
          <SummaryPill label="Offline" value={summary.offline} dot="error.main" />
        </Box>
      )}

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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 10 }}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">Loading resources…</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="No resources yet"
            description="Add a database, cache, or service to start monitoring it."
            action={searchQuery
              ? <Button variant="secondary" onClick={() => setSearchQuery('')}>Clear search</Button>
              : <Button icon={<Plus size={14} />} onClick={openAdd}>Add Resource</Button>}
          />
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 2 }}>
          {filtered.map(r => {
            const meta = protoMeta(r.protocol)
            const Icon = meta.icon
            const st = statusMeta(r.status)
            return (
              <Card key={r.id} onClick={() => navigate(`/resources/${r.id}`)}
                sx={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', '&:hover': { borderColor: 'primary.main' } }}>
                <Box sx={{ p: 2, pb: 1.5, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                  <Box sx={{ width: 40, height: 40, borderRadius: 1, border: 1, borderColor: 'divider', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'primary.main' }}>
                    <Icon size={20} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap>{r.name}</Typography>
                    <Typography variant="body2" color="text.secondary">{meta.label} · {r.resource_type}</Typography>
                  </Box>
                  <Chip label={st.label} color={st.color} size="small" variant={st.color === 'default' ? 'outlined' : 'filled'} />
                </Box>

                <Box sx={{ px: 2, pb: 1.5 }}>
                  <Typography variant="body1" noWrap sx={{ fontFamily: 'var(--font-mono)', color: 'text.secondary' }}>
                    <span style={{ opacity: 0.55 }}>{r.protocol}://</span>{r.host}:{r.port}
                  </Typography>
                  {r.tags && (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.25 }}>
                      {r.tags.split(',').filter(Boolean).slice(0, 4).map(t => <Chip key={t} label={t.trim()} size="small" variant="outlined" />)}
                    </Box>
                  )}
                </Box>

                <Box sx={{ mt: 'auto', borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', pl: 2, pr: 1, py: 1, gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0, color: r.use_gateway ? 'primary.main' : 'text.secondary' }}>
                      <Server size={12} /> {r.use_gateway ? 'Gateway' : 'Direct'}
                    </Typography>
                    <FolderTag folders={folders} value={r.folder_id ?? null} onChange={fid => moveResourceFolder(r.id, fid)} disabled={!canManage} />
                  </Box>
                  <Box sx={{ display: 'flex', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Test connection">
                      <span>
                        <IconButton onClick={() => testResource(r.id)} disabled={testingId === r.id} aria-label="Test connection">
                          {testingId === r.id ? <CircularProgress size={14} /> : <Play size={14} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Edit"><IconButton onClick={() => openEdit(r)} aria-label="Edit"><Pencil size={14} /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton color="error" onClick={() => setDeleteTarget(r)} aria-label="Delete"><Trash2 size={14} /></IconButton></Tooltip>
                    <Tooltip title="Open"><IconButton color="primary" onClick={() => navigate(`/resources/${r.id}`)} aria-label="Open"><ArrowRight size={14} /></IconButton></Tooltip>
                  </Box>
                </Box>
              </Card>
            )
          })}
        </Box>
      )}

      <ResourceForm
        open={showForm}
        form={form} setForm={setForm} editId={editId} saving={saving} folders={folders}
        onProtocolChange={onProtocolChange} onSave={saveResource} onClose={() => setShowForm(false)}
      />

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete resource"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteTarget && deleteResource(deleteTarget.id)}>Delete</Button>
          </>
        }
      >
        <Typography variant="body1" color="text.secondary">
          Delete <b>{deleteTarget?.name}</b>? Access grants and history will be removed.
        </Typography>
      </Modal>
    </div>
  )
}

function SummaryPill({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {dot && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }} />}
      <Typography variant="h5" component="span" sx={{ fontFamily: 'var(--font-mono)' }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
    </Box>
  )
}

function ResourceForm({ open, form, setForm, editId, saving, folders, onProtocolChange, onSave, onClose }: {
  open: boolean
  form: ResourceFormState; setForm: Dispatch<SetStateAction<ResourceFormState>>;
  editId: number | null; saving: boolean; folders: FolderItem[];
  onProtocolChange: (p: string) => void; onSave: () => void; onClose: () => void;
}) {
  const isDb = form.protocol === 'postgres' || form.protocol === 'mysql'
  const set = <K extends keyof ResourceFormState>(k: K, v: ResourceFormState[K]) => setForm({ ...form, [k]: v })
  const two = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 } as const
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="lg"
      icon={Database}
      title={editId ? 'Edit resource' : 'Add resource'}
      subtitle={editId ? 'Update the connection settings.' : 'Connect a database, cache, or service to monitor.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={saving}>{editId ? 'Save changes' : 'Add resource'}</Button>
        </>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={two}>
          <TextField label="Name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="production-db" />
          <TextField select label="Type" value={form.protocol} onChange={e => onProtocolChange(e.target.value)}>
            {Object.entries(PROTOCOLS).map(([key, m]) => <MenuItem key={key} value={key}>{m.label}</MenuItem>)}
          </TextField>
        </Box>
        <Box sx={two}>
          <TextField label="Host" value={form.host} onChange={e => set('host', e.target.value)} placeholder="db.internal.local" />
          <TextField label="Port" type="number" value={form.port} onChange={e => set('port', Number(e.target.value))} />
        </Box>
        <Box sx={two}>
          <TextField label={form.protocol === 'minio' ? 'Access key' : 'Username'} value={form.username}
            onChange={e => set('username', e.target.value)} placeholder={form.protocol === 'minio' ? 'minioadmin' : 'app_user'} />
          <TextField select label="Auth" value={form.auth_type} onChange={e => set('auth_type', e.target.value)}>
            <MenuItem value="none">None</MenuItem>
            <MenuItem value="password">Password</MenuItem>
            <MenuItem value="token">Token / API key</MenuItem>
          </TextField>
        </Box>

        {isDb && (
          <TextField label="Database" value={form.database || ''} onChange={e => set('database', e.target.value)}
            placeholder={form.protocol === 'postgres' ? 'postgres' : 'app'} />
        )}
        {(form.auth_type === 'password' || form.protocol === 'postgres' || form.protocol === 'mysql' || form.protocol === 'redis' || form.protocol === 'minio') && form.auth_type !== 'token' && (
          <TextField label={form.protocol === 'minio' ? 'Secret key' : 'Password'} type="password" value={form.password}
            onChange={e => set('password', e.target.value)} placeholder={editId ? 'Leave blank to keep current' : ''} />
        )}
        {form.auth_type === 'token' && (
          <TextField label="Token / secret" type="password" value={form.secret}
            onChange={e => set('secret', e.target.value)} placeholder={editId ? 'Leave blank to keep current' : ''} />
        )}

        <TextField select label="Connection method" value={form.use_gateway ? 'true' : 'false'} onChange={e => set('use_gateway', e.target.value === 'true')}>
          <MenuItem value="true">Via gateway (secure)</MenuItem>
          <MenuItem value="false">Direct</MenuItem>
        </TextField>

        <TextField label="Description" multiline minRows={2} value={form.description}
          onChange={e => set('description', e.target.value)} placeholder="What is this resource for?" />

        <Box sx={two}>
          <TextField label="Tags" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="prod, critical" />
          <TextField select label="Folder" value={form.folder_id ?? ''} onChange={e => set('folder_id', e.target.value ? Number(e.target.value) : null)}>
            <MenuItem value="">No folder</MenuItem>
            {folders.map((f: FolderItem) => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
          </TextField>
        </Box>
      </Box>
    </Modal>
  )
}
