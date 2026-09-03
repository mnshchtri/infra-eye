import {
  Terminal, Boxes, Flag, Ban,
} from 'lucide-react'
import type { AgentStep } from '../../pages/agentTypes'

// Split out of AgentFlowNodes so that module exports only components — mixing
// components and plain helpers in one file breaks Fast Refresh.

export function kindMeta(kind: AgentStep['kind']) {
  switch (kind) {
    case 'ssh_command': return { label: 'SSH command', icon: Terminal, color: 'var(--info, #3b82f6)' }
    case 'mcp_tool': return { label: 'Kubernetes / MCP', icon: Boxes, color: 'var(--brand-primary)' }
    case 'unknown_tool': return { label: 'Unknown tool', icon: Ban, color: 'var(--danger)' }
    default: return { label: 'Final answer', icon: Flag, color: 'var(--success)' }
  }
}

export function nodeColor(step: AgentStep): string {
  if (step.kind === 'final_answer') return 'var(--success)'
  switch (step.status) {
    case 'pending_approval': return 'var(--warning, #d97706)'
    case 'executed': return 'var(--success)'
    case 'failed': return 'var(--danger)'
    case 'rejected': return 'var(--text-muted)'
    default: return kindMeta(step.kind).color
  }
}
