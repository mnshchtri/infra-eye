import { memo, useState } from 'react'
import { format } from 'date-fns'
import { CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Box, TableCell, TableRow, Typography } from '@mui/material'
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
    <TableRow hover sx={{ verticalAlign: 'top' }}>
      <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', color: 'text.secondary' }}>
        {format(new Date(history.created_at), 'MMM d, HH:mm:ss')}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{serverName}</TableCell>
      <TableCell>
        <Badge variant="warning" title={history.trigger_info} style={{ maxWidth: 260, fontFamily: 'var(--font-mono)' }}>
          {history.trigger_info}
        </Badge>
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Typography variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 600, color: status.color }}>
          <StatusIcon size={14} /> {status.label}
        </Typography>
      </TableCell>
      <TableCell>
        {history.command && (
          <Typography variant="caption" noWrap title={history.command} sx={{ display: 'block', fontFamily: 'var(--font-mono)', color: 'text.secondary', mb: 0.75, maxWidth: 460 }}>
            $ {history.command}
          </Typography>
        )}
        {output ? (
          <Box
            component="pre"
            onClick={() => isLong && setExpanded(v => !v)}
            title={isLong ? (expanded ? 'Click to collapse' : 'Click to expand') : undefined}
            sx={{
              m: 0, px: 1.5, py: 1, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'action.hover',
              color: 'text.secondary', fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.6, maxWidth: 460,
              whiteSpace: expanded ? 'pre-wrap' : 'nowrap', overflow: expanded ? 'auto' : 'hidden',
              textOverflow: 'ellipsis', wordBreak: 'break-word', maxHeight: expanded ? 300 : undefined,
              cursor: isLong ? 'pointer' : 'default',
            }}
          >
            {expanded || !isLong ? output : output.split('\n')[0].slice(0, 120) + '…'}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">No output</Typography>
        )}
      </TableCell>
    </TableRow>
  )
})

HistoryRow.displayName = 'HistoryRow'
