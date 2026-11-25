import React, { useState, useRef, useCallback } from 'react'
import { Terminal, Shield, CloudUpload, Activity, ChevronDown } from 'lucide-react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import ButtonBase from '@mui/material/ButtonBase'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/Input'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import type { FolderItem } from '../../hooks/useFolders'
import { apiError } from '../../utils/errors'

interface AddClusterModalProps {
  onClose: () => void;
  onSuccess: () => void;
  folders?: FolderItem[];
}

type InputMode = 'paste' | 'upload';

export function AddClusterModal({ onClose, onSuccess, folders = [] }: AddClusterModalProps) {
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
    kube_config: '',
    folder_id: '' as number | ''
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
    } catch (e: unknown) {
      setTestResult({ success: false, msg: apiError(e) || 'Connection failed' })
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
      const payload: Record<string, unknown> = {
        name: form.name,
        kube_config: form.kube_config,
        auth_type: 'password',
        tags: 'kubernetes',
        is_k8s: true,
      }
      if (form.host)         payload.host         = form.host
      if (form.ssh_user && form.ssh_user !== 'root') payload.ssh_user = form.ssh_user
      if (form.ssh_password) payload.ssh_password = form.ssh_password
      if (form.folder_id)    payload.folder_id    = form.folder_id

      await api.post('/api/servers', payload)
      useToastStore.getState().success('Cluster Connected', `${form.name} integrated`)
      onSuccess()
      onClose()
    } catch (e: unknown) {
      useToastStore.getState().error('Failed', apiError(e) || 'Could not add cluster')
    } finally {
      setLoading(false)
    }
  }

  const hasConfig = form.kube_config.trim().length > 0

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="md"
      icon={Activity}
      title="Connect cluster"
      subtitle="Provide a kubeconfig to register a Kubernetes cluster."
      footer={
        <>
          <Button variant="secondary" onClick={testConnection} disabled={loading || !hasConfig}>Test connection</Button>
          <Button type="submit" form="add-cluster-form" loading={loading} disabled={!hasConfig || !form.name}>Connect cluster</Button>
        </>
      }
    >
      <Box component="form" id="add-cluster-form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Input
          label="Cluster name"
          placeholder="e.g. production-main"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          required
        />

        <Select
          label="Folder"
          value={form.folder_id}
          onChange={e => setForm({ ...form, folder_id: e.target.value ? Number(e.target.value) : '' })}
          options={[{ value: '', label: 'No folder' }, ...folders.map(f => ({ value: String(f.id), label: f.name }))]}
        />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2">Kubeconfig source *</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={inputMode}
              onChange={(_, mode: InputMode | null) => { if (mode) { setInputMode(mode); if (mode === 'paste') setUploadedFileName(null) } }}
              aria-label="Kubeconfig source"
            >
              <ToggleButton value="paste">Paste</ToggleButton>
              <ToggleButton value="upload">Upload</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {inputMode === 'paste' ? (
            <Textarea
              rows={8}
              aria-label="Kubeconfig YAML"
              placeholder="Paste kubeconfig YAML here"
              value={form.kube_config}
              onChange={e => setForm({ ...form, kube_config: e.target.value })}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          ) : (
            <ButtonBase
              component="div"
              onDrop={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) loadFileContent(file) }}
              onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              sx={{
                height: 180, width: '100%', flexDirection: 'column', gap: 1, borderRadius: 1,
                border: 1, borderStyle: 'dashed', borderColor: isDragging ? 'primary.main' : 'divider',
                bgcolor: isDragging ? 'action.hover' : 'transparent',
              }}
            >
              <CloudUpload size={24} />
              <Typography variant="body2">
                {uploadedFileName || (isDragging ? 'Release to load' : 'Drag a file here or click to upload')}
              </Typography>
              <input type="file" aria-label="Kubeconfig file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept=".yaml,.yml,.conf,config" />
            </ButtonBase>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
            <Shield size={14} />
            <Typography variant="caption">The kubeconfig is stored encrypted on the server.</Typography>
          </Box>
        </Box>

        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <ButtonBase
            onClick={() => setShowSSH(!showSSH)}
            aria-expanded={showSSH}
            sx={{ width: '100%', px: 2, py: 1.25, display: 'flex', justifyContent: 'space-between', borderRadius: 1 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Terminal size={14} />
              <Typography variant="subtitle2">SSH proxy <Typography component="span" variant="caption" color="text.secondary">(optional)</Typography></Typography>
            </Box>
            <ChevronDown size={16} style={{ transform: showSSH ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </ButtonBase>
          <Collapse in={showSSH} unmountOnExit>
            <Box sx={{ px: 2, pb: 2, pt: 1, display: 'flex', flexDirection: 'column', gap: 2, borderTop: 1, borderColor: 'divider' }}>
              <Input label="Node gateway IP" placeholder="10.0.0.1" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <Input label="SSH user" value={form.ssh_user} onChange={e => setForm({ ...form, ssh_user: e.target.value })} />
                <Input label="SSH password" type="password" value={form.ssh_password} onChange={e => setForm({ ...form, ssh_password: e.target.value })} />
              </Box>
            </Box>
          </Collapse>
        </Box>

        {testResult && (
          <Alert severity={testResult.success ? 'success' : 'error'} sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {testResult.msg}
          </Alert>
        )}
      </Box>
    </Modal>
  )
}
