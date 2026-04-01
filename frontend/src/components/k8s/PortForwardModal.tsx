import React, { useState } from 'react'
import { X } from 'lucide-react'
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
}

export function PortForwardModal({ serverID, sessions, onClose, onRefresh }: PortForwardModalProps) {
  const toast = useToastStore()
  const [form, setForm] = useState({ namespace: 'default', target: '', local_port: '', remote_port: '' })
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card fade-up" style={{ width: 760, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Kubernetes Port Forward Manager</h3>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={createPortForward} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr auto', gap: 10, marginBottom: 16 }}>
          <input className="input" placeholder="Namespace" value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} required />
          <input className="input" placeholder="Target (svc/my-service or pod/my-pod)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required />
          <input className="input" placeholder="Local" value={form.local_port} onChange={(e) => setForm({ ...form, local_port: e.target.value })} required />
          <input className="input" placeholder="Remote" value={form.remote_port} onChange={(e) => setForm({ ...form, remote_port: e.target.value })} required />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Starting...' : 'Start'}</button>
        </form>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table className="k-table">
            <thead>
              <tr>
                <th>Target</th><th>Namespace</th><th>Ports</th><th>PID</th><th>Started</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No active port forwards</td></tr>
              ) : sessions.map((s: PortForwardSession) => (
                <tr key={s.id}>
                  <td>{s.target}</td>
                  <td>{s.namespace}</td>
                  <td>{s.local_port}:{s.remote_port}</td>
                  <td>{s.pid}</td>
                  <td>{new Date(s.created_at).toLocaleString()}</td>
                  <td><button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => stopPortForward(s.id)}>Stop</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
