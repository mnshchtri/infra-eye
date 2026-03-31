import React, { memo } from 'react'
import { format } from 'date-fns'

interface HistoryAction {
  id: number; created_at: string; server_id: number; trigger_info: string;
  command: string; output: string; status: string;
}

interface HistoryRowProps {
  history: HistoryAction;
  serverName: string;
  isLast: boolean;
}

export const HistoryRow = memo(({ history, serverName, isLast }: HistoryRowProps) => {
  return (
    <tr style={{ borderBottom: !isLast ? '1px solid var(--border)' : 'none' }}>
      <td style={{ padding: '20px 24px', fontSize: 12, color: 'var(--text-muted)', fontFamily: '"Courier New", monospace' }}>
        {format(new Date(history.created_at), 'MMM d, HH:mm:ss')}
      </td>
      <td style={{ padding: '20px 24px', fontSize: 13, fontWeight: 700 }}>{serverName}</td>
      <td style={{ padding: '20px 24px' }}>
        <span className="badge" style={{ background: 'var(--warning)15', color: 'var(--warning)', border: '1px solid var(--warning)25' }}>{history.trigger_info}</span>
      </td>
      <td style={{ padding: '20px 24px' }}>
         <div style={{ background: 'var(--bg-app)', color: 'var(--success)', padding: '10px 14px', borderRadius: 8, fontSize: 11, fontFamily: '"JetBrains Mono", monospace', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', border: '1px solid var(--border)' }}>
           {history.output || 'No output produced'}
         </div>
      </td>
    </tr>
  )
})

HistoryRow.displayName = 'HistoryRow'
