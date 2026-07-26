import { useState, useEffect } from 'react'
import {
  GitBranch, RefreshCw, Send, History, Power, PowerOff, Eye, EyeOff,
  ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle, Clock, User as UserIcon,
} from 'lucide-react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { Badge } from '../components/ui/Badge'

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

const statusMeta: Record<string, { variant: 'success' | 'warning' | 'danger' | 'neutral'; icon: any; label: string; color: string }> = {
  success: { variant: 'success', icon: CheckCircle2, label: 'Success', color: 'var(--success)' },
  partial: { variant: 'warning', icon: AlertTriangle, label: 'Partial', color: 'var(--warning)' },
  failed: { variant: 'danger', icon: XCircle, label: 'Failed', color: 'var(--danger)' },
  running: { variant: 'neutral', icon: RefreshCw, label: 'Running', color: 'var(--text-muted)' },
}

const triggerMeta: Record<string, { icon: any; label: string }> = {
  scheduled: { icon: Clock, label: 'Scheduled' },
  manual: { icon: UserIcon, label: 'Manual' },
}

function fmtAgo(iso: string) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StatTile({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: any; color: string }) {
  return (
    <div className="card stat-card fade-up">
      <div className="stat-icon-wrapper" style={{ color }}>
        <Icon size={16} color={color} />
      </div>
      <div className="stat-val-group">
        <div className="stat-label">{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="stat-value">{value}</div>
          {sub && <span style={{ fontSize: 12, color, fontWeight: 700 }}>{sub}</span>}
        </div>
      </div>
    </div>
  )
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
  const [showPat, setShowPat] = useState(false)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [syncing, setSyncing] = useState(false)

  const [runs, setRuns] = useState<GitSyncRun[]>([])
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set())

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
      setShowPat(false)
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

  function toggleExpand(id: number) {
    setExpandedRuns(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!loaded) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const lastRun = runs[0]
  const lastRunMeta = lastRun ? statusMeta[lastRun.status] || statusMeta.running : null
  const lastRunTotal = lastRun
    ? lastRun.servers_created + lastRun.servers_updated + lastRun.servers_deleted + lastRun.rules_created + lastRun.rules_updated + lastRun.rules_deleted
    : 0

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Infrastructure-as-Code Sync</h1>
          <p className="page-subtitle hidden-mobile">Sync server lists and alert rules from a Git repository</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={syncNow}
          disabled={syncing || !repoUrl.trim()}
          style={{ gap: 8 }}
        >
          <RefreshCw size={15} className={syncing ? 'loader-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      <div className="grid-stats-4" style={{ marginBottom: 28 }}>
        <StatTile
          label="Schedule"
          value={enabled ? 'Enabled' : 'Disabled'}
          sub={enabled ? `every ${intervalMinutes}m` : undefined}
          icon={enabled ? Power : PowerOff}
          color={enabled ? 'var(--success)' : 'var(--text-muted)'}
        />
        <StatTile
          label="Last Sync"
          value={lastRunMeta ? lastRunMeta.label : 'Never run'}
          sub={lastRun ? fmtAgo(lastRun.started_at) : undefined}
          icon={lastRunMeta ? lastRunMeta.icon : History}
          color={lastRunMeta ? lastRunMeta.color : 'var(--text-muted)'}
        />
        <StatTile
          label="Last Sync Changes"
          value={lastRun ? String(lastRunTotal) : '—'}
          sub={lastRun ? `+${lastRun.servers_created + lastRun.rules_created} ~${lastRun.servers_updated + lastRun.rules_updated} -${lastRun.servers_deleted + lastRun.rules_deleted}` : undefined}
          icon={GitBranch}
          color="var(--brand-primary)"
        />
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
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  style={{ paddingRight: 42 }}
                  type={showPat ? 'text' : 'password'}
                  value={pat}
                  onChange={e => setPat(e.target.value)}
                  placeholder={patSet ? '••••••••  (leave blank to keep current)' : 'ghp_… / glpat-…'}
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowPat(v => !v)}
                  tabIndex={-1}
                  title={showPat ? 'Hide token' : 'Show token'}
                  style={{ position: 'absolute', right: 10, top: 0, bottom: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                >
                  {showPat ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {patSet && !pat.trim() && (
                <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                  A token is already configured (hidden) — entering a new one replaces it.
                </p>
              )}
            </div>

            <div className="grid-2-col" style={{ gap: 20, alignItems: 'start' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Sync interval (minutes)</label>
                <input className="input" type="number" min={1} value={intervalMinutes} onChange={e => setIntervalMinutes(e.target.value)} />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Applies on next backend restart — use “Sync Now” to run immediately.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <input type="checkbox" id="gitsync-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                <label htmlFor="gitsync-enabled" style={{ fontSize: 13, fontWeight: 700, marginBottom: 0 }}>Enable scheduled sync</label>
              </div>
            </div>
          </div>

          {testResult && !testResult.success && (
            <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--danger)40', borderRadius: 'var(--radius-md)', display: 'flex', gap: 10 }}>
              <XCircle size={16} color="var(--danger)" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--danger)', textTransform: 'uppercase', marginBottom: 4 }}>Connection test failed</p>
                <pre style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', margin: 0 }}>{testResult.error}</pre>
              </div>
            </div>
          )}
          {testResult && testResult.success && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={15} color="var(--success)" />
              <p style={{ fontSize: 12, color: 'var(--success)', fontWeight: 700 }}>Connection OK — repository and branch are reachable.</p>
            </div>
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
          </div>
        </form>
      </div>

      <div style={{ maxWidth: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <History size={16} color="var(--text-muted)" />
          <h2 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sync History</h2>
        </div>

        {runs.length === 0 ? (
          <div className="card empty-state">
            <p>No sync runs yet.</p>
            <span>Run “Sync Now” above, or enable the schedule to sync automatically.</span>
          </div>
        ) : (
          <div className="table-container">
            <table className="k-table">
              <thead>
                <tr>
                  {['Status', 'Started', 'Trigger', 'Servers Δ', 'Rules Δ', ''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map(run => {
                  const meta = statusMeta[run.status] || statusMeta.running
                  const StatusIcon = meta.icon
                  const trig = triggerMeta[run.trigger] || { icon: Clock, label: run.trigger }
                  const TrigIcon = trig.icon
                  const conflicts: string[] = (() => {
                    try {
                      const parsed = JSON.parse(run.conflicts_json || '[]')
                      return Array.isArray(parsed) ? parsed : []
                    } catch { return [] }
                  })()
                  const hasDetail = !!run.error_text || conflicts.length > 0
                  const isExpanded = expandedRuns.has(run.id)
                  return (
                    <>
                      <tr key={run.id} onClick={() => hasDetail && toggleExpand(run.id)} style={{ cursor: hasDetail ? 'pointer' : 'default' }}>
                        <td>
                          <Badge variant={meta.variant} style={{ gap: 5 }}>
                            <StatusIcon size={11} className={run.status === 'running' ? 'loader-spin' : ''} /> {meta.label}
                          </Badge>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }} title={new Date(run.started_at).toLocaleString()}>
                          {fmtAgo(run.started_at)}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                            <TrigIcon size={12} /> {trig.label}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                          +{run.servers_created} / ~{run.servers_updated} / -{run.servers_deleted}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                          +{run.rules_created} / ~{run.rules_updated} / -{run.rules_deleted}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {hasDetail && (
                            isExpanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />
                          )}
                        </td>
                      </tr>
                      {hasDetail && isExpanded && (
                        <tr key={`${run.id}-detail`} style={{ cursor: 'default' }}>
                          <td colSpan={6} style={{ background: 'var(--bg-elevated)', padding: '14px 20px' }}>
                            {run.error_text && (
                              <pre style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--danger)', whiteSpace: 'pre-wrap', margin: conflicts.length ? '0 0 8px' : 0 }}>{run.error_text}</pre>
                            )}
                            {conflicts.map((line, i) => (
                              <p key={i} style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--warning)', margin: '2px 0' }}>{line}</p>
                            ))}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .loader-spin { border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
