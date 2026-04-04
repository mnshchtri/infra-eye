import React, { memo } from 'react'
import { Zap, Activity, Pencil, Trash2, Cpu, Database, LayoutGrid } from 'lucide-react'

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
    <div className="card fade-up hover-lift" style={{ padding: 24, borderRadius: 0, border: '1px solid var(--border)', background: 'var(--bg-card)', position: 'relative' }}>
      {/* Decorative vertical bar for status */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: rule.enabled ? condColor : 'var(--border)' }} />
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ 
            width: 40, height: 40, borderRadius: 0, background: 'var(--bg-elevated)', 
            border: `1px solid var(--border)`, display: 'flex', alignItems: 'center', justifyContent: 'center' 
          }}>
            <Zap size={18} color={condColor} />
          </div>
          <div>
            <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: 13, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{rule.name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{serverName}</div>
          </div>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn-icon" onClick={() => onEdit(rule)} style={{ borderRadius: 0, width: 32, height: 32 }}><Pencil size={14} /></button>
            {confirmDelete === rule.id ? (
              <div style={{ display: 'flex', gap: 1 }}>
                <button
                  style={{ padding: '4px 10px', borderRadius: 0, fontSize: 9, background: 'var(--danger)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 900, textTransform: 'uppercase' }}
                  onClick={() => onDelete(rule.id)}
                >
                  Confirm
                </button>
                <button
                  style={{ padding: '4px 10px', borderRadius: 0, fontSize: 9, background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 900, textTransform: 'uppercase' }}
                  onClick={() => setConfirmDelete(null)}
                >
                  No
                </button>
              </div>
            ) : (
              <button className="btn-icon danger" onClick={() => setConfirmDelete(rule.id)} style={{ borderRadius: 0, width: 32, height: 32 }}><Trash2 size={14} /></button>
            )}
          </div>
        )}
      </div>

      <div style={{ 
        display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-app)', 
        padding: '12px 16px', borderRadius: 0, border: '1px solid var(--border)', marginBottom: 20 
      }}>
        <Activity size={12} color={condColor} />
        <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
          {rule.condition_type} {rule.condition_op === 'gt' ? '>' : rule.condition_op === 'lt' ? '<' : '>='} {rule.condition_value}
        </span>
      </div>

      <div 
        onClick={() => onToggle(rule)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: rule.enabled ? 'var(--success)' : 'var(--text-muted)', boxShadow: rule.enabled ? '0 0 8px var(--success)' : 'none' }} />
        <span style={{ fontSize: 9, fontWeight: 900, color: rule.enabled ? 'var(--success)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
          {rule.enabled ? 'Remediation Active' : 'Rule Isolated'}
        </span>
      </div>
    </div>
  )
})

RuleCard.displayName = 'RuleCard'
