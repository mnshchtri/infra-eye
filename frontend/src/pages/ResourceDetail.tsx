import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Database, Shield, CheckCircle2, ShieldCheck, Trash2, Plus, ArrowRight, Search, Clock3
} from 'lucide-react'
import { api } from '../api/client'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import { format } from 'date-fns'

interface ResourceDetailData {
  id: number
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
  created_at?: string
  updated_at?: string
}

interface UserData {
  id: number
  username: string
  email?: string
  role: string
}

interface AccessEntry {
  id: number
  resource_id: number
  user_id: number
  access_level: string
  user?: UserData
  created_at?: string
}

interface AuditEntry {
  id: number
  resource_id: number
  user_id: number
  action: string
  details: string
  performed_by: string
  created_at: string
}

const accessLevels = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read + write' },
  { value: 'admin', label: 'Admin access' },
]

export function ResourceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const { can } = usePermission()
  const canManage = can('manage-resources')

  const [resource, setResource] = useState<ResourceDetailData | null>(null)
  const [accessRecords, setAccessRecords] = useState<AccessEntry[]>([])
  const [users, setUsers] = useState<UserData[]>([])
  const [audits, setAudits] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'access' | 'audit'>('overview')
  const [assignUserId, setAssignUserId] = useState<number | ''>('')
  const [assignLevel, setAssignLevel] = useState('read')
  const [savingAccess, setSavingAccess] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  const resourceName = resource?.name || 'Loading...'

  useEffect(() => {
    if (!id) return
    loadPageData()
  }, [id])

  async function loadPageData() {
    setLoading(true)
    await Promise.all([loadResource(), loadAccess(), loadAudit(), loadUsers()])
    setLoading(false)
  }

  async function loadResource() {
    try {
      const res = await api.get(`/api/resources/${id}`)
      setResource(res.data)
    } catch (err: any) {
      toast.error('Load failed', err.response?.data?.error || 'Unable to load resource details')
    }
  }

  async function loadAccess() {
    if (!id) return
    try {
      const res = await api.get(`/api/resources/${id}/access`)
      setAccessRecords(res.data || [])
    } catch (err: any) {
      toast.error('Access load failed', err.response?.data?.error || err.message || 'Unable to load access records')
    }
  }

  async function loadUsers() {
    if (!canManage) return
    try {
      const res = await api.get('/api/users')
      setUsers(res.data || [])
    } catch (err: any) {
      toast.error('User list failed', err.response?.data?.error || err.message || 'Unable to load users')
    }
  }

  async function loadAudit() {
    if (!id) return
    try {
      const res = await api.get(`/api/resources/${id}/audit`)
      setAudits(res.data || [])
    } catch (err: any) {
      toast.error('Audit load failed', err.response?.data?.error || err.message || 'Unable to load audit history')
    }
  }

  async function assignAccess() {
    if (!assignUserId) {
      toast.error('Select a user', 'Choose a user to grant access.')
      return
    }
    setSavingAccess(true)
    try {
      await api.post(`/api/resources/${id}/access`, { user_id: assignUserId, access_level: assignLevel })
      toast.success('Access granted', 'User access has been assigned.')
      setAssignUserId('')
      setAssignLevel('read')
      await Promise.all([loadAccess(), loadAudit()])
    } catch (err: any) {
      toast.error('Grant failed', err.response?.data?.error || 'Unable to assign access')
    } finally {
      setSavingAccess(false)
    }
  }

  async function revokeAccess(accessId: number) {
    setRevokingId(accessId)
    try {
      await api.delete(`/api/resources/${id}/access/${accessId}`)
      toast.success('Access revoked', 'User access has been removed.')
      await Promise.all([loadAccess(), loadAudit()])
    } catch (err: any) {
      toast.error('Revoke failed', err.response?.data?.error || 'Unable to revoke access')
    } finally {
      setRevokingId(null)
    }
  }

  const assignedUsers = useMemo(() => accessRecords.length, [accessRecords])

  return (
    <div className="page" style={{ minHeight: '100%' }}>
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/resources')}>
          <ArrowLeft size={14} /> Back to Resources
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title" style={{ marginBottom: 8 }}>{resourceName}</h1>
          <p className="page-subtitle hidden-mobile">Manage resource access and database audit logs.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{resource?.resource_type || 'resource'}</span>
          <span className="badge badge-online" style={{ background: resource?.status === 'online' ? 'var(--success)' : 'var(--border)', color: resource?.status === 'online' ? 'var(--text-inverse)' : 'var(--text-muted)' }}>{resource?.status || 'unknown'}</span>
        </div>
      </div>

      <div className="tabs-container" style={{ display: 'flex', gap: 0, flexWrap: 'wrap', marginBottom: 28, borderBottom: '1px solid var(--border)' }}>
        {['overview', 'access', 'audit'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              padding: '12px 20px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', color: activeTab === tab ? 'var(--brand-primary)' : 'var(--text-muted)',
              position: 'relative'
            }}
          >
            {tab === 'overview' ? 'Overview' : tab === 'access' ? 'Access' : 'Audit'}
            {activeTab === tab && <div style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'var(--brand-primary)' }} />}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="card" style={{ padding: '24px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Database size={18} /><div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Resource</div><div style={{ fontWeight: 800 }}>{resource?.name || '—'}</div></div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Shield size={18} /><div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Protocol</div><div>{resource?.protocol || '—'}</div></div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><ShieldCheck size={18} /><div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Gateway</div><div>{resource?.use_gateway ? 'Enabled' : 'Disabled'}</div></div></div>
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Clock3 size={18} /><div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last Updated</div><div>{resource?.updated_at ? format(new Date(resource.updated_at), 'PPP p') : '—'}</div></div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><ArrowRight size={18} /><div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Host</div><div>{resource?.host || '—'}</div></div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><CheckCircle2 size={18} /><div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Assigned Users</div><div>{assignedUsers}</div></div></div>
          </div>
        </div>

        {activeTab === 'overview' && (
          <div className="card" style={{ padding: '24px 24px' }}>
            <div style={{ display: 'grid', gap: 18 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Overview</h2>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Review resource configuration and connectivity settings.</p>
              </div>
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <div className="info-block"><strong>Type</strong><span>{resource?.resource_type || '—'}</span></div>
                <div className="info-block"><strong>Protocol</strong><span>{resource?.protocol || '—'}</span></div>
                <div className="info-block"><strong>Host</strong><span>{resource?.host || '—'}</span></div>
                <div className="info-block"><strong>Port</strong><span>{resource?.port || '—'}</span></div>
                <div className="info-block"><strong>Username</strong><span>{resource?.username || '—'}</span></div>
                <div className="info-block"><strong>Auth Type</strong><span>{resource?.auth_type || '—'}</span></div>
              </div>
              <div style={{ display: 'grid', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Description</div>
                  <div style={{ padding: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', minHeight: 80 }}>{resource?.description || 'No description set.'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Tags</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {resource?.tags ? resource.tags.split(',').map((tag) => (<span key={tag} className="badge" style={{ padding: '6px 10px', fontSize: 11 }}>{tag.trim()}</span>)) : <span style={{ color: 'var(--text-muted)' }}>No tags assigned.</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'access' && (
          <div className="card" style={{ padding: '24px 24px' }}>
            <div style={{ display: 'grid', gap: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>User Access</h2>
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Assign and revoke user permissions for this resource.</p>
                </div>
                {canManage && (
                  <button className="btn btn-primary btn-sm" onClick={() => { setActiveTab('access'); }}>
                    <Plus size={14} /> Add Access
                  </button>
                )}
              </div>

              {canManage && (
                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 180px 140px', alignItems: 'end' }}>
                  <div className="input-group">
                    <label className="input-label">User</label>
                    <select className="input" value={assignUserId} onChange={(e) => setAssignUserId(Number(e.target.value) || '')}>
                      <option value="">Select a user</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>{user.username} ({user.role})</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label">Access Level</label>
                    <select className="input" value={assignLevel} onChange={(e) => setAssignLevel(e.target.value)}>
                      {accessLevels.map((level) => (<option key={level.value} value={level.value}>{level.label}</option>))}
                    </select>
                  </div>
                  <button className="btn btn-primary" onClick={assignAccess} disabled={savingAccess} style={{ height: 42 }}>
                    {savingAccess ? 'Assigning…' : 'Grant Access'}
                  </button>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table className="k-table" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Access</th>
                      <th>Assigned</th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {accessRecords.length === 0 ? (
                      <tr><td colSpan={canManage ? 5 : 4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No access assignments yet.</td></tr>
                    ) : accessRecords.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.user?.username || 'Unknown'}</td>
                        <td>{entry.user?.role || '—'}</td>
                        <td style={{ textTransform: 'capitalize' }}>{entry.access_level}</td>
                        <td>{entry.created_at ? format(new Date(entry.created_at), 'PPP') : '—'}</td>
                        {canManage && (
                          <td>
                            <button className="btn-icon" title="Revoke access" onClick={() => revokeAccess(entry.id)} disabled={revokingId === entry.id}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="card" style={{ padding: '24px 24px' }}>
            <div style={{ display: 'grid', gap: 18 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Audit History</h2>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Track which users performed access changes and resource operations.</p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="k-table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audits.length === 0 ? (
                      <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No audit activity recorded.</td></tr>
                    ) : audits.map((entry) => (
                      <tr key={entry.id}>
                        <td>{format(new Date(entry.created_at), 'PPP p')}</td>
                        <td>{entry.performed_by || 'system'}</td>
                        <td style={{ textTransform: 'capitalize' }}>{entry.action.replace(/_/g, ' ')}</td>
                        <td>{entry.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .info-block { padding: 16px; border: 1px solid var(--border); background: var(--bg-elevated); border-radius: 10px; display: flex; flex-direction: column; gap: 6px; }
        .info-block strong { font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.08em; }
        .info-block span { font-size: 14px; color: var(--text-primary); }
      `}</style>
    </div>
  )
}
