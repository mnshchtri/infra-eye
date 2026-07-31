import { memo, useState } from 'react'
import { format } from 'date-fns'
import { CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Badge } from '../ui'

interface HistoryAction {
  id: number; created_at: string; server_id: number; trigger_info: string;
  command: string; output: string; status: string;
}

interface HistoryRowProps {
  history: HistoryAction;
  serverName: string;
}

const STATUS_STYLES: Record<string, { color: string; Icon: typeof CheckCircle2; label: string }> = {
  success: { color: 'var(--success)', Icon: CheckCircle2, label: 'Success' },
  failed: { color: 'var(--danger)', Icon: XCircle, label: 'Failed' },
  pending: { color: 'var(--text-muted)', Icon: Clock, label: 'Pending' },
}

export const HistoryRow = memo(({ history, serverName }: HistoryRowProps) => {
  const [expanded, setExpanded] = useState(false)
  const status = STATUS_STYLES[history.status] || STATUS_STYLES.pending
  const StatusIcon = status.Icon
  const output = history.output || ''
  const isLong = output.length > 120 || output.includes('\n')

  return (
    <tr style={{ verticalAlign: 'top' }}>
      <td style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
        {format(new Date(history.created_at), 'MMM d, HH:mm:ss')}
      </td>
      <td style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        {serverName}
      </td>
      <td>
        <Badge
          variant="warning"
          title={history.trigger_info}
          style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}
        >
          {history.trigger_info}
        </Badge>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: status.color }}>
          <StatusIcon size={14} /> {status.label}
        </span>
      </td>
      <td>
        {history.command && (
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 6, maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={history.command}>
            $ {history.command}
          </div>
        )}
        {output ? (
          <pre
            onClick={() => isLong && setExpanded(v => !v)}
            title={isLong ? (expanded ? 'Click to collapse' : 'Click to expand') : undefined}
            style={{
              margin: 0, background: 'var(--bg-app)', color: 'var(--text-secondary)',
              padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: 12, fontFamily: 'var(--font-mono)',
              maxWidth: 460, border: '1px solid var(--border)', lineHeight: 1.6,
              whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
              wordBreak: 'break-word',
              maxHeight: expanded ? 300 : undefined, overflowY: expanded ? 'auto' : undefined,
              cursor: isLong ? 'pointer' : 'default',
            }}
          >
            {expanded || !isLong ? output : output.split('\n')[0].slice(0, 120) + '…'}
          </pre>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No output</span>
        )}
      </td>
    </tr>
  )
})

HistoryRow.displayName = 'HistoryRow'
