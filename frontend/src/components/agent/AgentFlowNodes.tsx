import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
  Target, Flag, CheckCircle2, XCircle,
  AlertTriangle, Loader, Clock, Check, X,
} from 'lucide-react'
import type { AgentStep } from '../../pages/agentTypes'
import { kindMeta, nodeColor } from './agentFlowMeta'



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

export const GoalFlowNode = memo(({ data }: { data: GoalNodeData }) => (
  <div
    style={{
      width: 220, borderRadius: 999, padding: '12px 18px',
      background: 'var(--brand-primary)', color: 'var(--text-inverse)',
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: data.selected ? '0 0 0 3px var(--brand-glow)' : '0 1px 3px rgba(0,0,0,0.15)',
      cursor: 'default',
    }}
  >
    <Target size={16} strokeWidth={2.4} style={{ flexShrink: 0 }} />
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85 }}>Goal</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.goal}</div>
    </div>
    <Handle type="source" position={Position.Right} style={{ background: 'var(--brand-primary)', border: 'none', width: 8, height: 8 }} />
  </div>
))
GoalFlowNode.displayName = 'GoalFlowNode'

export const StepFlowNode = memo(({ data }: { data: StepNodeData }) => {
  const { step, selected, isBusy, onApprove, onReject } = data
  const color = nodeColor(step)
  const meta = kindMeta(step.kind)
  const isFinal = step.kind === 'final_answer'
  const Icon = step.status === 'failed' ? AlertTriangle
    : step.status === 'rejected' ? XCircle
    : isFinal ? Flag
    : step.status === 'executed' ? CheckCircle2
    : step.status === 'pending_approval' ? Clock
    : meta.icon

  return (
    <div
      style={{
        width: 230, borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)',
        border: `1.5px solid ${selected ? color : 'var(--border)'}`,
        boxShadow: selected ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : '0 1px 3px rgba(0,0,0,0.1)',
        overflow: 'hidden', cursor: 'pointer', position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: 'none', width: 8, height: 8 }} />
      {/* Status accent strip, matching the Infra Map card language */}
      <div style={{ position: 'absolute', left: 0, top: 9, bottom: 9, width: 3.5, borderRadius: 1.75, background: color }} />
      {step.status === 'pending_approval' && (
        <span style={{
          position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%',
          background: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 25%, transparent)`,
        }} className="agent-node-pulse" />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <div style={{
          width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-card)', border: `1.5px solid ${color}`, color,
        }}>
          <Icon size={12.5} strokeWidth={2.6} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>STEP {step.step_number}</div>
          <div style={{ fontSize: 12, fontWeight: 800, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</div>
        </div>
      </div>
      <div style={{ padding: '9px 12px' }}>
        {step.tool_name ? (
          <code style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: '3px 7px', borderRadius: 6, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.tool_name}
          </code>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(step.reasoning || '').slice(0, 60) || 'Mission complete'}
          </div>
        )}
      </div>
      {step.status === 'pending_approval' && (
        <div
          className="nodrag"
          style={{ display: 'flex', gap: 6, padding: '0 10px 10px' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            disabled={isBusy}
            onClick={() => onApprove(step.id)}
            title="Approve & run"
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 8px', borderRadius: 7,
              background: 'var(--brand-primary)', color: 'var(--text-inverse)', border: 'none', fontSize: 11, fontWeight: 800,
              cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.6 : 1,
            }}
          >
            {isBusy ? <Loader size={11} className="spin" /> : <Check size={11} strokeWidth={3} />}
            Approve
          </button>
          <button
            disabled={isBusy}
            onClick={() => onReject(step.id)}
            title="Reject"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 9px', borderRadius: 7,
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
              cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.6 : 1,
            }}
          >
            <X size={11} strokeWidth={3} />
          </button>
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color, border: 'none', width: 8, height: 8 }} />
    </div>
  )
})
StepFlowNode.displayName = 'StepFlowNode'

export const ThinkingFlowNode = memo(() => (
  <div style={{
    width: 190, borderRadius: 'var(--radius-lg)', padding: '12px 14px',
    background: 'var(--bg-card)', border: '1.5px dashed var(--brand-primary)',
    display: 'flex', alignItems: 'center', gap: 9,
  }}>
    <Handle type="target" position={Position.Left} style={{ background: 'var(--brand-primary)', border: 'none', width: 8, height: 8 }} />
    <Loader size={14} className="spin" color="var(--brand-primary)" />
    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-primary)' }}>Deciding next step…</span>
  </div>
))
ThinkingFlowNode.displayName = 'ThinkingFlowNode'
