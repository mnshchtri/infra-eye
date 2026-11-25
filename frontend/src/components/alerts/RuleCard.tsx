import { memo } from 'react'
import { Zap, Pencil, Trash2, Bell, Terminal, Server, Clock } from 'lucide-react'
import { Box, Button, Card, IconButton, Switch, Tooltip, Typography } from '@mui/material'
import { Badge } from '../ui'

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
  rule, serverName, canManage, onEdit, onDelete, onToggle, confirmDelete, setConfirmDelete,
}: RuleCardProps) => {
  const isCritical = rule.severity === 'critical'
  return (
    <Card sx={{
      p: 2, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 1.5,
      opacity: rule.enabled ? 1 : 0.75,
      // Neutral by default; a red edge only marks a critical rule.
      borderLeft: isCritical ? 3 : undefined, borderLeftColor: isCritical ? 'error.main' : undefined,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 1, border: 1, borderColor: 'divider', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'text.secondary' }}>
            <Zap size={16} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ wordBreak: 'break-word' }}>{rule.name}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                <Server size={12} /> {serverName}
              </Typography>
              <Badge variant={isCritical ? 'danger' : 'warning'}>{rule.severity || 'warning'}</Badge>
              {rule.git_managed && (
                <Badge variant="neutral" title="Created/updated by Git sync — editing this rule will stop future syncs from managing it">Git</Badge>
              )}
            </Box>
          </Box>
        </Box>
        {canManage && (
          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, alignItems: 'center' }}>
            <Tooltip title="Edit rule"><IconButton onClick={() => onEdit(rule)} aria-label="Edit rule"><Pencil size={14} /></IconButton></Tooltip>
            {confirmDelete === rule.id ? (
              <>
                <Button size="small" color="error" variant="contained" onClick={() => onDelete(rule.id)}>Delete</Button>
                <Button size="small" color="inherit" onClick={() => setConfirmDelete(null)}>Keep</Button>
              </>
            ) : (
              <Tooltip title="Delete rule"><IconButton color="error" onClick={() => setConfirmDelete(rule.id)} aria-label="Delete rule"><Trash2 size={14} /></IconButton></Tooltip>
            )}
          </Box>
        )}
      </Box>

      <Box sx={{ bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 34, flexShrink: 0, fontWeight: 700, textTransform: 'uppercase' }}>If</Typography>
          <Typography variant="body1" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{conditionText(rule)}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 34, flexShrink: 0, fontWeight: 700, textTransform: 'uppercase' }}>Then</Typography>
          {rule.action_type === 'ssh_command' && rule.action_command ? (
            <Tooltip title={rule.action_command}>
              <Typography variant="body2" noWrap sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0, fontFamily: 'var(--font-mono)' }}>
                <Terminal size={12} style={{ flexShrink: 0, color: 'var(--warning)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{rule.action_command}</span>
              </Typography>
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <Bell size={12} /> Notify only
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto' }}>
        <Tooltip title={rule.enabled ? 'Pause this rule' : 'Activate this rule'}>
          <Box component="label" sx={{ display: 'flex', alignItems: 'center', cursor: canManage ? 'pointer' : 'default' }}>
            <Switch checked={rule.enabled} onChange={() => onToggle(rule)} color="success" disabled={!canManage} />
            <Typography variant="body2" sx={{ fontWeight: 600, color: rule.enabled ? 'success.main' : 'text.secondary' }}>
              {rule.enabled ? 'Active' : 'Paused'}
            </Typography>
          </Box>
        </Tooltip>
        <Tooltip title="Minimum time between firings">
          <Typography variant="body2" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Clock size={12} /> {rule.cooldown_minutes || 5}m cooldown
          </Typography>
        </Tooltip>
      </Box>
    </Card>
  )
})

RuleCard.displayName = 'RuleCard'
