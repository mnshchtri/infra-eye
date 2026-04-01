import React, { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'

interface AddClusterModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function AddClusterModal({ onClose, onSuccess }: AddClusterModalProps) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', host: '', ssh_user: 'root', ssh_password: '', kube_config: '' })
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null)

  const testConnection = async () => {
    if (!form.host || !form.kube_config) {
      useToastStore.getState().error('Missing fields', 'Host and KubeConfig are required for testing')
      return
    }
    setLoading(true)
    setTestResult(null)
    try {
      const res = await api.post('/api/servers/test-k8s', { ...form, auth_type: 'password' })
      setTestResult({ success: res.data.success, msg: res.data.output || 'Connected successfully' })
    } catch (e: any) {
      setTestResult({ success: false, msg: e.response?.data?.error || 'Connection failed' })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/api/servers', { ...form, auth_type: 'password', tags: 'kubernetes', is_k8s: true }) 
      onSuccess()
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1100, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
       <div className="card fade-up" style={{ width: 500, padding: 32, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
             <h2 style={{ fontSize: 20, fontWeight: 700 }}>Connect New Cluster</h2>
             <button onClick={onClose}><X size={20} color="var(--text-muted)" /></button>
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
             <div className="input-group">
                <label className="input-label">Friendly Name</label>
                <input className="input" placeholder="e.g. Production Cluster" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">SSH Proxy Host (Target Node)</label>
                <input className="input" placeholder="IP Address" value={form.host} onChange={e => setForm({...form, host: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">SSH Username</label>
                <input className="input" placeholder="e.g. root or ubuntu" value={form.ssh_user} onChange={e => setForm({...form, ssh_user: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">SSH Password (for Cluster Sync)</label>
                <input className="input" type="password" placeholder="••••••••" value={form.ssh_password} onChange={e => setForm({...form, ssh_password: e.target.value})} required />
             </div>
             <div className="input-group">
                <label className="input-label">KubeConfig RAW (Persistent)</label>
                <textarea 
                  className="input" 
                  style={{ height: 160, fontFamily: 'monospace', fontSize: 12 }} 
                  placeholder="Paste contents of sudo k3s kubectl config view --raw"
                  value={form.kube_config}
                  onChange={e => setForm({...form, kube_config: e.target.value})}
                  required
                />
             </div>
             
             {testResult && (
                <div style={{ padding: '8px 12px', border: `1px solid ${testResult.success ? 'var(--success)' : 'var(--danger)'}`, borderRadius: 8, background: testResult.success ? 'var(--success-glow)' : 'var(--danger-glow)', fontSize: 12, color: testResult.success ? 'var(--success)' : 'var(--danger)' }}>
                   {testResult.msg}
                </div>
             )}

             <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={testConnection} disabled={loading}>
                   {loading ? 'Testing...' : 'Test Connection'}
                </button>
                <button className="btn btn-primary" type="submit" disabled={loading} style={{ flex: 1.5 }}>
                   {loading ? 'Wait...' : 'Add Cluster'}
                </button>
             </div>
          </form>
       </div>
    </div>
  )
}
