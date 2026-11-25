import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Database, Table2, RefreshCw } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import { Spinner } from '../ui'
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
    <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 13 }}>
      <Spinner size={14} /> Loading schema…
    </Box>
  )
  if (error) return <Typography variant="body2" color="error" sx={{ p: 2 }}>{error}</Typography>
  if (groups.length === 0) return <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No tables found.</Typography>

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>Schema</Typography>
        <Tooltip title="Refresh schema">
          <IconButton size="small" aria-label="Refresh schema" onClick={load}><RefreshCw size={12} /></IconButton>
        </Tooltip>
      </Box>
      <List dense disablePadding sx={{ overflowY: 'auto', flex: 1 }}>
        {groups.map(g => (
          <Box key={g.schema}>
            <ListItemButton onClick={() => toggle(g.schema)} aria-expanded={!!expanded[g.schema]} sx={{ gap: 0.75, px: 1.5, py: 0.75 }}>
              {expanded[g.schema] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Box sx={{ display: 'flex', color: 'primary.main' }}><Database size={13} /></Box>
              <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}>{g.schema}</Typography>
              <Typography component="span" variant="caption" color="text.secondary">({g.tables.length})</Typography>
            </ListItemButton>
            {expanded[g.schema] && g.tables.map(table => {
              const isSelected = selected?.schema === g.schema && selected?.table === table
              return (
                <ListItemButton
                  key={table}
                  selected={isSelected}
                  onClick={() => onSelect(g.schema, table)}
                  sx={{ gap: 0.75, py: 0.5, pl: 4, pr: 1.5, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: isSelected ? 'primary.main' : 'text.secondary' }}
                >
                  <Table2 size={12} style={{ flexShrink: 0 }} />
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{table}</Box>
                </ListItemButton>
              )
            })}
          </Box>
        ))}
      </List>
    </Box>
  )
}
