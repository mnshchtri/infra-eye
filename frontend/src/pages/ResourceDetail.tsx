import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Database, Shield, CheckCircle2, ShieldCheck, Trash2, Plus, ArrowRight, Search, Clock3,
  Play, Terminal, Table, Loader2, Globe, Activity, Cpu, Layers, User, Lock, History, Code
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
  database?: string
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
  { value: 'read', label: 'READ ONLY' },
  { value: 'write', label: 'READ + WRITE' },
  { value: 'admin', label: 'ADMIN ACCESS' },
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
  const [activeTab, setActiveTab] = useState<'overview' | 'query' | 'access' | 'audit'>('overview')
  const [assignUserId, setAssignUserId] = useState<number | ''>('')
  const [assignLevel, setAssignLevel] = useState('read')
  const [savingAccess, setSavingAccess] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  // Audit filter state
  const [auditLimit, setAuditLimit] = useState(20)
  const [auditSince, setAuditSince] = useState('')
  const [auditUntil, setAuditUntil] = useState('')
  const [loadingAudit, setLoadingAudit] = useState(false)

  // Query state
  const [sql, setSql] = useState('SELECT * FROM users LIMIT 10;')
  const [queryResult, setQueryResult] = useState<any>(null)
  const [runningQuery, setRunningQuery] = useState(false)

  const resourceName = resource?.name || 'SYNCING...'

  useEffect(() => {
    if (!id) return
    loadPageData()
  }, [id])

  useEffect(() => {
    if (activeTab === 'audit') {
      loadAudit()
    }
  }, [auditLimit, auditSince, auditUntil, activeTab])

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

  async function loadAudit() {
    if (!id) return
    setLoadingAudit(true)
    try {
      const params: any = { limit: auditLimit }
      if (auditSince) params.since = auditSince ? new Date(auditSince).toISOString() : ''
      if (auditUntil) params.until = auditUntil ? new Date(auditUntil).toISOString() : ''
      const res = await api.get(`/api/resources/${id}/audit`, { params })
      setAudits(res.data || [])
    } catch (err: any) {
      toast.error('Audit load failed', err.response?.data?.error || err.message || 'Unable to load audit history')
    } finally {
      setLoadingAudit(false)
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

  async function runQuery() {
    if (!sql.trim()) return
    setRunningQuery(true)
    setQueryResult(null)
    try {
      const res = await api.post(`/api/resources/${id}/query`, { sql })
      setQueryResult(res.data)
      toast.success('Query executed', 'The operation completed successfully.')
    } catch (err: any) {
      toast.error('Query failed', err.response?.data?.error || 'Unable to execute SQL')
    } finally {
      setRunningQuery(false)
    }
  }

  const assignedUsers = useMemo(() => accessRecords.length, [accessRecords])

  const renderAuditDetails = (details: string) => {
    try {
      const parsed = JSON.parse(details)
      return parsed.message || details
    } catch {
      return details
    }
  }

  if (loading && !resource) {
    return (
      <div className="page" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Loader2 size={32} className="spin" color="var(--brand-primary)" />
        <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 12 }}>Syncing Resource Parameters...</span>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn-icon-sm" onClick={() => navigate('/resources')} title="Back to Registry">
            <ArrowLeft size={14} />
          </button>
          <div style={{ width: 48, height: 48, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
             <Database size={24} color="var(--brand-primary)" />
          </div>
          <div>
            <h1 className="page-title">{resourceName}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{resource?.resource_type.toUpperCase()}</span>
              <span className={`badge badge-${resource?.status === 'online' ? 'online' : 'warning'}`}>{resource?.status.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tabs-container" style={{ display: 'flex', gap: 2, marginBottom: 28, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'overview', label: 'OVERVIEW', icon: Database },
          { id: 'query', label: 'SQL CONSOLE', icon: Code },
          { id: 'access', label: 'ACCESS CONTROL', icon: Lock },
          { id: 'audit', label: 'AUDIT LOGS', icon: History }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`sidebar-link ${activeTab === tab.id ? 'active' : ''}`}
            style={{ 
              border: 'none', background: 'transparent', margin: 0, padding: '12px 24px',
              borderBottom: activeTab === tab.id ? '2px solid var(--brand-primary)' : '2px solid transparent'
            }}
          >
            <tab.icon size={14} style={{ marginRight: 8 }} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid-stats-4" style={{ marginBottom: 32 }}>
        <div className="card stat-card">
          <div className="stat-icon-wrapper"><Globe size={18} /></div>
          <div className="stat-val-group">
            <div className="stat-value" style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>{resource?.host}</div>
            <div className="stat-label">ENDPOINT HOST</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon-wrapper"><Shield size={18} /></div>
          <div className="stat-val-group">
            <div className="stat-value" style={{ fontSize: 13 }}>{resource?.protocol.toUpperCase()}</div>
            <div className="stat-label">COMM PROTOCOL</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon-wrapper"><ShieldCheck size={18} /></div>
          <div className="stat-val-group">
            <div className="stat-value" style={{ fontSize: 13 }}>{resource?.use_gateway ? 'ENABLED' : 'DISABLED'}</div>
            <div className="stat-label">GATEWAY TUNNEL</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon-wrapper"><User size={18} /></div>
          <div className="stat-val-group">
            <div className="stat-value" style={{ fontSize: 13 }}>{assignedUsers}</div>
            <div className="stat-label">PERMITTED USERS</div>
          </div>
        </div>
      </div>

      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24 }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <Activity size={18} color="var(--brand-primary)" />
              <h3 style={{ fontSize: 13, fontWeight: 900 }}>RESOURCE_CONFIGURATION_MANIFEST</h3>
            </div>
            
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div className="info-block"><strong>TYPE</strong><span>{resource?.resource_type.toUpperCase()}</span></div>
              <div className="info-block"><strong>PROTOCOL</strong><span>{resource?.protocol.toUpperCase()}</span></div>
              <div className="info-block"><strong>PORT_ASSIGNMENT</strong><span style={{ fontFamily: 'var(--font-mono)' }}>{resource?.port}</span></div>
              <div className="info-block"><strong>AUTH_STRATEGY</strong><span>{resource?.auth_type.toUpperCase()}</span></div>
              <div className="info-block"><strong>IDENTITY</strong><span>{resource?.username || 'ANONYMOUS'}</span></div>
              {(resource?.protocol === 'postgres' || resource?.protocol === 'mysql') && (
                <div className="info-block"><strong>DATABASE_SCHEMA</strong><span>{resource?.database || 'postgres'}</span></div>
              )}
            </div>

            <div style={{ marginTop: 24 }}>
              <div className="input-label" style={{ fontSize: 10, fontWeight: 900, marginBottom: 8 }}>DESCRIPTION_METADATA</div>
              <div style={{ padding: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
                {resource?.description || 'No operational notes provided for this resource.'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <Layers size={18} color="var(--brand-primary)" />
                <h3 style={{ fontSize: 13, fontWeight: 900 }}>TAG_INDEX</h3>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {resource?.tags ? resource.tags.split(',').map((tag) => (
                  <span key={tag} className="server-tag" style={{ padding: '4px 10px', fontSize: 10 }}>{tag.trim().toUpperCase()}</span>
                )) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No classification tags.</span>}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <Clock3 size={18} color="var(--brand-primary)" />
                <h3 style={{ fontSize: 13, fontWeight: 900 }}>TEMPORAL_DATA</h3>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div className="input-label" style={{ fontSize: 9 }}>PROVISIONED_AT</div>
                  <div style={{ fontWeight: 800, fontSize: 12 }}>{resource?.created_at ? format(new Date(resource.created_at), 'PPP p').toUpperCase() : '—'}</div>
                </div>
                <div>
                  <div className="input-label" style={{ fontSize: 9 }}>LAST_SYNCHRONIZED</div>
                  <div style={{ fontWeight: 800, fontSize: 12 }}>{resource?.updated_at ? format(new Date(resource.updated_at), 'PPP p').toUpperCase() : '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'query' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Code size={18} color="var(--brand-primary)" />
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 900 }}>SECURE_SQL_TERMINAL</h3>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 800 }}>EXECUTE AD-HOC QUERIES VIA ENCLAVE GATEWAY</p>
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={runQuery} disabled={runningQuery} style={{ height: 36 }}>
              {runningQuery ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              <span style={{ marginLeft: 8 }}>{runningQuery ? 'EXECUTING...' : 'RUN_QUERY'}</span>
            </button>
          </div>

          <div className="input-group">
            <textarea
              className="input"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 160, background: 'var(--bg-app)', color: 'var(--brand-primary)', border: '1px solid var(--border)', padding: 16 }}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="SELECT * FROM main_schema.targets LIMIT 10;"
            />
          </div>

          {queryResult && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Table size={14} color="var(--brand-primary)" />
                  <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>EXECUTION_RESULT</span>
                </div>
                <span className="badge" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  {queryResult.type === 'select' ? `${queryResult.rows?.length || 0} ROWS RETURNED` : `${queryResult.rows_affected || 0} ROWS IMPACTED`}
                </span>
              </div>

              {queryResult.type === 'select' ? (
                <div className="table-container">
                  <table className="k-table">
                    <thead>
                      <tr>
                        {queryResult.columns?.map((col: string) => (<th key={col}>{col.toUpperCase()}</th>))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.rows?.length === 0 ? (
                        <tr><td colSpan={queryResult.columns?.length} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, fontWeight: 800 }}>ZERO_RESULT_SET_RETURNED</td></tr>
                      ) : queryResult.rows?.map((row: any, i: number) => (
                        <tr key={i}>
                          {queryResult.columns?.map((col: string) => (<td key={col} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(row[col])}</td>))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 32, background: 'var(--bg-elevated)', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <CheckCircle2 size={32} style={{ color: 'var(--success)', marginBottom: 12, margin: '0 auto' }} />
                  <div style={{ fontWeight: 900, fontSize: 14, textTransform: 'uppercase', marginTop: 12 }}>TRANSACTION_SUCCESS</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, fontWeight: 800 }}>{queryResult.rows_affected} RECORDS MODIFIED IN DATABASE ENGINE</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'access' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Lock size={18} color="var(--brand-primary)" />
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 900 }}>ACCESS_PERMISSION_MATRIX</h3>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 800 }}>MANAGE RBAC ENTITLEMENTS FOR THIS RESOURCE</p>
              </div>
            </div>
          </div>

          {canManage && (
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 200px 160px', alignItems: 'end', padding: 20, background: 'var(--bg-elevated)', border: '1px solid var(--border)', marginBottom: 24 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label" style={{ fontSize: 10, fontWeight: 900 }}>TARGET_USER</label>
                <select className="input" value={assignUserId} onChange={(e) => setAssignUserId(Number(e.target.value) || '')}>
                  <option value="">SELECT USER IDENTITY</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.username.toUpperCase()} ({user.role.toUpperCase()})</option>
                  ))}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label" style={{ fontSize: 10, fontWeight: 900 }}>PRIVILEGE_LEVEL</label>
                <select className="input" value={assignLevel} onChange={(e) => setAssignLevel(e.target.value)}>
                  {accessLevels.map((level) => (<option key={level.value} value={level.value}>{level.label}</option>))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={assignAccess} disabled={savingAccess} style={{ height: 40 }}>
                {savingAccess ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                <span style={{ marginLeft: 8 }}>{savingAccess ? 'GRANTING...' : 'GRANT_ACCESS'}</span>
              </button>
            </div>
          )}

          <div className="table-container">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Identity</th>
                  <th>System Role</th>
                  <th>Privilege</th>
                  <th>Granted At</th>
                  {canManage && <th>Operations</th>}
                </tr>
              </thead>
              <tbody>
                {accessRecords.length === 0 ? (
                  <tr><td colSpan={canManage ? 5 : 4} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, fontWeight: 800 }}>NO_ACCESS_POLICIES_DEFINED</td></tr>
                ) : accessRecords.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <div style={{ fontWeight: 800 }}>{entry.user?.username.toUpperCase() || 'UNKNOWN_ID'}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{entry.user?.email}</div>
                    </td>
                    <td><span className="badge" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>{entry.user?.role.toUpperCase() || '—'}</span></td>
                    <td>
                      <span className={`badge ${entry.access_level === 'admin' ? 'badge-online' : ''}`} style={{ border: '1px solid var(--border)', background: entry.access_level === 'admin' ? 'var(--brand-glow)' : 'var(--bg-elevated)' }}>
                        {entry.access_level.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{entry.created_at ? format(new Date(entry.created_at), 'PPP').toUpperCase() : '—'}</td>
                    {canManage && (
                      <td>
                        <button className="btn-icon-sm danger" title="Revoke Privilege" onClick={() => revokeAccess(entry.id)} disabled={revokingId === entry.id}>
                          {revokingId === entry.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <History size={18} color="var(--brand-primary)" />
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 900 }}>OPERATIONAL_AUDIT_LEDGER</h3>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 800 }}>IMMUTABLE RECORD OF RESOURCE INTERACTIONS</p>
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)' }}>SINCE</span>
                <input 
                  type="date" 
                  className="input" 
                  style={{ height: 32, fontSize: 11, width: 130, padding: '0 8px' }} 
                  value={auditSince}
                  onChange={(e) => setAuditSince(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)' }}>UNTIL</span>
                <input 
                  type="date" 
                  className="input" 
                  style={{ height: 32, fontSize: 11, width: 130, padding: '0 8px' }} 
                  value={auditUntil}
                  onChange={(e) => setAuditUntil(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)' }}>LIMIT</span>
                <select 
                  className="input" 
                  style={{ height: 32, fontSize: 11, width: 80, padding: '0 8px' }}
                  value={auditLimit}
                  onChange={(e) => setAuditLimit(Number(e.target.value))}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <button 
                className="btn-icon-sm" 
                onClick={() => loadAudit()} 
                disabled={loadingAudit}
                title="Refresh logs"
              >
                {loadingAudit ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
              </button>
            </div>
          </div>

          <div className="table-container">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Operation</th>
                  <th>Execution Details</th>
                </tr>
              </thead>
              <tbody>
                {loadingAudit && audits.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 60, textAlign: 'center' }}><Loader2 size={24} className="spin" style={{ margin: '0 auto' }} /><div style={{ marginTop: 12, fontSize: 10, fontWeight: 800, color: 'var(--text-muted)' }}>FETCHING_AUDIT_DATA...</div></td></tr>
                ) : audits.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, fontWeight: 800 }}>NO_AUDIT_RECORDS_AVAILABLE</td></tr>
                ) : audits.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{format(new Date(entry.created_at), 'MM/dd HH:mm:ss')}</td>
                    <td style={{ fontWeight: 800 }}>{entry.performed_by.toUpperCase() || 'SYSTEM_DAEMON'}</td>
                    <td>
                      <span className="badge" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                        {entry.action.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {renderAuditDetails(entry.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .info-block { padding: 16px; border: 1px solid var(--border); background: var(--bg-elevated); display: flex; flex-direction: column; gap: 4px; }
        .info-block strong { font-size: 9px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.1em; font-weight: 900; }
        .info-block span { font-size: 13px; color: var(--text-primary); fontWeight: 800; }
      `}</style>
    </div>
  )
}
