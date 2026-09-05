import { useState } from 'react'
import CodeEditor from '@uiw/react-textarea-code-editor'
import { Play, Loader2, Table, CheckCircle2, Code } from 'lucide-react'
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Code size={15} color="var(--brand-primary)" />
          <span style={{ fontSize: 13, fontWeight: 700 }}>SQL Console</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Every query is recorded in the audit log.</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={runQuery} disabled={running} style={{ height: 32 }}>
          {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          <span style={{ marginLeft: 6 }}>{running ? 'Running…' : 'Run'}</span>
        </button>
      </div>

      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-app)', flexShrink: 0 }}>
        <CodeEditor
          value={sql}
          language="sql"
          placeholder="SELECT * FROM table LIMIT 10;"
          onChange={e => setSql(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runQuery() }}
          padding={14}
          data-color-mode={darkMode ? 'dark' : 'light'}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 13, backgroundColor: 'transparent', minHeight: 140 }}
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: result ? 16 : 0 }}>
        {result && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Table size={14} color="var(--brand-primary)" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Result</span>
              </div>
              <span className="badge badge-neutral">
                {result.type === 'select' ? `${result.rows?.length || 0} rows` : `${result.rows_affected || 0} rows affected`}
              </span>
            </div>
            {result.type === 'select' ? (
              <div className="table-container">
                <table className="k-table">
                  <thead><tr>{result.columns?.map(c => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {result.rows?.length === 0 ? (
                      <tr><td colSpan={result.columns?.length} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No rows returned</td></tr>
                    ) : result.rows?.map((row, i) => (
                      <tr key={i}>{result.columns?.map(c => <td key={c} style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{String(row[c])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 28, background: 'var(--bg-elevated)', border: '1px solid var(--border)', textAlign: 'center' }}>
                <CheckCircle2 size={28} style={{ color: 'var(--success)', margin: '0 auto 10px' }} />
                <div style={{ fontWeight: 700, fontSize: 14 }}>Success</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{result.rows_affected} rows modified</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
