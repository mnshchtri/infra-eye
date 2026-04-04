import React, { useState, useRef, useCallback } from 'react'
import { X, Upload, Info, Terminal, Shield, CheckCircle2, XCircle, CloudUpload, FileText, Loader2, Clock, Activity, Zap } from 'lucide-react'
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

  const testConnection = async () => {
    if (!form.kube_config) {
      useToastStore.getState().error('Missing KubeConfig', 'KubeConfig is required')
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
      useToastStore.getState().error('Missing KubeConfig', 'Provide a KubeConfig')
      return
    }
    setLoading(true)
    try {
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
      useToastStore.getState().success('Cluster Connected', `${form.name} integrated`)
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
      zIndex: 1100, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div
        className="card fade-up"
        style={{ 
          width: 580, padding: 0, borderRadius: 0, border: '1px solid var(--border)', 
          background: 'var(--bg-card)', boxShadow: '0 40px 100px rgba(0,0,0,0.5)',
          maxHeight: '95vh', overflowY: 'auto'
        }}
      >
        {/* Technical Header */}
        <div style={{
          padding: '28px 32px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 0,
              background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)30',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
               <Activity size={20} color="var(--brand-primary)" />
            </div>
            <div>
              <h2 style={{ 
                fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', 
                textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' 
              }}>
                Connect Cluster
              </h2>
              <p style={{ 
                fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', 
                fontWeight: 800, letterSpacing: '0.1em', marginTop: 4, fontFamily: 'var(--font-mono)'
              }}>
                Control Plane Handshake : Protocols Active
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="btn-icon" 
            style={{ 
              width: 32, height: 32, borderRadius: 0, background: 'var(--bg-app)', 
              border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' 
            }}
          >
            <X size={14} color="var(--text-muted)" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Cluster Identity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ 
              fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', 
              textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' 
            }}>
              Cluster Identifier <span style={{ color: 'var(--brand-primary)' }}>*</span>
            </label>
            <input
              className="input"
              placeholder="e.g. PRODUX_MAIN_CLUSTER"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              style={{ borderRadius: 0, height: 44, fontSize: 13, fontFamily: 'var(--font-mono)', border: '1px solid var(--border)' }}
            />
          </div>

          {/* KubeConfig Logic */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <label style={{ 
                  fontSize: 10, fontWeight: 900, color: 'var(--text-muted)', 
                  textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' 
                }}>
                  KubeConfig Source <span style={{ color: 'var(--brand-primary)' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
                   {(['paste', 'upload'] as InputMode[]).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setInputMode(mode); if (mode === 'paste') setUploadedFileName(null); }}
                        style={{
                          padding: '6px 14px', borderRadius: 0, border: 'none', cursor: 'pointer',
                          fontSize: 10, fontWeight: 900, textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
                          background: inputMode === mode ? 'var(--brand-primary)' : 'var(--bg-app)',
                          color: inputMode === mode ? '#fff' : 'var(--text-muted)',
                        }}
                      >
                        {mode}
                      </button>
                   ))}
                </div>
             </div>

             {inputMode === 'paste' ? (
                <textarea
                  className="input"
                  style={{ 
                    height: 180, borderRadius: 0, fontFamily: 'var(--font-mono)', 
                    fontSize: 11, background: 'var(--bg-app)', border: '1px solid var(--border)',
                    lineHeight: 1.6, resize: 'none'
                  }}
                  placeholder="--- YAML PAYLOAD ---"
                  value={form.kube_config}
                  onChange={e => setForm({ ...form, kube_config: e.target.value })}
                />
             ) : (
                <div
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) loadFileContent(file); }}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    height: 180, border: `1px dashed ${isDragging ? 'var(--brand-primary)' : 'var(--border)'}`,
                    borderRadius: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    background: isDragging ? 'var(--brand-glow)' : 'var(--bg-app)', cursor: 'pointer'
                  }}
                >
                  <CloudUpload size={24} color={uploadedFileName ? 'var(--success)' : 'var(--text-muted)'} />
                  <p style={{ fontSize: 10, fontWeight: 900, color: 'var(--text-primary)', textTransform: 'uppercase', marginTop: 12, fontFamily: 'var(--font-mono)' }}>
                    {uploadedFileName || (isDragging ? 'Release to Load' : 'Drag or click to upload config')}
                  </p>
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept=".yaml,.yml,.conf,config" />
                </div>
             )}
             
             <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'var(--bg-app)50', border: '1px solid var(--border)', borderRadius: 0 }}>
                <Shield size={12} color="var(--brand-primary)" />
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
                  Encryption active: KubeConfig stored in isolated secure volume via cluster-go.
                </span>
             </div>
          </div>

          {/* SSH Proxy Accordion */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 0, background: 'var(--bg-app)' }}>
            <button
              type="button"
              onClick={() => setShowSSH(!showSSH)}
              style={{ width: '100%', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Terminal size={14} color={showSSH ? 'var(--brand-primary)' : 'var(--text-muted)'} />
                <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', color: showSSH ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  SSH Proxy Layers <span style={{ opacity: 0.5, fontSize: 9 }}>(Optional)</span>
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', transform: showSSH ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</div>
            </button>

            {showSSH && (
              <div style={{ padding: '0 20px 24px', display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border)' }}>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
                    <label style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Node Gateway IP</label>
                    <input className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }} placeholder="10.0.0.X" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
                 </div>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                       <label style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Credential_User</label>
                       <input className="input" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }} value={form.ssh_user} onChange={e => setForm({ ...form, ssh_user: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                       <label style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Credential_Pass</label>
                       <input className="input" type="password" style={{ borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }} placeholder="••••••••" value={form.ssh_password} onChange={e => setForm({ ...form, ssh_password: e.target.value })} />
                    </div>
                 </div>
              </div>
            )}
          </div>

          {/* Test Status Banner */}
          {testResult && (
            <div style={{
              padding: '16px 20px',
              borderLeft: `3px solid ${testResult.success ? 'var(--success)' : 'var(--danger)'}`,
              background: 'var(--bg-app)',
              display: 'flex', gap: 12, alignItems: 'flex-start'
            }}>
              {testResult.success ? <Zap size={14} color="var(--success)" /> : <XCircle size={14} color="var(--danger)" />}
              <div style={{ 
                fontSize: 10, color: testResult.success ? 'var(--text-primary)' : 'var(--danger)', 
                fontFamily: 'var(--font-mono)', lineHeight: 1.6, textTransform: 'uppercase', fontWeight: 800 
              }}>
                {testResult.msg}
              </div>
            </div>
          )}

          {/* Connection Actions */}
          <div style={{ display: 'flex', gap: 12, paddingTop: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1, height: 48, borderRadius: 0, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 900, fontSize: 11 }}
              onClick={testConnection}
              disabled={loading || !hasConfig}
            >
              {loading && !testResult ? <Loader2 size={14} className="spin" /> : 'Ping API'}
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={loading || !hasConfig || !form.name}
              style={{ flex: 1.5, height: 48, borderRadius: 0, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', fontWeight: 900, fontSize: 11, letterSpacing: '0.05em' }}
            >
              {loading && testResult ? <Loader2 size={14} className="spin" /> : 'Authorize & Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
