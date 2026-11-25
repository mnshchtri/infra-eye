import { memo } from 'react'
import { Box, Button as MuiButton, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { Handle, Position } from '@xyflow/react'
import {
  Target, Flag, CheckCircle2, XCircle,
  AlertTriangle, Loader, Clock, Check, X,
} from 'lucide-react'
import type { AgentStep } from '../../pages/agentTypes'
import { kindMeta, nodeColor } from './agentFlowMeta'


const spin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`
const pulse = keyframes`0%, 100% { opacity: 1; } 50% { opacity: 0.35; }`

export interface GoalNodeData extends Record<string, unknown> {
  kind: 'goal'
  goal: string
  selected: boolean
}

export interface StepNodeData extends Record<string, unknown> {
  kind: 'step'
  step: AgentStep
  selected: boolean
  isBusy: boolean
  onApprove: (id: number) => void
  onReject: (id: number) => void
}

export interface ThinkingNodeData extends Record<string, unknown> {
  kind: 'thinking'
}

const handleSx = (color: string) => ({ background: color, border: 'none', width: 8, height: 8 })

export const GoalFlowNode = memo(({ data }: { data: GoalNodeData }) => {
  const theme = useTheme()
  return (
    <Box
      sx={{
        width: 220, borderRadius: 999, px: 2.25, py: 1.5,
        bgcolor: 'primary.main', color: 'primary.contrastText',
        display: 'flex', alignItems: 'center', gap: 1.25,
        boxShadow: data.selected ? `0 0 0 3px ${alpha(theme.palette.primary.main, 0.3)}` : 1,
        cursor: 'default',
      }}
    >
      <Target size={16} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, opacity: 0.85, lineHeight: 1.3 }}>Goal</Typography>
        <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 }}>{data.goal}</Typography>
      </Box>
      <Handle type="source" position={Position.Right} style={handleSx(theme.palette.primary.main)} />
    </Box>
  )
})
GoalFlowNode.displayName = 'GoalFlowNode'

export const StepFlowNode = memo(({ data }: { data: StepNodeData }) => {
  const theme = useTheme()
  const { step, selected, isBusy, onApprove, onReject } = data
  const color = nodeColor(step, theme)
  const meta = kindMeta(step.kind, theme)
  const isFinal = step.kind === 'final_answer'
  const Icon = step.status === 'failed' ? AlertTriangle
    : step.status === 'rejected' ? XCircle
    : isFinal ? Flag
    : step.status === 'executed' ? CheckCircle2
    : step.status === 'pending_approval' ? Clock
    : meta.icon

  return (
    <Box
      sx={{
        width: 230, borderRadius: 1.5, bgcolor: 'background.paper',
        border: '1.5px solid', borderColor: selected ? color : 'divider',
        boxShadow: selected ? `0 0 0 3px ${alpha(color, 0.22)}` : 1,
        overflow: 'hidden', cursor: 'pointer', position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={handleSx(color)} />
      {/* Status accent strip, matching the Infra Map card language */}
      <Box sx={{ position: 'absolute', left: 0, top: 9, bottom: 9, width: 3.5, borderRadius: '2px', bgcolor: color }} />
      {step.status === 'pending_approval' && (
        <Box component="span" sx={{
          position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%',
          bgcolor: color, boxShadow: `0 0 0 4px ${alpha(color, 0.25)}`,
          animation: `${pulse} 1.4s ease-in-out infinite`,
        }} />
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.25, pr: 1.5, pl: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
        <Box sx={{
          width: 24, height: 24, borderRadius: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: 'background.paper', border: '1.5px solid', borderColor: color, color,
        }}>
          <Icon size={12.5} strokeWidth={2.6} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.3 }}>Step {step.step_number}</Typography>
          <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, color, lineHeight: 1.4 }}>{meta.label}</Typography>
        </Box>
      </Box>
      <Box sx={{ px: 1.5, py: 1.25 }}>
        {step.tool_name ? (
          <Box component="code" sx={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'text.secondary', bgcolor: 'action.hover', px: 0.875, py: 0.375, borderRadius: 0.75, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
            {step.tool_name}
          </Box>
        ) : (
          <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.5 }}>
            {(step.reasoning || '').slice(0, 60) || 'Mission complete'}
          </Typography>
        )}
      </Box>
      {step.status === 'pending_approval' && (
        <Box
          className="nodrag"
          sx={{ display: 'flex', gap: 0.75, px: 1.25, pb: 1.25 }}
          onClick={e => e.stopPropagation()}
        >
          <MuiButton
            variant="contained"
            size="small"
            disabled={isBusy}
            onClick={() => onApprove(step.id)}
            aria-label={`Approve step ${step.step_number}`}
            startIcon={isBusy ? <Loader size={11} style={{ animation: `${spin} 1s linear infinite` }} /> : <Check size={11} strokeWidth={3} />}
            sx={{ flex: 1 }}
          >
            Approve
          </MuiButton>
          <Tooltip title="Reject">
            <span>
              <IconButton
                disabled={isBusy}
                onClick={() => onReject(step.id)}
                aria-label={`Reject step ${step.step_number}`}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, height: '100%' }}
              >
                <X size={11} strokeWidth={3} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
      <Handle type="source" position={Position.Right} style={handleSx(color)} />
    </Box>
  )
})
StepFlowNode.displayName = 'StepFlowNode'

export const ThinkingFlowNode = memo(() => {
  const theme = useTheme()
  const main = theme.palette.primary.main
  return (
    <Box sx={{
      width: 190, borderRadius: 1.5, px: 1.75, py: 1.5,
      bgcolor: 'background.paper', border: '1.5px dashed', borderColor: 'primary.main',
      display: 'flex', alignItems: 'center', gap: 1.25,
    }}>
      <Handle type="target" position={Position.Left} style={handleSx(main)} />
      <Loader size={14} color={main} style={{ animation: `${spin} 1s linear infinite` }} />
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'primary.main' }}>Deciding next step…</Typography>
    </Box>
  )
})
ThinkingFlowNode.displayName = 'ThinkingFlowNode'
