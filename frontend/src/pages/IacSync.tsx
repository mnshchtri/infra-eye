import { useState, useEffect } from 'react'
import { GitBranch, RefreshCw, Send, History } from 'lucide-react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'

interface GitSyncRun {
  id: number
  started_at: string
  finished_at: string
  trigger: string
  status: string
  error_text: string
  conflicts_json: string
  servers_created: number
  servers_updated: number
  servers_deleted: number
  rules_created: number
  rules_updated: number
  rules_deleted: number
}

const statusColor: Record<string, string> = {
  success: 'var(--success)',
  partial: 'var(--warning)',
  failed: 'var(--danger)',
  running: 'var(--text-muted)',
}

export function IacSync() {
  const toast = useToastStore()

  const [loaded, setLoaded] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [subdir, setSubdir] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState('15')
  const [pat, setPat] = useState('')
  const [patSet, setPatSet] = useState(false)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [syncing, setSyncing] = useState(false)

  const [runs, setRuns] = useState<GitSyncRun[]>([])

  useEffect(() => {
    loadSettings()
    loadRuns()
  }, [])

  async function loadSettings() {
    try {
      const res = await api.get('/api/gitsync/settings')
      setRepoUrl(res.data?.repo_url || '')
      setBranch(res.data?.branch || '')
      setSubdir(res.data?.subdir || '')
      setEnabled(res.data?.enabled === true)
      setIntervalMinutes(String(res.data?.interval_minutes || '15'))
      setPatSet(res.data?.pat_set === true)
      setLoaded(true)
    } catch (err: any) {
      toast.error('Load failed', err.response?.data?.error || 'Could not load Git-sync settings.')
    }
  }

  async function loadRuns() {
    try {
      const res = await api.get('/api/gitsync/runs')
      setRuns(res.data || [])
    } catch {
      // non-fatal — history is secondary to the config form
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        repo_url: repoUrl.trim(),
        branch: branch.trim(),
        subdir: subdir.trim(),
        enabled,
        interval_minutes: parseInt(intervalMinutes, 10) || 15,
      }
      if (pat.trim()) body.pat = pat.trim()
      await api.put('/api/gitsync/settings', body)
      setPat('')
      setPatSet(patSet || !!body.pat)
      toast.success('Settings saved', 'Git-sync configuration updated.')
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.error || 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post('/api/gitsync/test', {
        repo_url: repoUrl.trim(),
        branch: branch.trim(),
        pat: pat.trim(),
      })
      setTestResult(res.data)
      if (res.data?.success) {
        toast.success('Connection OK', 'Repository and branch are reachable.')
      } else {
        toast.error('Connection failed', res.data?.error || 'See details below.')
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Could not test connection.'
      setTestResult({ success: false, error: msg })
      toast.error('Test failed', msg)
    } finally {
      setTesting(false)
    }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const res = await api.post('/api/gitsync/sync')
      const run: GitSyncRun = res.data
      const deltaSummary = `${run.servers_created + run.rules_created} created, ${run.servers_updated + run.rules_updated} updated, ${run.servers_deleted + run.rules_deleted} deleted`
      if (run.status === 'success') {
        toast.success('Sync complete', deltaSummary)
      } else if (run.status === 'partial') {
        toast.error('Sync completed with conflicts', deltaSummary)
      } else {
        toast.error('Sync failed', run.error_text || 'See history below.')
      }
      loadRuns()
    } catch (err: any) {
      toast.error('Sync failed', err.response?.data?.error || 'Could not trigger sync.')
    } finally {
      setSyncing(false)
    }
  }

  if (!loaded) {
    return <div className="page" style={{ padding: 40 }}><p style={{ color: 'var(--text-muted)' }}>Loading…</p></div>
  }

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Infrastructure-as-Code Sync</h1>
          <p className="page-subtitle hidden-mobile">Sync server lists and alert rules from a Git repository</p>
        </div>
      </div>

      <div className="card" style={{ padding: '32px 24px', maxWidth: 800, marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(79, 70, 229, 0.08)', border: '1px solid var(--brand-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <GitBranch size={20} color="var(--brand-primary)" />
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Repository</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              InfraEye reads <code style={{ fontFamily: 'var(--font-mono)' }}>servers.yaml</code> and <code style={{ fontFamily: 'var(--font-mono)' }}>alert-rules.yaml</code> from this repo. Credentials (SSH keys/passwords, kubeconfigs) are never read from Git — synced servers still need those set here afterward.
            </p>
          </div>
        </div>

        <form onSubmit={saveSettings}>
          <div style={{ display: 'grid', gap: 24 }}>
            <div className="input-group">
              <label className="input-label">Repository URL</label>
              <input
                className="input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                value={repoUrl}
                onChange={e => setRepoUrl(e.target.value)}
                placeholder="https://github.com/your-org/infra-config.git"
                spellCheck={false}
              />
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                HTTPS only — SSH/local-path repos aren't supported yet.
              </p>
            </div>

            <div className="grid-2-col" style={{ gap: 20 }}>
              <div className="input-group">
                <label className="input-label">Branch</label>
                <input className="input" value={branch} onChange={e => setBranch(e.target.value)} placeholder="main" spellCheck={false} />
              </div>
              <div className="input-group">
                <label className="input-label">Subdirectory <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>(optional)</span></label>
                <input className="input" value={subdir} onChange={e => setSubdir(e.target.value)} placeholder="e.g. infraeye" spellCheck={false} />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Personal Access Token <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>(private repos only)</span></label>
              <input
                className="input"
                type="password"
                value={pat}
                onChange={e => setPat(e.target.value)}
                placeholder={patSet ? '••••••••  (leave blank to keep current)' : 'ghp_… / glpat-…'}
                spellCheck={false}
              />
              {patSet && !pat.trim() && (
                <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                  A token is already configured (hidden) — entering a new one replaces it.
                </p>
              )}
            </div>

            <div className="grid-2-col" style={{ gap: 20, alignItems: 'end' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Sync interval (minutes)</label>
                <input className="input" type="number" min={1} value={intervalMinutes} onChange={e => setIntervalMinutes(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44 }}>
                <input type="checkbox" id="gitsync-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                <label htmlFor="gitsync-enabled" style={{ fontSize: 13, fontWeight: 700, marginBottom: 0 }}>Enable scheduled sync</label>
              </div>
            </div>
          </div>

          {testResult && !testResult.success && (
            <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--danger)40', borderRadius: 'var(--radius-md)' }}>
              <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--danger)', textTransform: 'uppercase', marginBottom: 4 }}>Connection test failed</p>
              <pre style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0 }}>{testResult.error}</pre>
            </div>
          )}
          {testResult && testResult.success && (
            <p style={{ marginTop: 16, fontSize: 12, color: 'var(--success)', fontWeight: 700 }}>Connection OK — repository and branch are reachable.</p>
          )}

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ minWidth: 140 }}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={testConnection}
              disabled={testing || !repoUrl.trim()}
              style={{ gap: 6 }}
            >
              <Send size={14} /> {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={syncNow}
              disabled={syncing || !repoUrl.trim()}
              style={{ gap: 6 }}
            >
              <RefreshCw size={14} className={syncing ? 'loader-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          </div>
        </form>
      </div>

      <div style={{ maxWidth: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <History size={16} color="var(--text-muted)" />
          <h2 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sync History</h2>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {runs.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 0', textAlign: 'center' }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-muted)' }}>No sync runs yet.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 760 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Started', 'Trigger', 'Status', 'Servers Δ', 'Rules Δ', 'Details'].map(h => (
                      <th key={h} style={{ padding: '12px 20px', fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => {
                    const conflicts: string[] = (() => {
                      try {
                        const parsed = JSON.parse(run.conflicts_json || '[]')
                        return Array.isArray(parsed) ? parsed : []
                      } catch { return [] }
                    })()
                    return (
                      <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{new Date(run.started_at).toLocaleString()}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)' }}>{run.trigger}</td>
                        <td style={{ padding: '12px 20px' }}>
                          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: statusColor[run.status] || 'var(--text-muted)' }}>{run.status}</span>
                        </td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          +{run.servers_created} / ~{run.servers_updated} / -{run.servers_deleted}
                        </td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          +{run.rules_created} / ~{run.rules_updated} / -{run.rules_deleted}
                        </td>
                        <td style={{ padding: '12px 20px', maxWidth: 340 }}>
                          {run.error_text && (
                            <pre style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--danger)', whiteSpace: 'pre-wrap', margin: 0 }}>{run.error_text}</pre>
                          )}
                          {conflicts.map((line, i) => (
                            <p key={i} style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--warning)', margin: '2px 0' }}>{line}</p>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .loader-spin { border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
