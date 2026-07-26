import { memo } from 'react'
import { Zap, Pencil, Trash2, Bell, Terminal, Server, Clock } from 'lucide-react'

interface Rule {
  id: number; name: string; server_id: number;
  condition_type: string; condition_op: string; condition_value: string;
  action_type: string; action_command: string; severity: string; enabled: boolean;
  cooldown_minutes?: number;
  git_managed?: boolean;
}

interface RuleCardProps {
  rule: Rule;
  serverName: string;
  condColor: string;
  canManage: boolean;
  onEdit: (r: Rule) => void;
  onDelete: (id: number) => void;
  onToggle: (r: Rule) => void;
  confirmDelete: number | null;
  setConfirmDelete: (id: number | null) => void;
}

const METRIC_LABELS: Record<string, string> = {
  cpu: 'CPU', mem: 'Memory', disk: 'Disk', load: 'Load avg',
  log_keyword: 'Log keyword', pod_status: 'Failing pods',
}

const OP_SYMBOLS: Record<string, string> = { gt: '>', lt: '<', gte: '≥' }

function conditionText(rule: Rule): string {
  const metric = METRIC_LABELS[rule.condition_type] || rule.condition_type
  if (rule.condition_type === 'pod_status') return 'Any pod not Running / Succeeded'
  const unit = ['cpu', 'mem', 'disk'].includes(rule.condition_type) ? '%' : ''
  return `${metric} ${OP_SYMBOLS[rule.condition_op] || rule.condition_op} ${rule.condition_value}${unit}`
}

export const RuleCard = memo(({
  rule, serverName, condColor, canManage, onEdit, onDelete, onToggle, confirmDelete, setConfirmDelete,
}: RuleCardProps) => {
  const isCritical = rule.severity === 'critical'
  return (
    <div className="card fade-up hover-lift" style={{
      padding: 18, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
      background: 'var(--bg-card)', position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', gap: 14,
      opacity: rule.enabled ? 1 : 0.75,
    }}>
      {/* Accent bar keyed to the metric being watched */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: rule.enabled ? condColor : 'var(--border)' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Zap size={16} color={condColor} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 13.5, lineHeight: 1.3, wordBreak: 'break-word' }}>{rule.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 700 }}>
                <Server size={12} /> {serverName}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                padding: '1px 7px', borderRadius: 99,
                color: isCritical ? 'var(--danger)' : 'var(--warning)',
                border: `1px solid ${isCritical ? 'var(--danger)' : 'var(--warning)'}`,
              }}>
                {rule.severity || 'warning'}
              </span>
              {rule.git_managed && (
                <span
                  title="Created/updated by Git sync — editing this rule will stop future syncs from managing it"
                  style={{
                    fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                    padding: '1px 7px', borderRadius: 99,
                    color: 'var(--text-muted)', border: '1px solid var(--border)',
                  }}
                >
                  Git
                </span>
              )}
            </div>
          </div>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn-icon" title="Edit rule" onClick={() => onEdit(rule)} style={{ width: 30, height: 30 }}><Pencil size={14} /></button>
            {confirmDelete === rule.id ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  style={{ padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, background: 'var(--danger)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 800 }}
                  onClick={() => onDelete(rule.id)}
                >
                  Delete
                </button>
                <button
                  style={{ padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700 }}
                  onClick={() => setConfirmDelete(null)}
                >
                  Keep
                </button>
              </div>
            ) : (
              <button className="btn-icon danger" title="Delete rule" onClick={() => setConfirmDelete(rule.id)} style={{ width: 30, height: 30 }}><Trash2 size={14} /></button>
            )}
          </div>
        )}
      </div>

      {/* Condition → action */}
      <div style={{
        background: 'var(--bg-app)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', width: 34, flexShrink: 0 }}>If</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {conditionText(rule)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', width: 34, flexShrink: 0 }}>Then</span>
          {rule.action_type === 'ssh_command' && rule.action_command ? (
            <span title={rule.action_command} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
              fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
            }}>
              <Terminal size={12} style={{ flexShrink: 0, color: 'var(--warning)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.action_command}</span>
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 600 }}>
              <Bell size={12} style={{ color: condColor }} /> Notify only
            </span>
          )}
        </div>
      </div>

      {/* Footer: toggle + cooldown */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <button
          onClick={() => onToggle(rule)}
          title={rule.enabled ? 'Click to pause this rule' : 'Click to activate this rule'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
        >
          <span style={{
            width: 32, height: 18, borderRadius: 99, position: 'relative', flexShrink: 0,
            background: rule.enabled ? 'var(--success)' : 'var(--border-bright, var(--border))',
            transition: 'background 0.15s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: rule.enabled ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s',
            }} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: rule.enabled ? 'var(--success)' : 'var(--text-muted)' }}>
            {rule.enabled ? 'Active' : 'Paused'}
          </span>
        </button>
        <span title="Minimum time between firings" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
          <Clock size={12} /> {rule.cooldown_minutes || 5}m cooldown
        </span>
      </div>
    </div>
  )
})

RuleCard.displayName = 'RuleCard'
