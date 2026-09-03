import React, { useState, useEffect, useCallback } from 'react'
import { X, KeyRound, Download, Copy, Trash2, ShieldCheck, AlertTriangle, Eye } from 'lucide-react'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'

interface ReadOnlyIdentity {
  name: string
  service_account: string
  created_at: string
  has_static_token: boolean
}

interface GeneratedConfig {
  kubeconfig: string
  service_account: string
  namespace: string
  filename: string
  expires_at?: string
}

interface ListResponse {
  identities: ReadOnlyIdentity[]
  api_server: string
}

interface Props {
  serverID: number
  clusterName: string
  onClose: () => void
}

// The backend returns real API-server messages verbatim (see DESIGN_PRINCIPLES);
// surface those rather than a generic string, without reaching for `any`.
function errMessage(e: unknown): string {
  const res = (e as { response?: { data?: { error?: string } } })?.response
  return res?.data?.error || (e instanceof Error ? e.message : 'Unknown error')
}

const EXPIRY_CHOICES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'Never expires', days: 0 },
]

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 900, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.1em',
}

export function ReadOnlyKubeconfigModal({ serverID, clusterName, onClose }: Props) {
  const toast = useToastStore()

  const [name, setName] = useState('')
  const [expiryDays, setExpiryDays] = useState(30)
  const [apiServer, setApiServer] = useState('')
  const [detectedServer, setDetectedServer] = useState('')
  const [identities, setIdentities] = useState<ReadOnlyIdentity[]>([])
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GeneratedConfig | null>(null)

  const applyListing = useCallback((data: ListResponse) => {
    setIdentities(data.identities || [])
    const detected = data.api_server || ''
    setDetectedServer(detected)
    // Only seed the field; never clobber an address the operator has typed.
    setApiServer(prev => prev || detected)
  }, [])

  const loadIdentities = useCallback(async () => {
    try {
      const res = await api.get(`/api/servers/${serverID}/k8s/readonly-kubeconfig`)
      applyListing(res.data)
    } catch (e: unknown) {
      toast.error('Could not reach cluster', errMessage(e))
    }
  }, [serverID, applyListing, toast])

  // Fetching in the async continuation rather than calling loadIdentities()
  // straight from the effect body keeps setState out of the synchronous render
  // path; the cancelled flag drops a late response if the modal is closed first.
  useEffect(() => {
    let cancelled = false
    api.get(`/api/servers/${serverID}/k8s/readonly-kubeconfig`)
      .then(res => { if (!cancelled) applyListing(res.data) })
      .catch((e: unknown) => { if (!cancelled) toast.error('Could not reach cluster', errMessage(e)) })
    return () => { cancelled = true }
  }, [serverID, applyListing, toast])

  const generate = async (e: React.FormEvent) => {
    e.preventDefault()
    setGenerating(true)
    setResult(null)
    try {
      const res = await api.post(`/api/servers/${serverID}/k8s/readonly-kubeconfig`, {
        name,
        expires_in_days: expiryDays,
        server_url: apiServer,
      })
      setResult(res.data)
      toast.success('Kubeconfig generated', `Read-only access for ${name}`)
      loadIdentities()
    } catch (e: unknown) {
      toast.error('Generation failed', errMessage(e))
    } finally {
      setGenerating(false)
    }
  }

  const download = () => {
    if (!result) return
    // Build the file in the browser rather than adding a download endpoint —
    // the kubeconfig is already in hand, and this keeps the credential out of
    // a second round trip and out of any URL.
    const blob = new Blob([result.kubeconfig], { type: 'application/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.kubeconfig)
      toast.success('Copied', 'Kubeconfig copied to clipboard')
    } catch {
      toast.error('Copy failed', 'Your browser blocked clipboard access — use Download instead')
    }
  }

  const revoke = async (identity: ReadOnlyIdentity) => {
    try {
      await api.delete(`/api/servers/${serverID}/k8s/readonly-kubeconfig/${identity.name}`)
      toast.success('Access revoked', `${identity.service_account} deleted — its kubeconfig no longer works`)
      if (result?.service_account === identity.service_account) setResult(null)
      loadIdentities()
    } catch (e: unknown) {
      toast.error('Revoke failed', errMessage(e))
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8, 10, 15, 0.7)', backdropFilter: 'blur(12px)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card fade-up" style={{ width: 900, maxWidth: '95vw', maxHeight: '90vh', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column', borderRadius: 12, border: '1px solid var(--border-bright)', boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.7)' }}>

        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <KeyRound size={22} color="var(--brand-primary)" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>Read-Only Kubeconfig</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>{clusterName}</span>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ fontSize: 12, color: 'var(--brand-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>{identities.length} Issued</span>
              </div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ width: 40, height: 40 }}><X size={20} /></button>
        </div>

        <div style={{ padding: 32, flex: 1, overflowY: 'auto', background: 'var(--bg-app)' }}>

          {/* What the holder can and cannot do — stated up front, since this
              grants secret access and that is easy to hand out carelessly. */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', border: '1px solid var(--border)', background: 'var(--bg-card)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Eye size={14} color="var(--success)" />
                <span style={{ ...labelStyle, color: 'var(--success)' }}>Can read</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'var(--font-mono)' }}>
                All resources in all namespaces<br />
                Secrets &amp; ConfigMaps<br />
                Pod logs (<code>kubectl logs</code>)<br />
                Nodes, PVs, CRDs, events
              </div>
            </div>
            <div style={{ flex: '1 1 320px', border: '1px solid var(--border)', background: 'var(--bg-card)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <ShieldCheck size={14} color="var(--danger)" />
                <span style={{ ...labelStyle, color: 'var(--danger)' }}>Cannot</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'var(--font-mono)' }}>
                Create, apply or deploy<br />
                Edit, patch or scale<br />
                Delete anything<br />
                <code>exec</code> or <code>port-forward</code> into pods
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', marginBottom: 24, border: '1px solid var(--warning)40', background: 'var(--warning)10' }}>
            <AlertTriangle size={16} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Secret read access is cluster-wide. Whoever holds this file can read every credential stored in the
              cluster, so treat it as sensitive and prefer a short expiry.
            </span>
          </div>

          <form onSubmit={generate} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 16, marginBottom: 12, background: 'var(--bg-card)', padding: 24, border: '1px solid var(--border-bright)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={labelStyle}>Issue to</label>
              <input
                className="input" placeholder="e.g. alice or backend-team" value={name}
                onChange={e => setName(e.target.value)} required
                style={{ height: 42, background: 'var(--bg-input)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={labelStyle}>Expires</label>
              <select
                className="input" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))}
                style={{ height: 42, background: 'var(--bg-input)' }}
              >
                {EXPIRY_CHOICES.map(c => <option key={c.days} value={c.days}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" disabled={generating || !name.trim()} style={{ height: 42, padding: '0 24px', fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
            <label style={labelStyle}>API server the developer will connect to</label>
            <input
              className="input" value={apiServer} onChange={e => setApiServer(e.target.value)}
              placeholder="https://cluster.example.com:6443"
              style={{ height: 42, background: 'var(--bg-input)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {detectedServer
                ? <>Detected from this cluster&apos;s stored config. Change it if that address is only reachable from the InfraEye host.</>
                : <>Could not detect an address from the stored config — enter one the developer can reach.</>}
            </span>
          </div>

          {result && (
            <div style={{ marginBottom: 32, border: '1px solid var(--brand-primary)40', background: 'var(--bg-card)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900, fontFamily: 'var(--font-mono)' }}>{result.filename}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    {result.service_account} · {result.expires_at
                      ? `expires ${new Date(result.expires_at).toLocaleString()}`
                      : 'never expires'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-secondary" onClick={copy} style={{ height: 38, padding: '0 16px', gap: 8, display: 'flex', alignItems: 'center', fontWeight: 900, fontSize: 12 }}>
                    <Copy size={14} /> COPY
                  </button>
                  <button type="button" className="btn btn-primary" onClick={download} style={{ height: 38, padding: '0 16px', gap: 8, display: 'flex', alignItems: 'center', fontWeight: 900, fontSize: 12 }}>
                    <Download size={14} /> DOWNLOAD
                  </button>
                </div>
              </div>
              <pre style={{ margin: 0, padding: 20, maxHeight: 240, overflow: 'auto', fontSize: 11, lineHeight: 1.6, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-input)' }}>
                {result.kubeconfig}
              </pre>
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Save as <code>~/.kube/config</code>, or keep it separate and use{' '}
                <code>kubectl --kubeconfig {result.filename} get pods -A</code>.
              </div>
            </div>
          )}

          <div>
            <div style={{ ...labelStyle, marginBottom: 12 }}>Issued access</div>
            <div style={{ border: '1px solid var(--border)', overflowX: 'auto', background: 'var(--bg-card)' }}>
              <table className="k-table" style={{ minWidth: 560 }}>
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    <th style={{ padding: '14px 20px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Issued to</th>
                    <th style={{ padding: '14px 20px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Service Account</th>
                    <th style={{ padding: '14px 20px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Created</th>
                    <th style={{ padding: '14px 20px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Revoke</th>
                  </tr>
                </thead>
                <tbody style={{ fontSize: 13 }}>
                  {identities.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                      No read-only access issued for this cluster yet
                    </td></tr>
                  ) : identities.map(idn => (
                    <tr key={idn.service_account}>
                      <td style={{ padding: '14px 20px', fontWeight: 700 }}>{idn.name}</td>
                      <td style={{ padding: '14px 20px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                        {idn.service_account}
                        {idn.has_static_token && <span style={{ marginLeft: 8, color: 'var(--warning)', fontSize: 11 }}>no expiry</span>}
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
                        {new Date(idn.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button className="btn-icon" title={`Revoke ${idn.name}'s access`} onClick={() => revoke(idn)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
              Revoking deletes the ServiceAccount, which kills every token ever issued for it — including
              unexpired ones. Generating again for the same name issues an additional token; it does not
              invalidate the previous one.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
