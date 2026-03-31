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
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your account and platform preferences</p>
        </div>
      </div>

      {/* Top Segmented Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: 8, 
        marginBottom: 40, 
        padding: 6, 
        background: 'var(--bg-elevated)', 
        borderRadius: 16, 
        width: 'fit-content',
        border: '1px solid var(--border)'
      }}>
        <button
          onClick={() => setActiveTab('profile')}
          style={{
            padding: '10px 24px', borderRadius: 12, fontSize: 13, fontWeight: 700,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', cursor: 'pointer', border: 'none',
            display: 'flex', alignItems: 'center', gap: 8,
            ...(activeTab === 'profile'
              ? { background: 'var(--bg-card)', color: 'var(--brand-primary)', boxShadow: 'var(--shadow-md)' }
              : { background: 'transparent', color: 'var(--text-muted)' }
            ),
          }}
        >
          <User size={16} /> My Account
        </button>

        {can('manage-users') && (
          <button
            onClick={() => setActiveTab('users')}
            style={{
              padding: '10px 24px', borderRadius: 12, fontSize: 13, fontWeight: 700,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', cursor: 'pointer', border: 'none',
              display: 'flex', alignItems: 'center', gap: 8,
              ...(activeTab === 'users'
                ? { background: 'var(--bg-card)', color: 'var(--brand-primary)', boxShadow: 'var(--shadow-md)' }
                : { background: 'transparent', color: 'var(--text-muted)' }
              ),
            }}
          >
            <Shield size={16} /> User Management
          </button>
        )}
      </div>

      <div className="fade-up">
        {activeTab === 'profile' && (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 32, alignItems: 'start' }}>
            {/* Left: Identity Card */}
            <div className="card shadow-md" style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
               <div style={{ 
                 width: 100, height: 100, borderRadius: '32px', 
                 background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-light))',
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 fontSize: 36, fontWeight: 900, color: 'var(--text-inverse)',
                 boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.4)',
                 marginBottom: 24, textTransform: 'uppercase'
               }}>
                 {currentUser?.username.charAt(0)}
               </div>
               
               <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{currentUser?.username}</h2>
               <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Tier {currentUser?.id} Platform Member</p>
               
               <div style={{ width: '100%', paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Security Role</span>
                     <span className="badge" style={{ 
                        background: `${roleColors[currentUser?.role || 'intern']}15`, 
                        color: roleColors[currentUser?.role || 'intern'], 
                        border: `1px solid ${roleColors[currentUser?.role || 'intern']}25`,
                        padding: '4px 10px'
                      }}>
                        {currentUser?.role.toUpperCase()}
                      </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                         <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 6px var(--success)' }} />
                         Authorized
                      </span>
                  </div>
               </div>
            </div>

            {/* Right: Detailed Settings */}
            <div className="card shadow-md" style={{ padding: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 40 }}>
                <div style={{ 
                  width: 44, height: 44, borderRadius: 12, 
                  background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <User size={20} color="var(--brand-primary)" />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Personal Information</h2>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Update your contact email and security credentials</p>
                </div>
              </div>
              
              <form onSubmit={updateProfile}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
                  <div className="input-group">
                    <label className="input-label">Username</label>
                    <input className="input" value={currentUser?.username} disabled style={{ opacity: 0.6, background: 'var(--bg-elevated)' }} />
                  </div>
                  
                  <div className="input-group">
                    <label className="input-label">Public Email Address</label>
                    <div style={{ position: 'relative' }}>
                      <Mail size={16} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-muted)' }} />
                      <input className="input" style={{ paddingLeft: 42 }} value={profileEmail} onChange={e => setProfileEmail(e.target.value)} placeholder="you@example.com" />
                    </div>
                  </div>
                </div>

                <div className="danger-zone" style={{ marginTop: 0, paddingTop: 32, borderTop: '1px solid var(--border)' }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                      <Lock size={18} color="var(--text-muted)" />
                      <h3 style={{ fontSize: 15, fontWeight: 700 }}>Security Rotation</h3>
                   </div>
                   
                   <div className="input-group">
                     <label className="input-label">New Account Password</label>
                     <div style={{ position: 'relative' }}>
                       <Lock size={16} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-muted)' }} />
                       <input className="input" type="password" style={{ paddingLeft: 42 }} value={profilePassword} onChange={e => setProfilePassword(e.target.value)} placeholder="Keep current or enter new" minLength={6} />
                     </div>
                     <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>Rotate your password regularly to ensure platform safety. Minimum 6 characters required.</p>
                   </div>
                </div>

                <div style={{ marginTop: 48, paddingTop: 32, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" disabled={profileSaving} style={{ padding: '0 32px', height: 48, fontSize: 14, fontWeight: 700 }}>
                    {profileSaving ? 'Propagating Changes...' : 'Save Settings'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'users' && can('manage-users') && (
          <div className="fade-in">
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ 
                    width: 44, height: 44, borderRadius: 12, 
                    background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Shield size={22} color="var(--brand-primary)" />
                  </div>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Access Control</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Manage administrative users and platform permissions</p>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => { setShowUserForm(true); setEditUserId(null); setUserForm(emptyUserForm) }} style={{ height: 40, padding: '0 20px' }}>
                  <Plus size={16} /> Add User
                </button>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                    {['User Information', 'Role', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '14px 32px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '80px' }}>
                        <div className="spinner" style={{ margin: '0 auto' }}></div>
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '80px', color: 'var(--text-muted)' }}>No platform users registered.</td>
                    </tr>
                  ) : users.map((u, i) => (
                    <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background 0.2s' }}>
                      <td style={{ padding: '20px 32px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <div style={{ 
                            width: 38, height: 38, borderRadius: 10, background: 'var(--bg-app)', 
                            border: '1px solid var(--border)', display: 'flex', alignItems: 'center', 
                            justifyContent: 'center', fontWeight: 800, color: 'var(--brand-primary)', fontSize: 14 
                          }}>
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{u.username}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{u.email || 'System user'}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '20px 32px' }}>
                        <span className="badge" style={{ background: `${roleColors[u.role] || '#94a3b8'}15`, color: roleColors[u.role] || '#94a3b8', border: `1px solid ${roleColors[u.role] || '#94a3b8'}25` }}>
                          {u.role.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '20px 32px' }}>
                        {u.is_active 
                          ? <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 6px var(--success)' }} /> Active
                            </span>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /> Inactive
                            </span>
                        }
                      </td>
                      <td style={{ padding: '20px 32px' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button style={{ 
                            padding: '8px 12px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', 
                            color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                            boxShadow: 'var(--shadow-sm)', transition: 'all 0.2s' 
                          }} onClick={() => editUser(u)} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand-primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                            <Pencil size={15} />
                          </button>
                          {currentUser?.id !== u.id && (
                            <button style={{ 
                              padding: '8px 12px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--danger)40', 
                              color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                              boxShadow: 'var(--shadow-sm)', transition: 'all 0.2s' 
                            }} onClick={() => deleteUser(u.id, u.username)} onMouseEnter={e => e.currentTarget.style.background = 'var(--danger)10'} onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--danger)40' }}>
                              <Trash2 size={15} />
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
      </div>

      {/* User Form Modal */}
      {showUserForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'var(--glass-bg)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="card fade-up" style={{ width: '100%', maxWidth: 460, padding: 32, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
              <div style={{ 
                width: 40, height: 40, borderRadius: 10, 
                background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Plus size={20} color="var(--brand-primary)" />
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{editUserId ? 'Update User' : 'Provision User'}</h2>
            </div>

            <form onSubmit={saveUser}>
              <div className="input-group">
                <label className="input-label">User Identifier</label>
                <input className="input" required value={userForm.username} onChange={e => setUserForm({...userForm, username: e.target.value})} disabled={!!editUserId} placeholder="e.g. jdoe" />
              </div>
              <div className="input-group">
                <label className="input-label">Email Context</label>
                <input className="input" type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} placeholder="user@infraeye.local" />
              </div>
              <div className="input-group">
                <label className="input-label">{editUserId ? 'Rotate Password (Optional)' : 'Security Credential'}</label>
                <input className="input" type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} required={!editUserId} minLength={6} placeholder="••••••••" />
              </div>
              <div className="input-group">
                <label className="input-label">Permission Tier</label>
                <div style={{ position: 'relative' }}>
                  <select className="input" value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})} style={{ WebkitAppearance: 'none', appearance: 'none', cursor: 'pointer' }}>
                    <option value="intern">Intern tier</option>
                    <option value="trainee">Trainee tier</option>
                    <option value="devops">DevOps tier</option>
                    <option value="admin">Administrator tier</option>
                  </select>
                  <ArrowRight size={14} style={{ position: 'absolute', right: 14, top: 14, transform: 'rotate(90deg)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                </div>
              </div>
              {!!editUserId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '14px', background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <input type="checkbox" id="activeCheckbox" checked={userForm.is_active} onChange={e => setUserForm({...userForm, is_active: e.target.checked})} style={{ width: 18, height: 18, cursor: 'pointer' }} />
                  <label htmlFor="activeCheckbox" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer', marginBottom: 0 }}>Authorization Active</label>
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 40 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1, height: 44 }} onClick={() => setShowUserForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, height: 44 }} disabled={userSaving}>{userSaving ? 'Saving...' : 'Confirm Action'}</button>
              </div>
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
