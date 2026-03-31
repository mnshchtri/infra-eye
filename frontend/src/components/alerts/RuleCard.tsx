import React, { memo } from 'react'
import { Zap, Activity, Pencil, Trash2 } from 'lucide-react'

interface Rule {
  id: number; name: string; server_id: number;
  condition_type: string; condition_op: string; condition_value: string;
  action_type: string; action_command: string; severity: string; enabled: boolean;
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

export const RuleCard = memo(({ 
  rule, serverName, condColor, canManage, onEdit, onDelete, onToggle, confirmDelete, setConfirmDelete 
}: RuleCardProps) => {
  return (
    <div className="card fade-up" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `${condColor}10`, border: `1px solid ${condColor}25`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={18} color={condColor} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{rule.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{serverName}</div>
          </div>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-icon" onClick={() => onEdit(rule)}><Pencil size={16} /></button>
            {confirmDelete === rule.id ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'var(--danger)', border: 'none', color: 'var(--text-inverse)', cursor: 'pointer', fontWeight: 700 }}
                  onClick={() => onDelete(rule.id)}
                >
                  Confirm
                </button>
                <button
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn-icon danger" onClick={() => setConfirmDelete(rule.id)}><Trash2 size={16} /></button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-app)', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 16 }}>
        <Activity size={14} color={condColor} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {rule.condition_type.toUpperCase()} {rule.condition_op === 'gt' ? '>' : rule.condition_op === 'lt' ? '<' : '>='} {rule.condition_value}
        </span>
      </div>

      <div 
        onClick={() => onToggle(rule)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, color: rule.enabled ? 'var(--success)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        {rule.enabled ? 'RULE ACTIVE' : 'RULE DISABLED'}
      </div>
    </div>
  )
})

RuleCard.displayName = 'RuleCard'
