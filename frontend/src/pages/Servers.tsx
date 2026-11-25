import { useState, useEffect } from 'react'
import { Plus, Server, Trash2, Pencil, Wifi, WifiOff, Search } from 'lucide-react'
import {
  Box, Chip, CircularProgress, IconButton, Link, MenuItem, TextField, Tooltip, Typography,
  ToggleButton, ToggleButtonGroup, Alert, Button as MuiButton,
} from '@mui/material'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { WindowsIcon, AppleIcon, KubernetesIcon, DistroIcon } from '../components/OSIcons'
import { api } from '../api/client'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import { useFolders } from '../hooks/useFolders'
import { FolderBar, type FolderSelection } from '../components/ui/FolderBar'
import { FolderTag } from '../components/ui/FolderTag'
import { apiError, errMessage } from '../utils/errors'
import { PageHeader, SearchInput, EmptyState, Modal, Button } from '../components/ui'

interface ServerData {
  id: number; name: string; host: string; port: number;
  ssh_user: string; auth_type: string; tags: string;
  description: string; status: string; ssh_key_path: string;
  os: string;
  distro?: string;
  has_kubeconfig?: boolean;
  folder_id?: number | null;
  git_managed?: boolean;
}

const emptyForm = {
  name: '', host: '', port: 22, ssh_user: 'root',
  auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa',
  ssh_password: '', tags: '', description: '',
  folder_id: null as number | null,
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
  const [editingGitManaged, setEditingGitManaged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [disconnecting, setDisconnecting] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; msg: string }>>({})
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { folders, createFolder, deleteFolder } = useFolders()
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>('all')

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
    } catch (err: unknown) {
      toast.error('Save failed', apiError(err) || 'Could not save server.')
    } finally {
      setSaving(false)
    }
  }

  function editServer(s: ServerData) {
    setForm({
      name: s.name, host: s.host, port: s.port, ssh_user: s.ssh_user,
      auth_type: s.auth_type, ssh_key_path: s.ssh_key_path || '',
      ssh_password: '', tags: s.tags, description: s.description,
      folder_id: s.folder_id ?? null,
    })
    setEditId(s.id)
    setEditingGitManaged(!!s.git_managed)
    setShowForm(true)
  }

  async function moveServerFolder(id: number, folderId: number | null) {
    try {
      await api.patch(`/api/servers/${id}/folder`, { folder_id: folderId })
      setServers(prev => prev.map(s => s.id === id ? { ...s, folder_id: folderId } : s))
    } catch (err: unknown) {
      toast.error('Move failed', apiError(err) || 'Could not move server.')
    }
  }

  async function deleteServer(id: number) {
    try {
      await api.delete(`/api/servers/${id}`)
      toast.success('Server deleted', 'Server and all data permanently removed.')
      setConfirmDelete(null)
      loadServers()
    } catch (err: unknown) {
      toast.error('Delete failed', apiError(err))
      setConfirmDelete(null)
    }
  }

  async function testConnection(id: number) {
    setTesting(id)
    try {
      const res = await api.post(`/api/servers/${id}/test`)
      const ok = res.data.status === 'online'
      setTestResults(prev => ({ ...prev, [id]: { ok, msg: ok ? (res.data.output || '') : (res.data.error || '') } }))
      if (ok) {
        setServers(prev => prev.map(s => s.id === id ? { ...s, status: 'online', os: res.data.os } : s))
        toast.success('Connected', `Server is online (${res.data.os || 'linux'})`)
      } else {
        toast.error('Connection failed', res.data.error || 'Could not reach the server.')
      }
    } catch (err: unknown) {
      const errorMsg = errMessage(err, 'Could not reach the server.')
      setTestResults(prev => ({ ...prev, [id]: { ok: false, msg: errorMsg } }))
      toast.error('Connection failed', errorMsg)
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
    } catch (err: unknown) {
      const errorMsg = errMessage(err, 'Disconnect failed')
      toast.error('Disconnect failed', errorMsg)
    } finally {
      setDisconnecting(null)
    }
  }

  const filtered = servers.filter(s => {
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      (s.tags && s.tags.toLowerCase().includes(q)) ||
      (s.description && s.description.toLowerCase().includes(q))
    const matchesFolder =
      selectedFolder === 'all' ? true :
      selectedFolder === 'unassigned' ? !s.folder_id :
      s.folder_id === selectedFolder
    return matchesSearch && matchesFolder
  })

  function openAdd() {
    setShowForm(true); setEditId(null); setEditingGitManaged(false); setForm(emptyForm)
  }

  const canManage = can('manage-servers')

  const columns: GridColDef<ServerData>[] = [
    {
      field: 'name', headerName: 'Server', flex: 1.4, minWidth: 220,
      renderCell: ({ row: s }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ width: 30, height: 30, border: 1, borderColor: 'divider', borderRadius: 1, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            {s.has_kubeconfig
              ? <KubernetesIcon size={18} />
              : s.os === 'darwin' ? <AppleIcon size={14} color="var(--brand-primary)" />
              : s.os === 'windows' ? <WindowsIcon size={14} color="var(--brand-primary)" />
              : s.os === 'linux' ? <DistroIcon distro={s.distro} size={14} color="var(--brand-primary)" />
              : <Server size={14} color="var(--brand-primary)" />}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Link component="button" underline="hover" color="text.primary" onClick={() => navigate(`/servers/${s.id}`)}
                sx={{ fontWeight: 600, fontSize: 13, textAlign: 'left' }} noWrap>
                {s.name}
              </Link>
              {s.git_managed && (
                <Tooltip title="Created/updated by Git sync — editing this server will stop future syncs from managing it">
                  <Chip label="Git" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                </Tooltip>
              )}
            </Box>
            {s.description && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{s.description}</Typography>}
          </Box>
        </Box>
      ),
    },
    { field: 'os', headerName: 'OS', width: 100, valueGetter: (_v, r) => r.os || 'host', renderCell: ({ value }) => <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>{value}</Typography> },
    {
      field: 'host', headerName: 'Connection', flex: 1, minWidth: 170,
      renderCell: ({ row: s }) => s.host
        ? <Typography variant="body2" sx={{ fontFamily: 'var(--font-mono)' }}>{s.ssh_user}@{s.host}</Typography>
        : <Chip label="Direct API" color="success" size="small" />,
    },
    { field: 'auth_type', headerName: 'Auth', width: 120, renderCell: ({ value }) => <Chip label={String(value).charAt(0).toUpperCase() + String(value).slice(1)} variant="outlined" size="small" /> },
    {
      field: 'tags', headerName: 'Tags', flex: 1, minWidth: 140, sortable: false,
      renderCell: ({ row: s }) => (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {s.tags?.split(',').filter(Boolean).map(t => <Chip key={t} label={t.trim()} size="small" variant="outlined" />)}
        </Box>
      ),
    },
    {
      field: 'folder_id', headerName: 'Folder', width: 190, sortable: false,
      renderCell: ({ row: s }) => (
        <FolderTag folders={folders} value={s.folder_id ?? null} onChange={fid => moveServerFolder(s.id, fid)} disabled={!canManage} />
      ),
    },
    {
      field: 'status', headerName: 'Status', width: 120,
      renderCell: ({ row: s }) => {
        const r = testResults[s.id]
        if (r !== undefined) {
          return (
            <Tooltip title={r.ok ? '' : r.msg}>
              <Chip label={r.ok ? 'Connected' : 'Failed'} color={r.ok ? 'success' : 'error'} size="small" />
            </Tooltip>
          )
        }
        return <Chip label={s.status.charAt(0).toUpperCase() + s.status.slice(1)} color={s.status === 'online' ? 'success' : 'default'} variant={s.status === 'online' ? 'filled' : 'outlined'} size="small" />
      },
    },
    {
      field: 'actions', headerName: '', width: 170, sortable: false, align: 'right', headerAlign: 'right',
      renderCell: ({ row: s }) => (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {canManage && (s.status === 'online' ? (
            <Tooltip title="Disconnect">
              <span>
                <IconButton onClick={() => disconnectServer(s.id)} disabled={disconnecting === s.id} aria-label="Disconnect">
                  {disconnecting === s.id ? <CircularProgress size={14} /> : <WifiOff size={15} />}
                </IconButton>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title="Connect">
              <span>
                <IconButton color="success" onClick={() => testConnection(s.id)} disabled={testing === s.id} aria-label="Connect">
                  {testing === s.id ? <CircularProgress size={14} /> : <Wifi size={15} />}
                </IconButton>
              </span>
            </Tooltip>
          ))}
          {canManage && (
            <Tooltip title="Edit"><IconButton onClick={() => editServer(s)} aria-label="Edit"><Pencil size={15} /></IconButton></Tooltip>
          )}
          {can('delete-server') && (confirmDelete === s.id ? (
            <>
              <MuiButton size="small" color="error" variant="contained" onClick={() => deleteServer(s.id)}>Confirm</MuiButton>
              <MuiButton size="small" color="inherit" onClick={() => setConfirmDelete(null)}>Cancel</MuiButton>
            </>
          ) : (
            <Tooltip title="Delete"><IconButton color="error" onClick={() => setConfirmDelete(s.id)} aria-label="Delete"><Trash2 size={15} /></IconButton></Tooltip>
          ))}
        </Box>
      ),
    },
  ]

  const textField = (label: string, key: 'name' | 'host' | 'port' | 'ssh_user', placeholder: string, type?: string) => (
    <TextField
      key={key} label={label} placeholder={placeholder} type={type || 'text'} fullWidth
      value={form[key]}
      onChange={e => setForm({ ...form, [key]: type === 'number' ? +e.target.value : e.target.value })}
    />
  )

  return (
    <div className="page">
      <PageHeader
        title="Servers"
        subtitle="Manage and monitor connected infrastructure"
        actions={
          <>
            <Box sx={{ width: 260 }}><SearchInput value={searchQuery} onChange={setSearchQuery} /></Box>
            {canManage && <Button icon={<Plus size={14} />} onClick={openAdd}>Add Server</Button>}
          </>
        }
      />

      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        size="md"
        icon={Plus}
        title={editId ? 'Update server credentials' : 'Add server'}
        subtitle={editId ? 'Modify infrastructure access parameters' : 'Establish a secure SSH connection to new infrastructure'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={saveServer} loading={saving}>{editId ? 'Update Server' : 'Add Server'}</Button>
          </>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {editId && editingGitManaged && (
            <Alert severity="warning">
              This server was created by Git sync — saving changes here will stop future syncs from managing it.
            </Alert>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            {textField('Name', 'name', 'prod-web-01')}
            {textField('Host', 'host', '192.168.1.100')}
            {textField('Port', 'port', '22', 'number')}
            {textField('User', 'ssh_user', 'root')}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Authentication method</Typography>
            <ToggleButtonGroup
              exclusive fullWidth size="small" value={form.auth_type}
              onChange={(_, v) => v && setForm({ ...form, auth_type: v })}
            >
              <ToggleButton value="key">SSH Key File</ToggleButton>
              <ToggleButton value="password">Password</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {form.auth_type === 'key' ? (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="subtitle2">SSH private key</Typography>
                <MuiButton component="label" size="small" variant="outlined" color="inherit">
                  Upload key file
                  <input type="file" hidden onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const reader = new FileReader()
                      reader.onload = (ev) => setForm({ ...form, ssh_key_path: ev.target?.result as string })
                      reader.readAsText(file)
                    }
                  }} />
                </MuiButton>
              </Box>
              <TextField
                multiline minRows={5} maxRows={12} fullWidth
                value={form.ssh_key_path}
                onChange={e => setForm({ ...form, ssh_key_path: e.target.value })}
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                slotProps={{ htmlInput: { style: { fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre' } } }}
              />
            </Box>
          ) : (
            <TextField label="SSH password" type="password" fullWidth value={form.ssh_password}
              onChange={e => setForm({ ...form, ssh_password: e.target.value })} />
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField label="Tags" placeholder="production, mail" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
            <TextField label="Description" placeholder="Optional note" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </Box>

          <TextField
            select label="Folder" fullWidth value={form.folder_id ?? ''}
            onChange={e => setForm({ ...form, folder_id: e.target.value ? Number(e.target.value) : null })}
          >
            <MenuItem value="">No folder</MenuItem>
            {folders.map(f => <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>)}
          </TextField>
        </Box>
      </Modal>

      {!loading && servers.length > 0 && (
        <FolderBar
          folders={folders}
          counts={servers.reduce((acc, s) => {
            if (s.folder_id) acc[s.folder_id] = (acc[s.folder_id] || 0) + 1
            return acc
          }, {} as Record<number, number>)}
          unassignedCount={servers.filter(s => !s.folder_id).length}
          totalCount={servers.length}
          selected={selectedFolder}
          onSelect={setSelectedFolder}
          onCreate={createFolder}
          onDelete={deleteFolder}
          canManage={canManage}
        />
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}><CircularProgress /></Box>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No servers connected yet"
          description="Add your first server to start monitoring your infrastructure"
          action={canManage ? <Button icon={<Plus size={14} />} onClick={openAdd}>Add Your First Server</Button> : undefined}
        />
      ) : (
        <Box>
          <DataGrid
            autoHeight
            rows={filtered}
            columns={columns}
            rowHeight={60}
            disableRowSelectionOnClick
            disableColumnMenu
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            slots={{
              noRowsOverlay: () => (
                <EmptyState
                  icon={Search}
                  title="No matching servers found"
                  description="Try adjusting your search or clear it to see all servers."
                  action={<Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>Clear Search</Button>}
                />
              ),
            }}
            sx={{ bgcolor: 'background.paper', '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center', lineHeight: 1.35 } }}
          />
        </Box>
      )}
    </div>
  )
}
