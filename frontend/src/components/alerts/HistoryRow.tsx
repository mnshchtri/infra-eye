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
    <tr style={{ borderBottom: !isLast ? '1px solid var(--border)' : 'none', transition: 'background 0.15s' }} className="table-row-hover">
      <td style={{ padding: '16px 24px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
        {format(new Date(history.created_at), 'MMM d, HH:mm:ss')}
      </td>
      <td style={{ padding: '16px 24px', fontSize: 13, fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
        {serverName}
      </td>
      <td style={{ padding: '16px 24px' }}>
        <span style={{ 
          fontSize: 10, fontWeight: 900, color: 'var(--warning)', 
          background: 'var(--bg-app)', border: '1px solid var(--warning)30', 
          padding: '4px 10px', borderRadius: 0, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' 
        }}>
          {history.trigger_info}
        </span>
      </td>
      <td style={{ padding: '16px 24px' }}>
         <div style={{ 
           background: 'var(--bg-card)', color: history.output ? 'var(--success)' : 'var(--text-muted)', 
           padding: '12px 16px', borderRadius: 0, fontSize: 10, fontFamily: 'var(--font-mono)', 
           maxWidth: 450, overflow: 'hidden', textOverflow: 'ellipsis', border: '1px solid var(--border)',
           whiteSpace: 'nowrap', fontWeight: 800, textTransform: 'uppercase'
         }}>
           {history.output || 'NULL_RESPONSE : SYSTEM_IDLE'}
         </div>
      </td>
    </tr>
  )
})

HistoryRow.displayName = 'HistoryRow'
