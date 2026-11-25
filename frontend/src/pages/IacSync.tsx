import { useState, useEffect, Fragment } from 'react'
import {
  GitBranch, RefreshCw, Send, History, Power, PowerOff, Eye, EyeOff,
  ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle, Clock, User as UserIcon,
} from 'lucide-react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import {
  Alert, Box, Chip, FormControlLabel, IconButton, InputAdornment, Paper, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { Button, Card, CardBody, EmptyState, PageHeader, SectionHeader, Spinner, StatCard } from '../components/ui'
import { apiError } from '../utils/errors'
import type { LucideIcon } from 'lucide-react'

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

const statusMeta: Record<string, { variant: 'success' | 'warning' | 'error' | 'default'; icon: LucideIcon; label: string; color: string }> = {
  success: { variant: 'success', icon: CheckCircle2, label: 'Success', color: 'var(--success)' },
  partial: { variant: 'warning', icon: AlertTriangle, label: 'Partial', color: 'var(--warning)' },
  failed: { variant: 'error', icon: XCircle, label: 'Failed', color: 'var(--danger)' },
  running: { variant: 'default', icon: RefreshCw, label: 'Running', color: 'var(--text-muted)' },
}

const triggerMeta: Record<string, { icon: LucideIcon; label: string }> = {
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
    } catch (err: unknown) {
      toast.error('Load failed', apiError(err) || 'Could not load Git-sync settings.')
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
    } catch (err: unknown) {
      toast.error('Save failed', apiError(err) || 'Could not save settings.')
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
    } catch (err: unknown) {
      const msg = apiError(err) || 'Could not test connection.'
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
    } catch (err: unknown) {
      toast.error('Sync failed', apiError(err) || 'Could not trigger sync.')
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
      <div className="page">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><Spinner size={36} /></Box>
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
      <PageHeader
        title="Infrastructure-as-Code Sync"
        subtitle="Sync server lists and alert rules from a Git repository"
        actions={
          <Button
            variant="primary"
            onClick={syncNow}
            disabled={syncing || !repoUrl.trim()}
            loading={syncing}
            icon={<RefreshCw size={15} />}
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard
          label="Schedule"
          value={enabled ? 'Enabled' : 'Disabled'}
          delta={enabled ? `every ${intervalMinutes}m` : undefined}
          icon={enabled ? Power : PowerOff}
          color={enabled ? 'var(--success)' : 'var(--text-muted)'}
        />
        <StatCard
          label="Last sync"
          value={lastRunMeta ? lastRunMeta.label : 'Never run'}
          delta={lastRun ? fmtAgo(lastRun.started_at) : undefined}
          icon={lastRunMeta ? lastRunMeta.icon : History}
          color={lastRunMeta ? lastRunMeta.color : 'var(--text-muted)'}
        />
        <StatCard
          label="Last sync changes"
          value={lastRun ? String(lastRunTotal) : '—'}
          delta={lastRun ? `+${lastRun.servers_created + lastRun.rules_created} ~${lastRun.servers_updated + lastRun.rules_updated} -${lastRun.servers_deleted + lastRun.rules_deleted}` : undefined}
          icon={GitBranch}
          color="var(--brand-primary)"
        />
      </Box>

      <Card style={{ maxWidth: 800, marginBottom: 24 }}>
        <CardBody>
          <SectionHeader
            icon={GitBranch}
            iconColor="var(--brand-primary)"
            title="Repository"
            subtitle="InfraEye reads servers.yaml and alert-rules.yaml from this repo. Credentials (SSH keys/passwords, kubeconfigs) are never read from Git — synced servers still need those set here afterward."
          />
          <Box component="form" onSubmit={saveSettings} sx={{ display: 'grid', gap: 2.5, mt: 2 }}>
            <TextField
              label="Repository URL"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/your-org/infra-config.git"
              helperText="HTTPS only — SSH/local-path repos aren't supported yet."
              fullWidth
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'var(--font-mono)' } }, inputLabel: { shrink: true } }}
            />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                label="Branch"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="main"
                slotProps={{ htmlInput: { spellCheck: false }, inputLabel: { shrink: true } }}
              />
              <TextField
                label="Subdirectory (optional)"
                value={subdir}
                onChange={e => setSubdir(e.target.value)}
                placeholder="e.g. infraeye"
                slotProps={{ htmlInput: { spellCheck: false }, inputLabel: { shrink: true } }}
              />
            </Box>

            <TextField
              label="Personal access token (private repos only)"
              type={showPat ? 'text' : 'password'}
              value={pat}
              onChange={e => setPat(e.target.value)}
              placeholder={patSet ? '••••••••  (leave blank to keep current)' : 'ghp_… / glpat-…'}
              helperText={patSet && !pat.trim() ? 'A token is already configured (hidden) — entering a new one replaces it.' : undefined}
              fullWidth
              slotProps={{
                htmlInput: { spellCheck: false, autoComplete: 'off' },
                inputLabel: { shrink: true },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title={showPat ? 'Hide token' : 'Show token'}>
                        <IconButton size="small" onClick={() => setShowPat(v => !v)} aria-label={showPat ? 'Hide token' : 'Show token'}>
                          {showPat ? <EyeOff size={15} /> : <Eye size={15} />}
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                },
              }}
            />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, alignItems: 'start' }}>
              <TextField
                label="Sync interval (minutes)"
                type="number"
                value={intervalMinutes}
                onChange={e => setIntervalMinutes(e.target.value)}
                helperText="Applies on next backend restart — use “Sync Now” to run immediately."
                slotProps={{ htmlInput: { min: 1 }, inputLabel: { shrink: true } }}
              />
              <FormControlLabel
                sx={{ mt: 0.5 }}
                control={<Switch checked={enabled} onChange={e => setEnabled(e.target.checked)} />}
                label="Enable scheduled sync"
              />
            </Box>

            {testResult && !testResult.success && (
              <Alert severity="error" icon={<XCircle size={18} />}>
                <Typography variant="subtitle2">Connection test failed</Typography>
                <Box component="pre" sx={{ m: 0, mt: 0.5, fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{testResult.error}</Box>
              </Alert>
            )}
            {testResult && testResult.success && (
              <Alert severity="success">Connection OK — repository and branch are reachable.</Alert>
            )}

            <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Button type="submit" variant="primary" loading={saving}>
                {saving ? 'Saving…' : 'Save Settings'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={testConnection}
                disabled={testing || !repoUrl.trim()}
                loading={testing}
                icon={<Send size={14} />}
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
            </Box>
          </Box>
        </CardBody>
      </Card>

      <Box sx={{ maxWidth: 1000 }}>
        <SectionHeader icon={History} title="Sync history" />

        {runs.length === 0 ? (
          <Card>
            <EmptyState
              icon={History}
              title="No sync runs yet."
              description="Run “Sync Now” above, or enable the schedule to sync automatically."
            />
          </Card>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Status', 'Started', 'Trigger', 'Servers Δ', 'Rules Δ'].map(h => (
                    <TableCell key={h}>{h}</TableCell>
                  ))}
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
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
                    <Fragment key={run.id}>
                      <TableRow
                        hover={hasDetail}
                        onClick={() => hasDetail && toggleExpand(run.id)}
                        sx={{ cursor: hasDetail ? 'pointer' : 'default', '& td': { lineHeight: 1.5 } }}
                      >
                        <TableCell>
                          <Chip
                            size="small"
                            color={meta.variant}
                            variant={meta.variant === 'default' ? 'outlined' : 'filled'}
                            icon={<StatusIcon size={12} />}
                            label={meta.label}
                          />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }} title={new Date(run.started_at).toLocaleString()}>
                          {fmtAgo(run.started_at)}
                        </TableCell>
                        <TableCell>
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
                            <TrigIcon size={12} /> {trig.label}
                          </Box>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                          +{run.servers_created} / ~{run.servers_updated} / -{run.servers_deleted}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                          +{run.rules_created} / ~{run.rules_updated} / -{run.rules_deleted}
                        </TableCell>
                        <TableCell align="right" padding="checkbox">
                          {hasDetail && (
                            <Box component="span" sx={{ display: 'inline-flex', color: 'text.secondary', pr: 1 }} aria-hidden>
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </Box>
                          )}
                        </TableCell>
                      </TableRow>
                      {hasDetail && isExpanded && (
                        <TableRow>
                          <TableCell colSpan={6} sx={{ bgcolor: 'action.hover' }}>
                            {run.error_text && (
                              <Box component="pre" sx={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'error.main', whiteSpace: 'pre-wrap', m: 0, mb: conflicts.length ? 1 : 0 }}>{run.error_text}</Box>
                            )}
                            {conflicts.map((line, i) => (
                              <Typography key={i} sx={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'warning.main', my: 0.25 }}>{line}</Typography>
                            ))}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </div>
  )
}
