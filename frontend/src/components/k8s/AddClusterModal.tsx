import React, { useState, useRef, useCallback } from 'react'
import { X, Upload, Info, Terminal, Shield, CheckCircle2, XCircle, CloudUpload, FileText, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'

interface AddClusterModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type InputMode = 'paste' | 'upload';

export function AddClusterModal({ onClose, onSuccess }: AddClusterModalProps) {
  const [loading, setLoading] = useState(false)
  const [showSSH, setShowSSH] = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('paste')
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [form, setForm] = useState({
    name: '',
    host: '',
    ssh_user: 'root',
    ssh_password: '',
    kube_config: ''
  })
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFileContent = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setForm(f => ({ ...f, kube_config: content }))
      setUploadedFileName(file.name)
      setTestResult(null)
      useToastStore.getState().success('File Loaded', `${file.name} ready to connect`)
    }
    reader.readAsText(file)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFileContent(file)
  }

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFileContent(file)
  }, [loadFileContent])

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const testConnection = async () => {
    if (!form.kube_config) {
      useToastStore.getState().error('Missing KubeConfig', 'KubeConfig is required to test connection')
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
    if (!form.kube_config) {
      useToastStore.getState().error('Missing KubeConfig', 'Please provide a KubeConfig')
      return
    }
    setLoading(true)
    try {
      // Only include SSH fields if the user actually filled them in
      const payload: Record<string, any> = {
        name: form.name,
        kube_config: form.kube_config,
        auth_type: 'password',
        tags: 'kubernetes',
        is_k8s: true,
      }
      if (form.host)         payload.host         = form.host
      if (form.ssh_user && form.ssh_user !== 'root') payload.ssh_user = form.ssh_user
      if (form.ssh_password) payload.ssh_password = form.ssh_password

      await api.post('/api/servers', payload)
      useToastStore.getState().success('Cluster Connected', `${form.name} is now managed by InfraEye`)
      onSuccess()
      onClose()
    } catch (e: any) {
      useToastStore.getState().error('Failed', e.response?.data?.error || 'Could not add cluster')
    } finally {
      setLoading(false)
    }
  }

  const hasConfig = form.kube_config.trim().length > 0

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      zIndex: 1100, background: 'rgba(10, 15, 30, 0.6)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div
        className="card fade-up"
        style={{ width: 560, padding: 0, boxShadow: '0 25px 60px rgba(0,0,0,0.3)', maxHeight: '92vh', overflowY: 'auto', border: '1px solid var(--border-bright)', borderRadius: 16 }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 28px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, var(--brand-glow) 0%, transparent 100%)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'var(--brand-gradient)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(79,70,229,0.35)'
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="white" opacity="0.3"/>
                  <path d="M12 6v6l4 2" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>Connect Cluster</h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>Add a Kubernetes cluster via KubeConfig or SSH Proxy</p>
              </div>
            </div>
            <button onClick={onClose} className="btn-icon" style={{ padding: 6 }}><X size={18} /></button>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Friendly Name */}
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Cluster Name <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input
              className="input"
              placeholder="e.g. Production Cluster"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              style={{ fontSize: 14 }}
            />
          </div>

          {/* KubeConfig Input Mode Toggle */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label className="input-label" style={{ marginBottom: 0 }}>KubeConfig <span style={{ color: 'var(--danger)' }}>*</span></label>
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg-app)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
                {(['paste', 'upload'] as InputMode[]).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { setInputMode(mode); if (mode === 'paste') setUploadedFileName(null) }}
                    style={{
                      padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                      background: inputMode === mode ? 'var(--brand-gradient)' : 'transparent',
                      color: inputMode === mode ? '#fff' : 'var(--text-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {mode === 'paste' ? '✏️ Paste' : '📁 Upload'}
                  </button>
                ))}
              </div>
            </div>

            {inputMode === 'paste' ? (
              <textarea
                className="input"
                style={{ height: 148, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, lineHeight: 1.6, resize: 'vertical' }}
                placeholder="Paste contents of ~/.kube/config or k3s.yaml"
                value={form.kube_config}
                onChange={e => setForm({ ...form, kube_config: e.target.value })}
              />
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? 'var(--brand-primary)' : uploadedFileName ? 'var(--success)' : 'var(--border-bright)'}`,
                  borderRadius: 12, padding: '36px 24px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
                  cursor: 'pointer', textAlign: 'center',
                  background: isDragging ? 'var(--brand-glow)' : uploadedFileName ? 'var(--success-glow)' : 'var(--bg-app)',
                  transition: 'all 0.2s ease',
                }}
              >
                {uploadedFileName ? (
                  <>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--success-glow)', border: '1px solid var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <FileText size={20} color="var(--success)" />
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>{uploadedFileName}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Click to replace</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--brand-glow)', border: '1px solid rgba(79,70,229,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CloudUpload size={22} color="var(--brand-primary)" />
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {isDragging ? 'Drop your kubeconfig here' : 'Drag & drop or click to upload'}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>.yaml · .yml · .conf · config</p>
                    </div>
                  </>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  accept=".yaml,.yml,.conf,config"
                />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              <Info size={11} />
              <span>KubeConfig is stored securely and only used for cluster management via MCP.</span>
            </div>
          </div>

          {/* SSH Proxy Accordion */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-app)' }}>
            <button
              type="button"
              onClick={() => setShowSSH(!showSSH)}
              style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Terminal size={15} color={showSSH ? 'var(--brand-primary)' : 'var(--text-muted)'} />
                <span style={{ fontSize: 13, fontWeight: 600, color: showSSH ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  SSH Proxy Settings{' '}
                  <span style={{ fontWeight: 400, opacity: 0.65, fontSize: 11 }}>(Optional)</span>
                </span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'inline-block', transform: showSSH ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </button>

            {showSSH && (
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--brand-glow)', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <Shield size={14} color="var(--brand-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    Use SSH Proxy if the cluster API is behind a firewall. InfraEye tunnels kubectl commands through this host.
                  </p>
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Target Node IP / Host</label>
                  <input className="input" placeholder="e.g. 10.0.0.5" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">SSH User</label>
                    <input className="input" placeholder="root" value={form.ssh_user} onChange={e => setForm({ ...form, ssh_user: e.target.value })} />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">SSH Password</label>
                    <input className="input" type="password" placeholder="••••••••" value={form.ssh_password} onChange={e => setForm({ ...form, ssh_password: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Test Result Banner */}
          {testResult && (
            <div className="fade-up" style={{
              padding: '12px 16px',
              borderLeft: `4px solid ${testResult.success ? 'var(--success)' : 'var(--danger)'}`,
              borderRadius: 8,
              background: testResult.success ? 'var(--success-glow)' : 'var(--danger-glow)',
              display: 'flex', gap: 10, alignItems: 'flex-start'
            }}>
              {testResult.success
                ? <CheckCircle2 size={16} color="var(--success)" style={{ flexShrink: 0, marginTop: 1 }} />
                : <XCircle size={16} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />
              }
              <pre style={{ fontSize: 11, color: testResult.success ? 'var(--success)' : 'var(--danger)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, flex: 1 }}>
                {testResult.msg}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={testConnection}
              disabled={loading || !hasConfig}
            >
              {loading && !testResult
                ? <><Loader2 size={14} className="spin" /> Testing...</>
                : <><Upload size={14} /> Test Connection</>}
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={loading || !hasConfig || !form.name}
              style={{ flex: 1.5 }}
            >
              {loading && testResult
                ? <><Loader2 size={14} className="spin" /> Connecting...</>
                : 'Connect Cluster'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
