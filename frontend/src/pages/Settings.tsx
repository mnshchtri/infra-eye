import { useState, useEffect } from 'react'
import { User, Shield, Mail, Lock, Plus, Pencil, Trash2, Power, PowerOff } from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { usePermission } from '../hooks/usePermission'

interface UserData {
  id: number
  username: string
  role: string
  email: string
  is_active: boolean
}

export function Settings() {
  const { user: currentUser } = useAuthStore()
  const { can } = usePermission()
  
  const [activeTab, setActiveTab] = useState<'profile' | 'users'>('profile')
  const [users, setUsers] = useState<UserData[]>([])
  const [loading, setLoading] = useState(false)

  // Profile form state
  const [profileEmail, setProfileEmail] = useState(currentUser?.email || '')
  const [profilePassword, setProfilePassword] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)

  // User management form state
  const [showUserForm, setShowUserForm] = useState(false)
  const emptyUserForm = { username: '', password: '', role: 'intern', email: '', is_active: true }
  const [userForm, setUserForm] = useState(emptyUserForm)
  const [editUserId, setEditUserId] = useState<number | null>(null)
  const [userSaving, setUserSaving] = useState(false)

  useEffect(() => {
    if (activeTab === 'users' && can('manage-users')) {
      loadUsers()
    }
  }, [activeTab, can])

  async function loadUsers() {
    setLoading(true)
    try {
      const res = await api.get('/api/users')
      setUsers(res.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function updateProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileSaving(true)
    try {
      const payload: any = {}
      if (profileEmail) payload.email = profileEmail
      if (profilePassword) payload.password = profilePassword
      
      const res = await api.put('/api/auth/me', payload)
      useAuthStore.getState().setAuth(useAuthStore.getState().token!, res.data)
      alert('Profile updated successfully')
      setProfilePassword('')
    } catch (err: any) {
      alert(err.response?.data?.error || 'Update failed')
    } finally {
      setProfileSaving(false)
    }
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault()
    setUserSaving(true)
    try {
      if (editUserId) {
        // Edit mode doesn't send username
        const { role, email, is_active, password } = userForm
        const payload: any = { role, email, is_active }
        if (password) payload.password = password
        await api.put(`/api/users/${editUserId}`, payload)
      } else {
        await api.post('/api/users', userForm)
      }
      setShowUserForm(false)
      loadUsers()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Save failed')
    } finally {
      setUserSaving(false)
    }
  }

  async function deleteUser(id: number, username: string) {
    if (!confirm(`Permanently delete user ${username}?`)) return
    try {
      await api.delete(`/api/users/${id}`)
      loadUsers()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  function editUser(u: UserData) {
    setUserForm({ username: u.username, email: u.email, role: u.role, is_active: u.is_active, password: '' })
    setEditUserId(u.id)
    setShowUserForm(true)
  }

  const roleColors: Record<string, string> = {
    admin: 'var(--danger)',
    devops: 'var(--brand-primary)',
    trainee: 'var(--warning)',
    intern: 'var(--info)'
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your account and platform preferences</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 32, background: 'var(--bg-elevated)', borderRadius: 14, padding: 4, width: 'fit-content', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
        <button
          onClick={() => setActiveTab('profile')}
          style={{
            padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            transition: 'all 0.2s', cursor: 'pointer', border: 'none',
            display: 'flex', alignItems: 'center', gap: 7,
            ...(activeTab === 'profile'
              ? { background: 'var(--brand-primary)', color: 'var(--text-primary)', boxShadow: '0 4px 12px var(--brand-glow)' }
              : { background: 'transparent', color: 'var(--text-muted)' }
            ),
          }}
        >
          <User size={14} /> My Profile
        </button>

        {can('manage-users') && (
          <button
            onClick={() => setActiveTab('users')}
            style={{
              padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
              transition: 'all 0.2s', cursor: 'pointer', border: 'none',
              display: 'flex', alignItems: 'center', gap: 7,
              ...(activeTab === 'users'
                ? { background: 'var(--brand-primary)', color: 'var(--text-primary)', boxShadow: '0 4px 12px var(--brand-glow)' }
                : { background: 'transparent', color: 'var(--text-muted)' }
              ),
            }}
          >
            <Shield size={14} /> User Management
          </button>
        )}
      </div>

      {activeTab === 'profile' && (
        <div className="card fade-in" style={{ maxWidth: 500 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={18} /> Personal Information
          </h3>
          <form onSubmit={updateProfile}>
            <div className="input-group">
              <label className="input-label">Username</label>
              <input className="input" value={currentUser?.username} disabled style={{ opacity: 0.6 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Username cannot be changed.</span>
            </div>
            
            <div className="input-group">
              <label className="input-label">Role</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="badge" style={{ background: `${roleColors[currentUser?.role || 'intern']}20`, color: roleColors[currentUser?.role || 'intern'], border: `1px solid ${roleColors[currentUser?.role || 'intern']}40` }}>
                  {currentUser?.role.toUpperCase()}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Contact an admin to change your role.</span>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-muted)' }} />
                <input className="input" style={{ paddingLeft: 40 }} value={profileEmail} onChange={e => setProfileEmail(e.target.value)} placeholder="you@example.com" />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">New Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-muted)' }} />
                <input className="input" type="password" style={{ paddingLeft: 40 }} value={profilePassword} onChange={e => setProfilePassword(e.target.value)} placeholder="Leave blank to keep current" minLength={6} />
              </div>
            </div>

            <div style={{ marginTop: 32 }}>
              <button type="submit" className="btn btn-primary" disabled={profileSaving}>
                {profileSaving ? 'Saving...' : 'Update Profile'}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'users' && can('manage-users') && (
        <div className="fade-in">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => { setShowUserForm(true); setEditUserId(null); setUserForm(emptyUserForm) }}>
              <Plus size={14} /> Add User
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['User', 'Role', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '16px 24px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '40px' }}>Loading...</td>
                  </tr>
                ) : users.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f1f5f9', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{u.username}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{u.email || 'No email provided'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <span className="badge" style={{ background: `${roleColors[u.role] || 'var(--text-muted)'}20`, color: roleColors[u.role] || 'var(--text-muted)', border: `1px solid ${roleColors[u.role] || 'var(--text-muted)'}40` }}>
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      {u.is_active 
                        ? <span style={{ color: 'var(--success)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Power size={12} /> Active</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><PowerOff size={12} /> Inactive</span>
                      }
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ padding: '7px 10px', borderRadius: 8, background: '#f1f5f9', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => editUser(u)}>
                          <Pencil size={13} />
                        </button>
                        {currentUser?.id !== u.id && (
                          <button style={{ padding: '7px 10px', borderRadius: 8, background: 'var(--danger-glow)', border: '1px solid #fecaca', color: 'var(--danger)', cursor: 'pointer' }} onClick={() => deleteUser(u.id, u.username)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Form Modal */}
      {showUserForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card fade-up" style={{ width: '100%', maxWidth: 440, padding: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>{editUserId ? 'Edit User' : 'Create New User'}</h2>
            <form onSubmit={saveUser}>
              <div className="input-group">
                <label className="input-label">Username</label>
                <input className="input" required value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} disabled={!!editUserId} />
              </div>
              <div className="input-group">
                <label className="input-label">Email</label>
                <input className="input" type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} />
              </div>
              <div className="input-group">
                <label className="input-label">{editUserId ? 'New Password (Optional)' : 'Password'}</label>
                <input className="input" type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required={!editUserId} minLength={6} />
              </div>
              <div className="input-group">
                <label className="input-label">Role</label>
                <select className="input" value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})}>
                  <option value="intern">Intern</option>
                  <option value="trainee">Trainee</option>
                  <option value="devops">DevOps</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {!!editUserId && (
                <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <input type="checkbox" id="activeCheckbox" checked={userForm.is_active} onChange={e => setUserForm({...userForm, is_active: e.target.checked})} style={{ width: 16, height: 16 }} />
                  <label htmlFor="activeCheckbox" className="input-label" style={{ marginBottom: 0, cursor: 'pointer' }}>Account is Active</label>
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowUserForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={userSaving}>Save User</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
