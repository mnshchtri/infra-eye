import { useState, useEffect } from 'react'
import { User, Shield, Mail, Lock, Plus, Pencil, Trash2, ArrowRight } from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'

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
  const toast = useToastStore()
  
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
      toast.success('Profile updated', 'Your account details have been saved.')
      setProfilePassword('')
    } catch (err: any) {
      toast.error('Update failed', err.response?.data?.error || 'Could not update profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault()
    setUserSaving(true)
    try {
      if (editUserId) {
        const { role, email, is_active, password } = userForm
        const payload: any = { role, email, is_active }
        if (password) payload.password = password
        await api.put(`/api/users/${editUserId}`, payload)
      } else {
        await api.post('/api/users', userForm)
      }
      setShowUserForm(false)
      toast.success(editUserId ? 'User updated' : 'User created', editUserId ? 'User account has been updated.' : 'New user provisioned successfully.')
      loadUsers()
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.error || 'Could not save user.')
    } finally {
      setUserSaving(false)
    }
  }

  async function deleteUser(id: number, username: string) {
    try {
      await api.delete(`/api/users/${id}`)
      toast.success('User removed', `${username} has been deleted.`)
      loadUsers()
    } catch (err: any) {
      toast.error('Delete failed', err.response?.data?.error || 'Could not delete user.')
    }
  }

  function editUser(u: UserData) {
    setUserForm({ username: u.username, email: u.email, role: u.role, is_active: u.is_active, password: '' })
    setEditUserId(u.id)
    setShowUserForm(true)
  }

  const roleColors: Record<string, string> = {
    admin: '#ef4444',   // var(--danger)
    devops: '#4f46e5',  // var(--brand-primary)
    trainee: '#f59e0b', // var(--warning)
    intern: '#3b82f6'   // var(--info)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }} className="page">
      {/* Fixed top: title + tab switcher */}
      <div style={{ flexShrink: 0 }}>
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle hidden-mobile">Manage your account and platform preferences</p>
          </div>
        </div>

        <div className="tabs-container" style={{ 
          display: 'flex', gap: 0, marginBottom: 32, borderBottom: '1px solid var(--border)', width: '100%'
        }}>
          <button
            onClick={() => setActiveTab('profile')}
            style={{
              padding: '12px 24px', fontSize: 10, fontWeight: 900,
              transition: 'all 0.2s', cursor: 'pointer', border: 'none',
              background: 'transparent', textTransform: 'uppercase', letterSpacing: '0.1em',
              display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)',
              position: 'relative',
              color: activeTab === 'profile' ? 'var(--brand-primary)' : 'var(--text-muted)'
            }}
          >
            <User size={13} /> MY ACCOUNT
            {activeTab === 'profile' && <div style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'var(--brand-primary)' }} />}
          </button>

          {can('manage-users') && (
            <button
              onClick={() => setActiveTab('users')}
              style={{
                padding: '12px 24px', fontSize: 10, fontWeight: 900,
                transition: 'all 0.2s', cursor: 'pointer', border: 'none',
                background: 'transparent', textTransform: 'uppercase', letterSpacing: '0.1em',
                display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
                position: 'relative',
                color: activeTab === 'users' ? 'var(--brand-primary)' : 'var(--text-muted)'
              }}
            >
              <Shield size={13} /> USER MANAGEMENT
              {activeTab === 'users' && <div style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'var(--brand-primary)' }} />}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable tab content */}
      <div className="fade-up" style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
        {activeTab === 'profile' && (
          <div className="grid-2-col" style={{ gap: 24, alignItems: 'start' }}>
            <div className="card" style={{ padding: '32px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
               <div style={{ 
                 width: 64, height: 64, background: 'var(--bg-elevated)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, color: 'var(--brand-primary)',
                 marginBottom: 20, textTransform: 'uppercase', border: '1px solid var(--border)', borderTop: '4px solid var(--brand-primary)'
               }}>
                 {currentUser?.username.charAt(0)}
               </div>
               <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{currentUser?.username}</h2>
               <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Tier {currentUser?.id} Platform Member</p>
               <div style={{ width: '100%', paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Security Role</span>
                     <span className="badge" style={{ background: `${roleColors[currentUser?.role || 'intern']}15`, color: roleColors[currentUser?.role || 'intern'], border: `1px solid ${roleColors[currentUser?.role || 'intern']}25`, padding: '4px 8px', fontSize: 10 }}>{currentUser?.role.toUpperCase()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                         <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 6px var(--success)' }} /> Authorized
                      </span>
                  </div>
               </div>
            </div>

            <div className="card" style={{ padding: '32px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><User size={20} color="var(--brand-primary)" /></div>
                <div><h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Personal Information</h2><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Update contact email and security credentials</p></div>
              </div>
              <form onSubmit={updateProfile}>
                <div className="grid-2-col" style={{ gap: 20, marginBottom: 32 }}>
                  <div className="input-group"><label className="input-label">Username</label><input className="input" value={currentUser?.username} disabled style={{ opacity: 0.6, background: 'var(--bg-elevated)' }} /></div>
                  <div className="input-group"><label className="input-label">Public Email Address</label><div style={{ position: 'relative' }}><Mail size={16} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-muted)' }} /><input className="input" style={{ paddingLeft: 42 }} value={profileEmail} onChange={e => setProfileEmail(e.target.value)} placeholder="you@example.com" /></div></div>
                </div>
                <div className="danger-zone" style={{ marginTop: 0, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}><Lock size={18} color="var(--text-muted)" /><h3 style={{ fontSize: 14, fontWeight: 700 }}>Security Rotation</h3></div>
                   <div className="input-group"><label className="input-label">New Password</label><div style={{ position: 'relative' }}><Lock size={16} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-muted)' }} /><input className="input" type="password" style={{ paddingLeft: 42 }} value={profilePassword} onChange={e => setProfilePassword(e.target.value)} placeholder="Keep current or enter new" minLength={6} /></div><p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>Rotate password regularly to ensure platform safety.</p></div>
                </div>
                <div style={{ marginTop: 32, paddingTop: 32, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" disabled={profileSaving} style={{ width: '100%', maxWidth: 200, height: 44, fontSize: 14, fontWeight: 700 }}>{profileSaving ? 'Saving...' : 'Save Settings'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'users' && can('manage-users') && (
          <div className="fade-in">
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '24px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Shield size={22} color="var(--brand-primary)" /></div>
                  <div><h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Access Control</h2><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Manage administrative users</p></div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => { setShowUserForm(true); setEditUserId(null); setUserForm(emptyUserForm) }}><Plus size={16} /> <span className="hidden-mobile">Add User</span><span className="show-mobile-only">Add</span></button>
              </div>
              <div className="table-container" style={{ border: 'none' }}>
                <table className="k-table">
                  <thead>
                    <tr>
                      {['User', 'Role', 'Status', 'Actions'].map(h => (<th key={h}>{h}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: '60px' }}><div className="spinner" style={{ margin: '0 auto' }}></div></td></tr>
                    ) : users.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: '80px', color: 'var(--text-muted)' }}>No users registered.</td></tr>
                    ) : users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 28, height: 28, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: 'var(--brand-primary)', fontSize: 10 }}>{u.username.charAt(0).toUpperCase()}</div>
                            <div>
                              <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: 12, textTransform: 'uppercase' }}>{u.username}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{u.email || 'SYSTEM@INFRAEYE.LOCAL'}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>{u.role.toUpperCase()}</span></td>
                        <td>{u.is_active ? <span className="badge badge-online">ACTIVE</span> : <span className="badge badge-offline">INACTIVE</span>}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn-icon-sm" onClick={() => editUser(u)}><Pencil size={12} /></button>
                            {currentUser?.id !== u.id && (<button className="btn-icon-sm" style={{ color: 'var(--danger)' }} onClick={() => deleteUser(u.id, u.username)}><Trash2 size={12} /></button>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>{/* end scrollable content */}

      {showUserForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'var(--glass-bg)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card fade-up" style={{ width: '100%', maxWidth: 460, padding: '24px 20px', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}><div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={20} color="var(--brand-primary)" /></div><h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{editUserId ? 'Update User' : 'Provision User'}</h2></div>
            <form onSubmit={saveUser}>
              <div className="input-group"><label className="input-label">Username</label><input className="input" required value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} disabled={!!editUserId} placeholder="e.g. jdoe" /></div>
              <div className="input-group"><label className="input-label">Email</label><input className="input" type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} placeholder="user@infraeye.local" /></div>
              <div className="input-group"><label className="input-label">{editUserId ? 'New Password (Optional)' : 'Password'}</label><input className="input" type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required={!editUserId} minLength={6} placeholder="Enter password" /></div>
              <div className="input-group"><label className="input-label">Role</label><div style={{ position: 'relative' }}><select className="input" value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})} style={{ WebkitAppearance: 'none', appearance: 'none' }}><option value="intern">Intern tier</option><option value="trainee">Trainee tier</option><option value="devops">DevOps tier</option><option value="admin">Administrator tier</option></select><ArrowRight size={14} style={{ position: 'absolute', right: 14, top: 14, transform: 'rotate(90deg)', color: 'var(--text-muted)' }} /></div></div>
              {!!editUserId && (<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '12px', background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border)' }}><input type="checkbox" id="activeCheckbox" checked={userForm.is_active} onChange={e => setUserForm({...userForm, is_active: e.target.checked})} /><label htmlFor="activeCheckbox" style={{ fontSize: 13, fontWeight: 700, marginBottom: 0 }}>Authorization Active</label></div>)}
              <div style={{ display: 'flex', gap: 12, marginTop: 28 }}><button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowUserForm(false)}>Cancel</button><button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={userSaving}>{userSaving ? 'Saving...' : 'Confirm'}</button></div>
            </form>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { border: 2px solid var(--border); border-top-color: var(--brand-primary); border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
