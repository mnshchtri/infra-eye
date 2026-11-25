import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Server, Cpu, Target, Rocket, Loader } from 'lucide-react'
import { Box, Button as MuiButton, MenuItem, TextField, Typography, alpha, useTheme } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import type { ServerData } from '../../pages/agentTypes'

export type AgentProvider = 'claude' | 'local' | 'openrouter' | 'mistral'

const spin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`

const PROVIDER_OPTIONS: { value: AgentProvider; label: string }[] = [
  { value: 'claude', label: 'Claude (requires API key)' },
  { value: 'openrouter', label: 'OpenRouter (requires API key)' },
  { value: 'mistral', label: 'Mistral (requires API key)' },
  { value: 'local', label: 'Local LLM (self-hosted, no API key)' },
]

function ConfigCard({ icon: Icon, label, children, width = 240 }: { icon: React.ElementType; label: string; children: React.ReactNode; width?: number }) {
  return (
    <Box sx={{ width, borderRadius: 1.5, bgcolor: 'background.paper', border: '1.5px solid', borderColor: 'divider', boxShadow: 1, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875, px: 1.5, py: 1.125, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', color: 'primary.main' }}>
        <Icon size={13} strokeWidth={2.4} />
        <Typography component="span" sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
      </Box>
      <Box className="nodrag nopan" sx={{ px: 1.5, py: 1.25 }}>
        {children}
      </Box>
    </Box>
  )
}

const handleSx = (color: string) => ({ background: color, border: 'none', width: 8, height: 8 })

export interface ServerNodeData extends Record<string, unknown> {
  servers: ServerData[]
  selectedServer: number | ''
  onChange: (id: number | '') => void
}

export const ServerConfigNode = memo(({ data }: { data: ServerNodeData }) => {
  const theme = useTheme()
  return (
    <ConfigCard icon={Server} label="Target server">
      <TextField
        select
        fullWidth
        value={data.selectedServer === '' ? '' : String(data.selectedServer)}
        onChange={e => data.onChange(Number(e.target.value) || '')}
        slotProps={{ select: { displayEmpty: true, SelectDisplayProps: { 'aria-label': 'Target server' } } }}
      >
        <MenuItem value="">Select a server…</MenuItem>
        {data.servers.map(s => <MenuItem key={s.id} value={String(s.id)}>{s.is_k8s ? '☸ ' : ''}{s.name}</MenuItem>)}
      </TextField>
      <Handle type="source" position={Position.Right} style={handleSx(theme.palette.divider)} />
    </ConfigCard>
  )
})
ServerConfigNode.displayName = 'ServerConfigNode'

export interface ProviderNodeData extends Record<string, unknown> {
  provider: AgentProvider
  onChange: (p: AgentProvider) => void
}

export const ProviderConfigNode = memo(({ data }: { data: ProviderNodeData }) => {
  const theme = useTheme()
  return (
    <ConfigCard icon={Cpu} label="Model provider">
      <TextField
        select
        fullWidth
        value={data.provider}
        onChange={e => data.onChange(e.target.value as AgentProvider)}
        slotProps={{ select: { SelectDisplayProps: { 'aria-label': 'Model provider' } } }}
      >
        {PROVIDER_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
      <Handle type="target" position={Position.Left} style={handleSx(theme.palette.divider)} />
      <Handle type="source" position={Position.Right} style={handleSx(theme.palette.divider)} />
    </ConfigCard>
  )
})
ProviderConfigNode.displayName = 'ProviderConfigNode'

export interface GoalNodeData extends Record<string, unknown> {
  goal: string
  onChange: (goal: string) => void
  disabled: boolean
}

export const GoalConfigNode = memo(({ data }: { data: GoalNodeData }) => {
  const theme = useTheme()
  return (
    <ConfigCard icon={Target} label="Goal" width={300}>
      <TextField
        multiline
        fullWidth
        minRows={4}
        maxRows={8}
        value={data.goal}
        onChange={e => data.onChange(e.target.value)}
        placeholder='e.g. "restart the nginx service" or "scale the checkout deployment to 3 replicas"'
        disabled={data.disabled}
        className="nowheel"
        slotProps={{ htmlInput: { 'aria-label': 'Goal' } }}
      />
      <Handle type="target" position={Position.Left} style={handleSx(theme.palette.divider)} />
      <Handle type="source" position={Position.Right} style={handleSx(theme.palette.divider)} />
    </ConfigCard>
  )
})
GoalConfigNode.displayName = 'GoalConfigNode'

export interface TriggerNodeData extends Record<string, unknown> {
  isLaunchable: boolean
  starting: boolean
  onLaunch: () => void
}

export const TriggerConfigNode = memo(({ data }: { data: TriggerNodeData }) => {
  const theme = useTheme()
  return (
    <Box
      className="nodrag nopan"
      sx={{
        width: 190, borderRadius: 1.5, px: 2, py: 1.75,
        bgcolor: data.isLaunchable ? alpha(theme.palette.primary.main, 0.08) : 'background.paper',
        border: '1.5px solid', borderColor: data.isLaunchable ? 'primary.main' : 'divider',
        display: 'flex', flexDirection: 'column', gap: 1, position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={handleSx(theme.palette.divider)} />
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>Trigger</Typography>
      <MuiButton
        variant="contained"
        onClick={data.onLaunch}
        disabled={!data.isLaunchable}
        startIcon={data.starting ? <Loader size={14} style={{ animation: `${spin} 1s linear infinite` }} /> : <Rocket size={14} />}
        sx={{ height: 36 }}
      >
        {data.starting ? 'Launching…' : 'Launch agent'}
      </MuiButton>
    </Box>
  )
})
TriggerConfigNode.displayName = 'TriggerConfigNode'
