import React, { useState, useEffect, useCallback } from 'react'
import { KeyRound, Download, Copy, Trash2, ShieldCheck, AlertTriangle, Eye } from 'lucide-react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select } from '../ui/Input'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { errMessage } from '../../utils/errors'

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
  // False when InfraEye's own connection to this cluster cannot manage RBAC —
  // e.g. the cluster was registered with a read-only kubeconfig, possibly one
  // this very dialog generated. Issuing and revoking are impossible then.
  can_manage: boolean
  connected_as: string
}

interface Props {
  serverID: number
  clusterName: string
  onClose: () => void
}


const EXPIRY_CHOICES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'Never expires', days: 0 },
]

export function ReadOnlyKubeconfigModal({ serverID, clusterName, onClose }: Props) {
  const toastError = useToastStore(s => s.error)
  const toastSuccess = useToastStore(s => s.success)

  const [name, setName] = useState('')
  const [expiryDays, setExpiryDays] = useState(30)
  const [apiServer, setApiServer] = useState('')
  const [detectedServer, setDetectedServer] = useState('')
  const [identities, setIdentities] = useState<ReadOnlyIdentity[]>([])
  const [canManage, setCanManage] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [connectedAs, setConnectedAs] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GeneratedConfig | null>(null)

  const applyListing = useCallback((data: ListResponse) => {
    setIdentities(data.identities || [])
    const detected = data.api_server || ''
    setDetectedServer(detected)
    setLoadError(null)
    setCanManage(data.can_manage !== false)
    setConnectedAs(data.connected_as || '')
    // Only seed the field; never clobber an address the operator has typed.
    setApiServer(prev => prev || detected)
  }, [])

  const loadIdentities = useCallback(async () => {
    try {
      const res = await api.get(`/api/servers/${serverID}/k8s/readonly-kubeconfig`)
      applyListing(res.data)
    } catch (e: unknown) {
      setLoadError(errMessage(e))
    }
  }, [serverID, applyListing])

  // Fetching in the async continuation rather than calling loadIdentities()
  // straight from the effect body keeps setState out of the synchronous render
  // path; the cancelled flag drops a late response if the modal is closed first.
  useEffect(() => {
    let cancelled = false
    api.get(`/api/servers/${serverID}/k8s/readonly-kubeconfig`)
      .then(res => { if (!cancelled) applyListing(res.data) })
      .catch((e: unknown) => { if (!cancelled) setLoadError(errMessage(e)) })
    return () => { cancelled = true }
  }, [serverID, applyListing, toastError])

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
      toastSuccess('Kubeconfig generated', `Read-only access for ${name}`)
      loadIdentities()
    } catch (e: unknown) {
      toastError('Generation failed', errMessage(e))
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
      toastSuccess('Copied', 'Kubeconfig copied to clipboard')
    } catch {
      toastError('Copy failed', 'Your browser blocked clipboard access — use Download instead')
    }
  }

  const revoke = async (identity: ReadOnlyIdentity) => {
    try {
      await api.delete(`/api/servers/${serverID}/k8s/readonly-kubeconfig/${identity.name}`)
      toastSuccess('Access revoked', `${identity.service_account} deleted — its kubeconfig no longer works`)
      if (result?.service_account === identity.service_account) setResult(null)
      loadIdentities()
    } catch (e: unknown) {
      toastError('Revoke failed', errMessage(e))
    }
  }

  const mono = { fontFamily: 'var(--font-mono)' }
  const th = { fontWeight: 600, color: 'text.secondary' }
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      icon={KeyRound}
      title="Read-only kubeconfig"
      subtitle={`${clusterName} · ${identities.length} issued`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {/* What the holder can and cannot do — stated up front, since this
          grants secret access and that is easy to hand out carelessly. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'success.main' }}>
            <Eye size={14} />
            <Typography variant="subtitle2">Can read</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ ...mono, lineHeight: 1.7 }}>
            All resources in all namespaces<br />
            Secrets &amp; ConfigMaps<br />
            Pod logs (<code>kubectl logs</code>)<br />
            Nodes, PVs, CRDs, events
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, color: 'error.main' }}>
            <ShieldCheck size={14} />
            <Typography variant="subtitle2">Cannot</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ ...mono, lineHeight: 1.7 }}>
            Create, apply or deploy<br />
            Edit, patch or scale<br />
            Delete anything<br />
            <code>exec</code> or <code>port-forward</code> into pods
          </Typography>
        </Paper>
      </Box>

      {loadError ? (
        <Alert severity="error" icon={<AlertTriangle size={16} />} sx={{ mb: 2.5 }}>
          Could not reach this cluster, so access cannot be issued or revoked here.
          <Box sx={{ mt: 0.75, ...mono, fontSize: 11.5, wordBreak: 'break-word' }}>{loadError}</Box>
        </Alert>
      ) : !canManage ? (
        <Alert severity="error" icon={<AlertTriangle size={16} />} sx={{ mb: 2.5 }}>
          InfraEye connects to this cluster
          {connectedAs ? <> as <code>{connectedAs}</code></> : null}, which cannot manage RBAC — so access
          cannot be issued or revoked here. This is expected if the cluster was registered with a read-only
          kubeconfig. Register it with an admin kubeconfig to manage access from this panel.
        </Alert>
      ) : (
        <Alert severity="warning" icon={<AlertTriangle size={16} />} sx={{ mb: 2.5 }}>
          Secret read access is cluster-wide. Whoever holds this file can read every credential stored in the
          cluster, so treat it as sensitive and prefer a short expiry.
        </Alert>
      )}

      <Box component="form" onSubmit={generate} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr auto' }, gap: 2, mb: 2, alignItems: 'start' }}>
        <Input label="Issue to" placeholder="e.g. alice or backend-team" value={name} onChange={e => setName(e.target.value)} required />
        <Select
          label="Expires"
          value={String(expiryDays)}
          onChange={e => setExpiryDays(Number(e.target.value))}
          options={EXPIRY_CHOICES.map(c => ({ value: String(c.days), label: c.label }))}
        />
        <Button type="submit" loading={generating} disabled={!name.trim() || !canManage || !!loadError}
          title={canManage ? undefined : 'This cluster is registered with a credential that cannot manage RBAC'} style={{ height: 40 }}>
          {generating ? 'Generating...' : 'Generate'}
        </Button>
      </Box>

      <Box sx={{ mb: 3 }}>
        <Input
          label="API server the developer will connect to"
          value={apiServer}
          onChange={e => setApiServer(e.target.value)}
          placeholder="https://cluster.example.com:6443"
          helper={detectedServer
            ? "Detected from this cluster's stored config. Change it if that address is only reachable from the InfraEye host."
            : 'Could not detect an address from the stored config — enter one the developer can reach.'}
        />
      </Box>

      {result && (
        <Paper variant="outlined" sx={{ mb: 3, borderColor: 'primary.main' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="subtitle2" sx={mono}>{result.filename}</Typography>
              <Typography variant="caption" color="text.secondary" sx={mono}>
                {result.service_account} · {result.expires_at
                  ? `expires ${new Date(result.expires_at).toLocaleString()}`
                  : 'never expires'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button type="button" variant="secondary" size="sm" icon={<Copy size={14} />} onClick={copy}>Copy</Button>
              <Button type="button" size="sm" icon={<Download size={14} />} onClick={download}>Download</Button>
            </Box>
          </Box>
          <Box component="pre" sx={{ m: 0, p: 2, maxHeight: 240, overflow: 'auto', fontSize: 11, lineHeight: 1.6, ...mono, color: 'text.secondary', bgcolor: 'action.hover' }}>
            {result.kubeconfig}
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
            Save as <code>~/.kube/config</code>, or keep it separate and use{' '}
            <code>kubectl --kubeconfig {result.filename} get pods -A</code>.
          </Typography>
        </Paper>
      )}

      <Typography variant="subtitle2" sx={{ mb: 1 }}>Issued access</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={th}>Issued to</TableCell>
              <TableCell sx={th}>Service account</TableCell>
              <TableCell sx={th}>Created</TableCell>
              <TableCell sx={th} align="right">Revoke</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {identities.length === 0 ? (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                No read-only access issued for this cluster yet
              </TableCell></TableRow>
            ) : identities.map(idn => (
              <TableRow key={idn.service_account} hover>
                <TableCell sx={{ fontWeight: 600 }}>{idn.name}</TableCell>
                <TableCell sx={{ ...mono, fontSize: 12, color: 'text.secondary' }}>
                  {idn.service_account}
                  {idn.has_static_token && <Box component="span" sx={{ ml: 1, color: 'warning.main', fontSize: 11 }}>no expiry</Box>}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{new Date(idn.created_at).toLocaleDateString()}</TableCell>
                <TableCell align="right">
                  <Tooltip title={canManage ? `Revoke ${idn.name}'s access` : 'This cluster is registered with a credential that cannot manage RBAC'}>
                    <span>
                      <IconButton size="small" color="error" disabled={!canManage || !!loadError}
                        aria-label={`Revoke ${idn.name}'s access`} onClick={() => revoke(idn)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        Revoking deletes the ServiceAccount, which kills every token ever issued for it — including
        unexpired ones. Generating again for the same name issues an additional token; it does not
        invalidate the previous one.
      </Typography>
    </Modal>
  )
}
