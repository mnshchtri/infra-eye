import React, { useState } from 'react'
import { X, ExternalLink, Globe, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'

interface PortForwardSession {
  id: string
  target: string
  namespace: string
  local_port: number
  remote_port: number
  pid: string
  created_at: string
}

interface PortForwardModalProps {
  serverID: number;
  sessions: PortForwardSession[];
  onClose: () => void;
  onRefresh: () => void;
  initialNamespace?: string;
  initialTarget?: string;
  initialPort?: string;
}

export function PortForwardModal({ serverID, sessions, onClose, onRefresh, initialNamespace, initialTarget, initialPort }: PortForwardModalProps) {
  const toast = useToastStore()
  const [form, setForm] = useState({ 
    namespace: initialNamespace || 'default', 
    target: initialTarget || '', 
    local_port: initialPort || '', 
    remote_port: initialPort || '' 
  })
  const [busy, setBusy] = useState(false)

  const createPortForward = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post(`/api/servers/${serverID}/kubectl/port-forward`, {
        namespace: form.namespace,
        target: form.target,
        local_port: Number(form.local_port),
        remote_port: Number(form.remote_port)
      })
      toast.success('Port forward started', `${form.target} ${form.local_port}:${form.remote_port}`)
      
      // Auto-open URL in new tab
      const url = getForwardUrl(Number(form.local_port));
      window.open(url, '_blank');

      setForm((prev: any) => ({ ...prev, target: '', local_port: '', remote_port: '' }))
      onRefresh()
    } catch (e: any) {
      toast.error('Port-forward failed', e.response?.data?.error || 'Unable to start port-forward')
    } finally {
      setBusy(false)
    }
  }


  const stopPortForward = async (id: string) => {
    try {
      await api.delete(`/api/servers/${serverID}/kubectl/port-forward/${id}`)
      toast.success('Port forward stopped', `Session ${id} terminated`)
      onRefresh()
    } catch (e: any) {
      toast.error('Stop failed', e.response?.data?.error || 'Unable to stop port-forward')
    }
  }

  const getForwardUrl = (port: number) => {
    const host = window.location.hostname;
    return `http://${host}:${port}`;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(8px)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card fade-up" style={{ width: 800, maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column', borderRadius: 16, border: '1px solid var(--border-bright)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
        
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Globe size={18} color="var(--brand-primary)" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Port Forward Manager</h3>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Temporary Network Tunnels</span>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
          <form onSubmit={createPortForward} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 100px 100px auto', gap: 12, marginBottom: 24, background: 'var(--bg-app)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Namespace</label>
              <input className="input" placeholder="default" value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} required />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target Resource</label>
              <input className="input" placeholder="svc/my-service or pod/my-pod" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Local</label>
              <input className="input" placeholder="8080" value={form.local_port} onChange={(e) => setForm({ ...form, local_port: e.target.value })} required />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Remote</label>
              <input className="input" placeholder="80" value={form.remote_port} onChange={(e) => setForm({ ...form, remote_port: e.target.value })} required />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" style={{ height: 42, padding: '0 20px' }} disabled={busy}>
                {busy ? 'Starting...' : 'Start Forward'}
              </button>
            </div>
          </form>

          <div style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <table className="k-table">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th>Target</th><th>Namespace</th><th>Port Mapping</th><th>PID</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
                      <Globe size={32} strokeWidth={1} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>No active port forwards for this cluster</span>
                    </div>
                  </td></tr>
                ) : sessions.map((s: PortForwardSession) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 700 }}>{s.target}</td>
                    <td style={{ opacity: 0.8 }}>{s.namespace}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--brand-primary)' }}>
                      {s.local_port} <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>→</span> {s.remote_port}
                    </td>
                    <td><code style={{ fontSize: 11, background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4 }}>{s.pid}</code></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase' }}>Active</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <a 
                          href={getForwardUrl(s.local_port)} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="btn-icon" 
                          style={{ width: 28, height: 28, background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)20' }}
                          title="Open in Browser"
                        >
                          <ExternalLink size={14} color="var(--brand-primary)" />
                        </a>
                        <button 
                          className="btn-icon" 
                          style={{ width: 28, height: 28, background: 'var(--danger)10', border: '1px solid var(--danger)20' }}
                          onClick={() => stopPortForward(s.id)}
                          title="Stop Session"
                        >
                          <Trash2 size={14} color="var(--danger)" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: '12px 24px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '0 24px' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

