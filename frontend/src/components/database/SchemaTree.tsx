import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Database, Table2, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import { errMessage } from '../../utils/errors'
import type { SchemaGroup } from '../../types/database'

interface SchemaTreeProps {
  resourceId: number
  selected: { schema: string; table: string } | null
  onSelect: (schema: string, table: string) => void
}

/**
 * Two-level collapsible tree (schema -> table), mirroring the sidebar-tree
 * interaction used by the Kubernetes resource explorer but much simpler —
 * no drawer, no per-resource actions, just pick a table.
 */
export function SchemaTree({ resourceId, selected, onSelect }: SchemaTreeProps) {
  const [groups, setGroups] = useState<SchemaGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<SchemaGroup[]>(`/api/resources/${resourceId}/schema`)
      if (!Array.isArray(res.data)) throw new Error('Unexpected response from server')
      setGroups(res.data)
      // First schema starts expanded so the tree isn't empty-looking on load.
      if (res.data.length > 0) setExpanded(prev => Object.keys(prev).length ? prev : { [res.data[0].schema]: true })
    } catch (err: unknown) {
      setError(errMessage(err, 'Could not load schema'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [resourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(schema: string) {
    setExpanded(prev => ({ ...prev, [schema]: !prev[schema] }))
  }

  if (loading) return (
    <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12.5 }}>
      <Loader2 size={14} className="spin" /> Loading schema…
    </div>
  )
  if (error) return (
    <div style={{ padding: 16, fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>
  )
  if (groups.length === 0) return (
    <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-muted)' }}>No tables found.</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Schema</span>
        <button onClick={load} title="Refresh schema" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
          <RefreshCw size={12} />
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {groups.map(g => (
          <div key={g.schema}>
            <button
              onClick={() => toggle(g.schema)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 12px',
                background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)',
              }}
            >
              {expanded[g.schema] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Database size={13} color="var(--brand-primary)" />
              {g.schema}
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({g.tables.length})</span>
            </button>
            {expanded[g.schema] && g.tables.map(table => {
              const isSelected = selected?.schema === g.schema && selected?.table === table
              return (
                <button
                  key={table}
                  onClick={() => onSelect(g.schema, table)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px 6px 32px',
                    background: isSelected ? 'var(--brand-glow)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: 12.5, fontFamily: 'var(--font-mono)',
                    color: isSelected ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <Table2 size={12} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{table}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
