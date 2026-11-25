import { useState, useEffect } from 'react'
import { User, Shield, Mail, Lock, Plus, Pencil, Trash2, Bell, Send, Eye, EyeOff } from 'lucide-react'
import {
  Alert, Avatar, Box, Card, Checkbox, Chip, CircularProgress, FormControlLabel, IconButton, InputAdornment,
  MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import type { IconComponent } from '../types/k8s'
import { Button, Modal, PageHeader, TabSwitcher, EmptyState } from '../components/ui'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { usePermission } from '../hooks/usePermission'
import { useToastStore } from '../store/toastStore'
import { apiError } from '../utils/errors'

interface UserData {
  id: number
  username: string
  role: string
  email: string
  is_active: boolean
}

function ApiKeyField({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  const [show, setShow] = useState(false)
  return (
    <TextField
      label={label} fullWidth value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      type={show ? 'text' : 'password'} helperText={hint} autoComplete="off"
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton edge="end" onClick={() => setShow(s => !s)} aria-label={show ? `Hide ${label}` : `Show ${label}`}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}

function PanelHeader({ icon: Icon, title, subtitle }: { icon: IconComponent; title: string; subtitle: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
      <Box sx={{ width: 40, height: 40, borderRadius: 1, display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: 'action.selected', color: 'primary.main' }}>
        <Icon size={20} />
      </Box>
      <Box>
        <Typography variant="h6" component="h2">{title}</Typography>
        <Typography variant="body1" color="text.secondary">{subtitle}</Typography>
      </Box>
    </Box>
  )
}

export function Settings() {
  const { user: currentUser } = useAuthStore()
  const { can } = usePermission()
  const toast = useToastStore()
  
  const [activeTab, setActiveTab] = useState<'profile' | 'users' | 'ai' | 'notifications'>('profile')
  const [users, setUsers] = useState<UserData[]>([])
  const [loading, setLoading] = useState(false)

  // Profile form state
  const [profileEmail, setProfileEmail] = useState(currentUser?.email || '')
  const [profilePassword, setProfilePassword] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)

  // AI Configuration state
  const [openRouterKey, setOpenRouterKey] = useState(currentUser?.open_router_key || '')
  const [deepSeekKey, setDeepSeekKey] = useState(currentUser?.deep_seek_key || '')
  const [claudeKey, setClaudeKey] = useState(currentUser?.claude_key || '')
  const [geminiKey, setGeminiKey] = useState(currentUser?.gemini_key || '')
  const [mistralKey, setMistralKey] = useState(currentUser?.mistral_key || '')
  const [localLLMURL, setLocalLLMURL] = useState(currentUser?.local_llm_url || '')
  const [localLLMModel, setLocalLLMModel] = useState(currentUser?.local_llm_model || '')

  // Notification webhook state (admin only)
  const [gchatUrl, setGchatUrl] = useState('')
  const [slackUrl, setSlackUrl] = useState('')
  const [gchatEnvSet, setGchatEnvSet] = useState(false)
  const [slackEnvSet, setSlackEnvSet] = useState(false)
  const [notifLoaded, setNotifLoaded] = useState(false)
  const [notifSaving, setNotifSaving] = useState(false)
  const [testingChannel, setTestingChannel] = useState<'google_chat' | 'slack' | null>(null)

  // User management form state
  const [showUserForm, setShowUserForm] = useState(false)
  const emptyUserForm = { username: '', password: '', role: 'intern', email: '', is_active: true }
  const [userForm, setUserForm] = useState(emptyUserForm)
  const [editUserId, setEditUserId] = useState<number | null>(null)
  const [userSaving, setUserSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null)

  useEffect(() => {
    if (activeTab === 'users' && can('manage-users')) {
      loadUsers()
    }
    if (activeTab === 'notifications' && can('manage-users') && !notifLoaded) {
      loadNotificationSettings()
    }
  }, [activeTab, can])

  async function loadNotificationSettings() {
    try {
      const res = await api.get('/api/settings/notifications')
      setGchatUrl(res.data?.google_chat_webhook_url || '')
      setSlackUrl(res.data?.slack_webhook_url || '')
      setGchatEnvSet(res.data?.google_chat_env_set === true)
      setSlackEnvSet(res.data?.slack_env_set === true)
      setNotifLoaded(true)
    } catch (err: unknown) {
      toast.error('Load failed', apiError(err) || 'Could not load notification settings.')
    }
  }

  async function saveNotificationSettings(e: React.FormEvent) {
    e.preventDefault()
    setNotifSaving(true)
    try {
      await api.put('/api/settings/notifications', {
        google_chat_webhook_url: gchatUrl.trim(),
        slack_webhook_url: slackUrl.trim(),
      })
      toast.success('Notifications updated', 'Alert rules will use the new webhook configuration.')
    } catch (err: unknown) {
      toast.error('Save failed', apiError(err) || 'Could not save webhook settings.')
    } finally {
      setNotifSaving(false)
    }
  }

  async function testWebhook(channel: 'google_chat' | 'slack') {
    setTestingChannel(channel)
    try {
      const url = channel === 'google_chat' ? gchatUrl.trim() : slackUrl.trim()
      const res = await api.post('/api/settings/notifications/test', { channel, url })
      toast.success('Test sent', res.data?.message || 'Check the chat space for the test message.')
    } catch (err: unknown) {
      toast.error('Test failed', apiError(err) || 'The webhook did not accept the test message.')
    } finally {
      setTestingChannel(null)
    }
  }

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
      const payload: Record<string, unknown> = {}
      if (profileEmail) payload.email = profileEmail
      if (profilePassword) payload.password = profilePassword
      
      // Include AI keys in the update
      payload.open_router_key = openRouterKey
      payload.deep_seek_key = deepSeekKey
      payload.claude_key = claudeKey
      payload.gemini_key = geminiKey
      payload.mistral_key = mistralKey
      payload.local_llm_url = localLLMURL
      payload.local_llm_model = localLLMModel

      const res = await api.put('/api/auth/me', payload)
      useAuthStore.getState().setAuth(useAuthStore.getState().token!, res.data)
      toast.success('Settings updated', 'Your personal parameters and AI credentials have been synchronized.')
      setProfilePassword('')
    } catch (err: unknown) {
      toast.error('Update failed', apiError(err) || 'Could not update settings.')
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
        const payload: Record<string, unknown> = { role, email, is_active }
        if (password) payload.password = password
        await api.put(`/api/users/${editUserId}`, payload)
      } else {
        await api.post('/api/users', userForm)
      }
      setShowUserForm(false)
      toast.success(editUserId ? 'User updated' : 'User created', editUserId ? 'User account has been updated.' : 'New user provisioned successfully.')
      loadUsers()
    } catch (err: unknown) {
      toast.error('Save failed', apiError(err) || 'Could not save user.')
    } finally {
      setUserSaving(false)
    }
  }

  async function deleteUser(id: number, username: string) {
    try {
      await api.delete(`/api/users/${id}`)
      toast.success('User removed', `${username} has been deleted.`)
      setDeleteTarget(null)
      loadUsers()
    } catch (err: unknown) {
      toast.error('Delete failed', apiError(err) || 'Could not delete user.')
      setDeleteTarget(null)
    }
  }

  function editUser(u: UserData) {
    setUserForm({ username: u.username, email: u.email, role: u.role, is_active: u.is_active, password: '' })
    setEditUserId(u.id)
    setShowUserForm(true)
  }

  const roleChip = (role: string) => (
    <Chip label={role.charAt(0).toUpperCase() + role.slice(1)} size="small"
      color={role === 'admin' ? 'error' : role === 'devops' ? 'primary' : role === 'trainee' ? 'warning' : 'info'} />
  )
  const two = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2.5 } as const
  const tabs = [
    { id: 'profile', label: 'My account', icon: User },
    { id: 'ai', label: 'AI credentials', icon: Lock },
    ...(can('manage-users') ? [{ id: 'notifications', label: 'Notifications', icon: Bell }, { id: 'users', label: 'User management', icon: Shield }] : []),
  ]

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Manage your account and platform preferences" />

      <Box sx={{ mb: 3 }}>
        <TabSwitcher tabs={tabs} active={activeTab} onChange={id => setActiveTab(id as typeof activeTab)} />
      </Box>

      {activeTab === 'profile' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '320px 1fr' }, gap: 3, alignItems: 'start' }}>
          <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Avatar sx={{ width: 64, height: 64, fontSize: 26, fontWeight: 700, bgcolor: 'primary.main', mb: 2 }}>
              {currentUser?.username.charAt(0).toUpperCase()}
            </Avatar>
            <Typography variant="h5" component="h2">{currentUser?.username}</Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2.5 }}>Tier {currentUser?.id} platform member</Typography>
            <Box sx={{ width: '100%', pt: 2.5, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">Security role</Typography>
                {roleChip(currentUser?.role || 'intern')}
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">Status</Typography>
                <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main' }} /> Authorized
                </Typography>
              </Box>
            </Box>
          </Card>

          <Card sx={{ p: 3 }}>
            <PanelHeader icon={User} title="Personal information" subtitle="Update contact email and security credentials" />
            <Box component="form" onSubmit={updateProfile}>
              <Box sx={{ ...two, mb: 3 }}>
                <TextField label="Username" value={currentUser?.username ?? ''} disabled fullWidth />
                <TextField
                  label="Public email address" type="email" fullWidth value={profileEmail} onChange={e => setProfileEmail(e.target.value)}
                  placeholder="you@example.com"
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><Mail size={16} /></InputAdornment> } }}
                />
              </Box>
              <Box sx={{ pt: 3, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ mb: 2 }}>Security rotation</Typography>
                <TextField
                  label="New password" type="password" fullWidth value={profilePassword} onChange={e => setProfilePassword(e.target.value)}
                  placeholder="Keep current or enter new" autoComplete="new-password"
                  helperText="Rotate password regularly to ensure platform safety."
                  slotProps={{ htmlInput: { minLength: 6 }, input: { startAdornment: <InputAdornment position="start"><Lock size={16} /></InputAdornment> } }}
                />
              </Box>
              <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit" loading={profileSaving}>Save settings</Button>
              </Box>
            </Box>
          </Card>
        </Box>
      )}

      {activeTab === 'ai' && (
        <Card sx={{ p: 3, maxWidth: 800 }}>
          <PanelHeader icon={Lock} title="Personal AI infrastructure" subtitle="Configure individual API keys to power your Netra AI interactions." />
          <Box component="form" onSubmit={updateProfile} sx={{ display: 'grid', gap: 3 }}>
            <ApiKeyField label="OpenRouter API key" value={openRouterKey} onChange={setOpenRouterKey} placeholder="sk-or-v1-..." hint="Used as primary fallback for most models." />
            <Box sx={two}>
              <ApiKeyField label="DeepSeek API key" value={deepSeekKey} onChange={setDeepSeekKey} placeholder="sk-..." />
              <ApiKeyField label="Anthropic (Claude) API key" value={claudeKey} onChange={setClaudeKey} placeholder="sk-ant-..." />
            </Box>
            <Box sx={two}>
              <ApiKeyField label="Google (Gemini) API key" value={geminiKey} onChange={setGeminiKey} placeholder="AIza..." />
              <ApiKeyField label="Mistral API key" value={mistralKey} onChange={setMistralKey} placeholder="sk-..." />
            </Box>

            <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle1">Local LLM</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Point Netra at a self-hosted, OpenAI-compatible endpoint — Ollama, LM Studio, llama.cpp server, or vLLM. No API key needed; runs entirely on infrastructure you control.
              </Typography>
              <Box sx={two}>
                <TextField label="Endpoint URL" value={localLLMURL} onChange={e => setLocalLLMURL(e.target.value)} placeholder="http://localhost:11434" />
                <TextField label="Model name" value={localLLMModel} onChange={e => setLocalLLMModel(e.target.value)} placeholder="llama3.2" />
              </Box>
            </Box>

            <Box sx={{ pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" loading={profileSaving}>Sync AI keys</Button>
            </Box>
          </Box>
        </Card>
      )}

      {activeTab === 'notifications' && can('manage-users') && (
        <Card sx={{ p: 3, maxWidth: 800 }}>
          <PanelHeader icon={Bell} title="Alert notifications" subtitle="Where alert rules and self-healing events send notifications. Applies platform-wide." />
          <Box component="form" onSubmit={saveNotificationSettings}>
            <Box sx={{ display: 'grid', gap: 3.5 }}>
              <Box>
                <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
                  <TextField
                    label="Google Chat webhook URL" value={gchatUrl} onChange={e => setGchatUrl(e.target.value)}
                    placeholder="https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…"
                    sx={{ flex: '1 1 240px' }} slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'var(--font-mono)', fontSize: 13 } } }}
                  />
                  <Button type="button" variant="secondary" icon={<Send size={14} />} loading={testingChannel === 'google_chat'}
                    disabled={testingChannel !== null || (!gchatUrl.trim() && !gchatEnvSet)} onClick={() => testWebhook('google_chat')}
                    title="Send a test message to this webhook" style={{ height: 40 }}>
                    Test
                  </Button>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  In Google Chat: open the space → space name → <strong>Apps &amp; integrations</strong> → <strong>Webhooks</strong> → add one and paste its URL here. Must be an https URL on <code style={{ fontFamily: 'var(--font-mono)' }}>chat.googleapis.com</code>.
                </Typography>
                {gchatEnvSet && !gchatUrl.trim() && (
                  <Alert severity="warning" sx={{ mt: 1 }}>Currently using the URL from the GOOGLE_CHAT_WEBHOOK_URL environment variable — saving a value here overrides it.</Alert>
                )}
              </Box>

              <Box>
                <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
                  <TextField
                    label="Slack webhook URL (optional)" value={slackUrl} onChange={e => setSlackUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/T…/B…/…"
                    sx={{ flex: '1 1 240px' }} slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'var(--font-mono)', fontSize: 13 } } }}
                  />
                  <Button type="button" variant="secondary" icon={<Send size={14} />} loading={testingChannel === 'slack'}
                    disabled={testingChannel !== null || (!slackUrl.trim() && !slackEnvSet)} onClick={() => testWebhook('slack')}
                    title="Send a test message to this webhook" style={{ height: 40 }}>
                    Test
                  </Button>
                </Box>
                {slackEnvSet && !slackUrl.trim() && (
                  <Alert severity="warning" sx={{ mt: 1 }}>Currently using the URL from the SLACK_WEBHOOK_URL environment variable — saving a value here overrides it.</Alert>
                )}
              </Box>
            </Box>

            <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
                Leave a field empty and save to clear it. Webhook URLs are credentials — anyone with the URL can post to the space.
              </Typography>
              <Button type="submit" loading={notifSaving}>Save webhooks</Button>
            </Box>
          </Box>
        </Card>
      )}

      {activeTab === 'users' && can('manage-users') && (
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <Box sx={{ '& > div': { mb: 0 } }}>
              <PanelHeader icon={Shield} title="Access control" subtitle="Manage administrative users" />
            </Box>
            <Button size="sm" icon={<Plus size={16} />} onClick={() => { setShowUserForm(true); setEditUserId(null); setUserForm(emptyUserForm) }}>Add user</Button>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead><TableRow><TableCell>User</TableCell><TableCell>Role</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4} align="center" sx={{ py: 6 }}><CircularProgress size={24} /></TableCell></TableRow>
                ) : users.length === 0 ? (
                  <TableRow><TableCell colSpan={4}><EmptyState icon={User} title="No users registered." /></TableCell></TableRow>
                ) : users.map(u => (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: 'action.selected', color: 'primary.main', fontWeight: 700 }}>{u.username.charAt(0).toUpperCase()}</Avatar>
                        <Box>
                          <Typography variant="body1" sx={{ fontWeight: 600 }}>{u.username}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>{u.email || 'system@infraeye.local'}</Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>{roleChip(u.role)}</TableCell>
                    <TableCell><Chip label={u.is_active ? 'Active' : 'Inactive'} size="small" color={u.is_active ? 'success' : 'default'} variant={u.is_active ? 'filled' : 'outlined'} /></TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit"><IconButton onClick={() => editUser(u)} aria-label={`Edit ${u.username}`}><Pencil size={14} /></IconButton></Tooltip>
                      {currentUser?.id !== u.id && (
                        <Tooltip title="Delete"><IconButton color="error" onClick={() => setDeleteTarget(u)} aria-label={`Delete ${u.username}`}><Trash2 size={14} /></IconButton></Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <Modal
        isOpen={showUserForm}
        onClose={() => setShowUserForm(false)}
        size="sm"
        icon={Plus}
        title={editUserId ? 'Update user' : 'Provision user'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowUserForm(false)}>Cancel</Button>
            <Button type="submit" form="user-form" loading={userSaving}>Confirm</Button>
          </>
        }
      >
        <Box component="form" id="user-form" onSubmit={saveUser} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField label="Username" required fullWidth value={userForm.username} disabled={!!editUserId} placeholder="e.g. jdoe"
            onChange={e => setUserForm({ ...userForm, username: e.target.value })} />
          <TextField label="Email" type="email" fullWidth value={userForm.email} placeholder="user@infraeye.local"
            onChange={e => setUserForm({ ...userForm, email: e.target.value })} />
          <TextField label={editUserId ? 'New password (optional)' : 'Password'} type="password" fullWidth value={userForm.password}
            required={!editUserId} placeholder="Enter password" autoComplete="new-password" slotProps={{ htmlInput: { minLength: 6 } }}
            onChange={e => setUserForm({ ...userForm, password: e.target.value })} />
          <TextField select label="Role" fullWidth value={userForm.role} onChange={e => setUserForm({ ...userForm, role: e.target.value })}>
            <MenuItem value="intern">Intern tier</MenuItem>
            <MenuItem value="trainee">Trainee tier</MenuItem>
            <MenuItem value="devops">DevOps tier</MenuItem>
            <MenuItem value="admin">Administrator tier</MenuItem>
          </TextField>
          {!!editUserId && (
            <Paper variant="outlined" sx={{ px: 1.5 }}>
              <FormControlLabel control={<Checkbox checked={userForm.is_active} onChange={e => setUserForm({ ...userForm, is_active: e.target.checked })} />} label="Authorization active" />
            </Paper>
          )}
        </Box>
      </Modal>

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        size="sm"
        title="Delete user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteTarget && deleteUser(deleteTarget.id, deleteTarget.username)}>Delete</Button>
          </>
        }
      >
        <Typography variant="body1" color="text.secondary">
          Delete <b>{deleteTarget?.username}</b>? Their account and access grants will be removed.
        </Typography>
      </Modal>
    </div>
  )
}
