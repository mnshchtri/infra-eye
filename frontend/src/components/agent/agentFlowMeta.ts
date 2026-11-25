import {
  Terminal, Boxes, Flag, Ban,
} from 'lucide-react'
import type { Theme } from '@mui/material/styles'
import type { AgentStep } from '../../pages/agentTypes'

// Split out of AgentFlowNodes so that module exports only components — mixing
// components and plain helpers in one file breaks Fast Refresh.

export function kindMeta(kind: AgentStep['kind'], theme: Theme) {
  switch (kind) {
    case 'ssh_command': return { label: 'SSH command', icon: Terminal, color: theme.palette.info.main }
    case 'mcp_tool': return { label: 'Kubernetes / MCP', icon: Boxes, color: theme.palette.primary.main }
    case 'unknown_tool': return { label: 'Unknown tool', icon: Ban, color: theme.palette.error.main }
    default: return { label: 'Final answer', icon: Flag, color: theme.palette.success.main }
  }
}

export function nodeColor(step: AgentStep, theme: Theme): string {
  if (step.kind === 'final_answer') return theme.palette.success.main
  switch (step.status) {
    case 'pending_approval': return theme.palette.warning.main
    case 'executed': return theme.palette.success.main
    case 'failed': return theme.palette.error.main
    case 'rejected': return theme.palette.text.disabled
    default: return kindMeta(step.kind, theme).color
  }
}
