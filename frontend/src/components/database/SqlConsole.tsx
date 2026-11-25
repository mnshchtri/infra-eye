import { useState } from 'react'
import CodeEditor from '@uiw/react-textarea-code-editor'
import { Play, Table, CheckCircle2, Code } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import TableContainer from '@mui/material/TableContainer'
import MuiTable from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import { Button } from '../ui'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { useUIStore } from '../../store/uiStore'
import { errMessage } from '../../utils/errors'
import type { SqlQueryResult } from '../../types/database'

interface SqlConsoleProps {
  resourceId: number
}

/**
 * Free-form SQL console — same /api/resources/:id/query endpoint the old
 * bare-<textarea> "SQL Console" tab used, but with real syntax highlighting
 * via the same CodeEditor (@uiw/react-textarea-code-editor) the Kubernetes
 * explorer already uses for YAML (ConfigViewer.tsx), just with language="sql".
 */
export function SqlConsole({ resourceId }: SqlConsoleProps) {
  const toast = useToastStore()
  const { darkMode } = useUIStore()
  const [sql, setSql] = useState('SELECT * FROM users LIMIT 10;')
  const [result, setResult] = useState<SqlQueryResult | null>(null)
  const [running, setRunning] = useState(false)

  async function runQuery() {
    if (!sql.trim()) return
    setRunning(true)
    setResult(null)
    try {
      const res = await api.post<SqlQueryResult>(`/api/resources/${resourceId}/query`, { sql })
      setResult(res.data)
      toast.success('Query executed', 'The operation completed.')
    } catch (err: unknown) {
      toast.error('Query failed', errMessage(err, 'Unable to execute SQL'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ display: 'flex', color: 'primary.main' }}><Code size={15} /></Box>
          <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}>SQL Console</Typography>
          <Typography component="span" variant="caption" color="text.secondary">Every query is recorded in the audit log.</Typography>
        </Box>
        <Button size="sm" onClick={runQuery} loading={running} icon={<Play size={14} />}>{running ? 'Running…' : 'Run'}</Button>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default', flexShrink: 0 }}>
        <CodeEditor
          value={sql}
          language="sql"
          placeholder="SELECT * FROM table LIMIT 10;"
          onChange={e => setSql(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runQuery() }}
          padding={14}
          data-color-mode={darkMode ? 'dark' : 'light'}
          aria-label="SQL query"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 13, backgroundColor: 'transparent', minHeight: 140 }}
        />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: result ? 2 : 0 }}>
        {result && (
          <div>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.75, borderBottom: 1, borderColor: 'divider', pb: 1.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ display: 'flex', color: 'primary.main' }}><Table size={14} /></Box>
                <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}>Result</Typography>
              </Box>
              <Chip size="small" variant="outlined" label={result.type === 'select' ? `${result.rows?.length || 0} rows` : `${result.rows_affected || 0} rows affected`} />
            </Box>
            {result.type === 'select' ? (
              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <MuiTable size="small">
                  <TableHead><TableRow>{result.columns?.map(c => <TableCell key={c} sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {result.rows?.length === 0 ? (
                      <TableRow><TableCell colSpan={result.columns?.length} sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>No rows returned</TableCell></TableRow>
                    ) : result.rows?.map((row, i) => (
                      <TableRow key={i} hover>{result.columns?.map(c => <TableCell key={c} sx={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5 }}>{String(row[c])}</TableCell>)}</TableRow>
                    ))}
                  </TableBody>
                </MuiTable>
              </TableContainer>
            ) : (
              <Box sx={{ p: 3.5, bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 1, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', color: 'success.main', mb: 1 }}><CheckCircle2 size={28} /></Box>
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Success</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{result.rows_affected} rows modified</Typography>
              </Box>
            )}
          </div>
        )}
      </Box>
    </Box>
  )
}
