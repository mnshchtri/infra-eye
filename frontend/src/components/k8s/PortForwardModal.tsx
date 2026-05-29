import React, { useState, useEffect } from 'react'
import { X, ExternalLink, Globe, Trash2, Zap, ArrowRight, ShieldCheck } from 'lucide-react'
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
  
  // Suggested local port logic
  const getSuggestedPort = () => Math.floor(Math.random() * (9999 - 8000 + 1) + 8000).toString()

  const [form, setForm] = useState({ 
    namespace: initialNamespace || 'default', 
    target: initialTarget || '', 
    local_port: initialPort ? getSuggestedPort() : '', 
    remote_port: initialPort || '' 
  })
  const [busy, setBusy] = useState(false)

  // Polling for status updates while open
  useEffect(() => {
    const timer = setInterval(onRefresh, 5000)
    return () => clearInterval(timer)
  }, [onRefresh])

  const createPortForward = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await api.post(`/api/servers/${serverID}/kubectl/port-forward`, {
        namespace: form.namespace,
        target: form.target,
        local_port: Number(form.local_port),
        remote_port: Number(form.remote_port)
      })
      
      if (res.data.success) {
        toast.success('Port forward established', `${form.target} at ${form.local_port}`)
        
        // Auto-open URL in new tab
        const url = getForwardUrl(Number(form.local_port));
        window.open(url, '_blank');

        setForm((prev: any) => ({ ...prev, target: '', local_port: '', remote_port: '' }))
        onRefresh()
      }
    } catch (e: any) {
      toast.error('Port-forward failed', e.response?.data?.error || 'Check if the port is already in use')
    } finally {
      setBusy(false)
    }
  }

  const stopPortForward = async (id: string) => {
    try {
      await api.delete(`/api/servers/${serverID}/kubectl/port-forward/${id}`)
      toast.success('Tunnel closed', `Session ${id.slice(0, 8)}... terminated`)
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8, 10, 15, 0.7)', backdropFilter: 'blur(12px)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card fade-up" style={{ width: 850, maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, border: '1px solid var(--border-bright)', boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.7)' }}>
        
        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 0, background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Globe size={22} color="var(--brand-primary)" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>Port Forward Manager</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>Network Tunnel Protocol</span>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ fontSize: 10, color: 'var(--brand-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>{sessions.length} Active Tunnels</span>
              </div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ width: 40, height: 40 }}><X size={20} /></button>
        </div>

        <div style={{ padding: 32, flex: 1, overflowY: 'auto', background: 'var(--bg-app)' }}>
          <form onSubmit={createPortForward} style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 100px 100px auto', gap: 16, marginBottom: 32, background: 'var(--bg-card)', padding: 24, borderRadius: 0, border: '1px solid var(--border-bright)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Namespace</label>
              <input className="input" placeholder="default" value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} required style={{ height: 42, background: 'var(--bg-input)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Target Resource</label>
              <input className="input" placeholder="svc/name or pod/name" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required style={{ height: 42, background: 'var(--bg-input)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Local Port</label>
              <input className="input" placeholder="8080" value={form.local_port} onChange={(e) => setForm({ ...form, local_port: e.target.value })} required style={{ height: 42, background: 'var(--bg-input)', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Remote Port</label>
              <input className="input" placeholder="80" value={form.remote_port} onChange={(e) => setForm({ ...form, remote_port: e.target.value })} required style={{ height: 42, background: 'var(--bg-input)', fontFamily: 'var(--font-mono)' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" style={{ height: 42, padding: '0 24px', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }} disabled={busy}>
                {busy ? 'Establishing...' : 'Start Tunnel'}
              </button>
            </div>
          </form>

          <div style={{ borderRadius: 0, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-card)' }}>
            <table className="k-table">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th style={{ padding: '16px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Target Resource</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Namespace</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tunnel Mapping</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Process</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Status</th>
                  <th style={{ padding: '16px 20px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ fontSize: 13 }}>
                {sessions.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '60px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: 'var(--text-muted)' }}>
                      <Globe size={40} strokeWidth={1} opacity={0.3} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>No active port forwards</span>
                        <span style={{ fontSize: 11, fontWeight: 500 }}>Create a new tunnel using the form above or the dashboard actions</span>
                      </div>
                    </div>
                  </td></tr>
                ) : sessions.map((s: PortForwardSession) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Zap size={14} color="var(--brand-primary)" />
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{s.target}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 600 }}>{s.namespace}</td>
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                        <span style={{ color: 'var(--brand-primary)', fontWeight: 900 }}>{s.local_port}</span>
                        <ArrowRight size={12} color="var(--text-muted)" />
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{s.remote_port}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)', padding: '4px 10px', borderRadius: 4, width: 'fit-content' }}>
                        <ShieldCheck size={12} color="var(--text-muted)" />
                        <code style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 800 }}>{s.pid}</code>
                      </div>
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16, 185, 129, 0.1)', padding: '6px 12px', borderRadius: 20, width: 'fit-content', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                        <span style={{ fontSize: 10, fontWeight: 900, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <a 
                          href={getForwardUrl(s.local_port)} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="btn-icon" 
                          style={{ width: 34, height: 34, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                          title="Open Endpoint"
                        >
                          <ExternalLink size={16} color="var(--brand-primary)" />
                        </a>
                        <button 
                          className="btn-icon" 
                          style={{ width: 34, height: 34, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                          onClick={() => stopPortForward(s.id)}
                          title="Terminate Session"
                        >
                          <Trash2 size={16} color="#ef4444" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: '20px 32px', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '0 32px', height: 42, fontWeight: 900, fontSize: 12, textTransform: 'uppercase' }}>Close Manager</button>
        </div>
      </div>
    </div>
  )
}

