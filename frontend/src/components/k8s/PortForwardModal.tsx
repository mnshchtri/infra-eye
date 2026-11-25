import React, { useState, useEffect } from 'react'
import { ExternalLink, Globe, Trash2, ArrowRight } from 'lucide-react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { apiError } from '../../utils/errors'

export interface PortForwardSession {
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
  // Seeded once, in the state initialiser, so a re-render doesn't reshuffle
  // the port the user is looking at.

  const [form, setForm] = useState(() => ({ 
    namespace: initialNamespace || 'default', 
    target: initialTarget || '', 
    local_port: '', 
    remote_port: initialPort || '',
    ...(initialPort ? { local_port: getSuggestedPort() } : {}),
  }))
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

        setForm(prev => ({ ...prev, target: '', local_port: '', remote_port: '' }))
        onRefresh()
      }
    } catch (e: unknown) {
      toast.error('Port-forward failed', apiError(e) || 'Check if the port is already in use')
    } finally {
      setBusy(false)
    }
  }

  const stopPortForward = async (id: string) => {
    try {
      await api.delete(`/api/servers/${serverID}/kubectl/port-forward/${id}`)
      toast.success('Tunnel closed', `Session ${id.slice(0, 8)}... terminated`)
      onRefresh()
    } catch (e: unknown) {
      toast.error('Stop failed', apiError(e) || 'Unable to stop port-forward')
    }
  }

  const getForwardUrl = (port: number) => {
    const host = window.location.hostname;
    return `http://${host}:${port}`;
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      icon={Globe}
      title="Port forward manager"
      subtitle={`${sessions.length} active ${sessions.length === 1 ? 'tunnel' : 'tunnels'}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <Box component="form" onSubmit={createPortForward} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '1.2fr 2fr 1fr 1fr auto' }, gap: 2, mb: 3, alignItems: 'start' }}>
        <Input label="Namespace" placeholder="default" value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} required />
        <Input label="Target resource" placeholder="svc/name or pod/name" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required />
        <Input label="Local port" placeholder="8080" value={form.local_port} onChange={(e) => setForm({ ...form, local_port: e.target.value })} required />
        <Input label="Remote port" placeholder="80" value={form.remote_port} onChange={(e) => setForm({ ...form, remote_port: e.target.value })} required />
        <Button type="submit" loading={busy} style={{ height: 40 }}>{busy ? 'Establishing...' : 'Start tunnel'}</Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow>
              {['Target resource', 'Namespace', 'Tunnel mapping', 'Process', 'Status'].map(h => <TableCell key={h} sx={{ fontWeight: 600, color: 'text.secondary' }}>{h}</TableCell>)}
              <TableCell align="right" sx={{ fontWeight: 600, color: 'text.secondary' }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.length === 0 ? (
              <TableRow><TableCell colSpan={6}>
                <EmptyState icon={Globe} title="No active port forwards" description="Create a new tunnel using the form above or the dashboard actions." />
              </TableCell></TableRow>
            ) : sessions.map((s: PortForwardSession) => (
              <TableRow key={s.id} hover>
                <TableCell sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.target}</TableCell>
                <TableCell>{s.namespace}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontFamily: 'var(--font-mono)' }}>
                    <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>{s.local_port}</Box>
                    <ArrowRight size={13} />
                    <Box component="span" sx={{ color: 'text.secondary' }}>{s.remote_port}</Box>
                  </Box>
                </TableCell>
                <TableCell sx={{ fontFamily: 'var(--font-mono)', color: 'text.secondary' }}>{s.pid}</TableCell>
                <TableCell><Chip size="small" color="success" label="Active" /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Open endpoint">
                    <IconButton size="small" component="a" href={getForwardUrl(s.local_port)} target="_blank" rel="noreferrer" aria-label={`Open endpoint for ${s.target}`}>
                      <ExternalLink size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Terminate session">
                    <IconButton size="small" color="error" onClick={() => stopPortForward(s.id)} aria-label={`Terminate session for ${s.target}`}>
                      <Trash2 size={16} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Modal>
  )
}
