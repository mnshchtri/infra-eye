import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ChevronDown, Server, Cpu, Target, Rocket, Loader } from 'lucide-react'
import type { ServerData } from '../../pages/agentTypes'

export type AgentProvider = 'claude' | 'local' | 'openrouter' | 'mistral'

const PROVIDER_OPTIONS: { value: AgentProvider; label: string }[] = [
  { value: 'claude', label: 'Claude (requires API key)' },
  { value: 'openrouter', label: 'OpenRouter (requires API key)' },
  { value: 'mistral', label: 'Mistral (requires API key)' },
  { value: 'local', label: 'Local LLM (self-hosted, no API key)' },
]

const selectStyle: React.CSSProperties = {
  height: 34, padding: '0 26px 0 10px', borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700,
  cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none', width: '100%',
}

function ConfigCard({ icon: Icon, label, children, width = 240 }: { icon: React.ElementType; label: string; children: React.ReactNode; width?: number }) {
  return (
    <div style={{
      width, borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)',
      border: '1.5px solid var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
        <Icon size={13} color="var(--brand-primary)" strokeWidth={2.4} />
        <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div className="nodrag nopan" style={{ padding: '10px 12px' }}>
        {children}
      </div>
    </div>
  )
}

export interface ServerNodeData extends Record<string, unknown> {
  servers: ServerData[]
  selectedServer: number | ''
  onChange: (id: number | '') => void
}

export const ServerConfigNode = memo(({ data }: { data: ServerNodeData }) => (
  <ConfigCard icon={Server} label="Target server">
    <div style={{ position: 'relative' }}>
      <select value={data.selectedServer} onChange={e => data.onChange(Number(e.target.value) || '')} style={selectStyle}>
        <option value="">Select a server…</option>
        {data.servers.map(s => <option key={s.id} value={s.id}>{s.is_k8s ? '☸ ' : ''}{s.name}</option>)}
      </select>
      <ChevronDown size={12} color="var(--text-muted)" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
    </div>
    <Handle type="source" position={Position.Right} style={{ background: 'var(--border)', border: 'none', width: 8, height: 8 }} />
  </ConfigCard>
))
ServerConfigNode.displayName = 'ServerConfigNode'

export interface ProviderNodeData extends Record<string, unknown> {
  provider: AgentProvider
  onChange: (p: AgentProvider) => void
}

export const ProviderConfigNode = memo(({ data }: { data: ProviderNodeData }) => (
  <ConfigCard icon={Cpu} label="Model provider">
    <div style={{ position: 'relative' }}>
      <select value={data.provider} onChange={e => data.onChange(e.target.value as AgentProvider)} style={selectStyle}>
        {PROVIDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} color="var(--text-muted)" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
    </div>
    <Handle type="target" position={Position.Left} style={{ background: 'var(--border)', border: 'none', width: 8, height: 8 }} />
    <Handle type="source" position={Position.Right} style={{ background: 'var(--border)', border: 'none', width: 8, height: 8 }} />
  </ConfigCard>
))
ProviderConfigNode.displayName = 'ProviderConfigNode'

export interface GoalNodeData extends Record<string, unknown> {
  goal: string
  onChange: (goal: string) => void
  disabled: boolean
}

export const GoalConfigNode = memo(({ data }: { data: GoalNodeData }) => (
  <ConfigCard icon={Target} label="Goal" width={300}>
    <textarea
      value={data.goal}
      onChange={e => data.onChange(e.target.value)}
      placeholder='e.g. "restart the nginx service" or "scale the checkout deployment to 3 replicas"'
      rows={4}
      disabled={data.disabled}
      className="nowheel"
      style={{
        width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        color: 'var(--text-primary)', fontSize: 12.5, padding: '8px 10px', resize: 'vertical', lineHeight: 1.6, outline: 'none',
        fontFamily: 'inherit', boxSizing: 'border-box',
      }}
    />
    <Handle type="target" position={Position.Left} style={{ background: 'var(--border)', border: 'none', width: 8, height: 8 }} />
    <Handle type="source" position={Position.Right} style={{ background: 'var(--border)', border: 'none', width: 8, height: 8 }} />
  </ConfigCard>
))
GoalConfigNode.displayName = 'GoalConfigNode'

export interface TriggerNodeData extends Record<string, unknown> {
  isLaunchable: boolean
  starting: boolean
  onLaunch: () => void
}

export const TriggerConfigNode = memo(({ data }: { data: TriggerNodeData }) => (
  <div
    className="nodrag nopan"
    style={{
      width: 190, borderRadius: 'var(--radius-lg)', padding: '14px 16px',
      background: data.isLaunchable ? 'var(--brand-glow)' : 'var(--bg-card)',
      border: `1.5px solid ${data.isLaunchable ? 'var(--brand-primary)' : 'var(--border)'}`,
      display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
    }}
  >
    <Handle type="target" position={Position.Left} style={{ background: 'var(--border)', border: 'none', width: 8, height: 8 }} />
    <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trigger</span>
    <button
      onClick={data.onLaunch}
      disabled={!data.isLaunchable}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        height: 36, borderRadius: 'var(--radius-md)', border: 'none', fontSize: 13, fontWeight: 800,
        background: data.isLaunchable ? 'var(--brand-primary)' : 'var(--bg-elevated)',
        color: data.isLaunchable ? 'var(--text-inverse)' : 'var(--text-muted)',
        cursor: data.isLaunchable ? 'pointer' : 'default',
      }}
    >
      {data.starting ? <Loader size={14} className="spin" /> : <Rocket size={14} />}
      {data.starting ? 'Launching…' : 'Launch Agent'}
    </button>
  </div>
))
TriggerConfigNode.displayName = 'TriggerConfigNode'
