import { useEffect, useState } from 'react'
import {
  Plus, Pencil, Trash2, Check, X, ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import { alpha } from '@mui/material/styles'
import { Button, Spinner } from '../ui'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { errMessage } from '../../utils/errors'
import type { ColumnInfo, TableRowsResponse } from '../../types/database'

interface DataGridProps {
  resourceId: number
  schema: string
  table: string
  canEdit: boolean
}

const PAGE_SIZE = 50

// Best-effort coercion from a text <input>'s string value back to the JS
// type the row originally had (number/boolean survive round-tripping;
// everything else — including a brand-new row's cells, which have no
// "original" to match — stays a string, which every SQL driver here accepts
// for common column types via normal input-parsing on the server side).
function coerceInputValue(raw: string, original: unknown): unknown {
  if (raw === '') return null
  if (typeof original === 'number') {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  if (typeof original === 'boolean') return raw === 'true'
  return raw
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function RowAction({ label, onClick, disabled, color, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  color?: 'success' | 'error'
  children: React.ReactNode
}) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton size="small" aria-label={label} onClick={onClick} disabled={disabled} color={color ?? 'default'}>{children}</IconButton>
      </span>
    </Tooltip>
  )
}

const cellInputSx = { '& input': { fontFamily: 'var(--font-mono)', fontSize: 12.5, py: 0.5, px: 1 }, minWidth: 100 }

/**
 * Paginated table for one schema.table, with inline row editing when the
 * table has a primary key and the caller has write access. Genuinely new UI
 * component — nothing like this existed before (only a plain <table> in the
 * old SQL Console tab's result view).
 */
export function DataGrid({ resourceId, schema, table, canEdit }: DataGridProps) {
  const toast = useToastStore()
  const [columns, setColumns] = useState<ColumnInfo[] | null>(null)
  const [data, setData] = useState<TableRowsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)

  const [addingNew, setAddingNew] = useState(false)
  const [newRow, setNewRow] = useState<Record<string, string>>({})

  const pkColumns = (columns ?? []).filter(c => c.primary_key).map(c => c.name)
  const hasPrimaryKey = pkColumns.length > 0

  function keyFor(row: Record<string, unknown>): string {
    return JSON.stringify(pkColumns.map(c => row[c]))
  }
  function whereFor(row: Record<string, unknown>): Record<string, unknown> {
    const where: Record<string, unknown> = {}
    for (const c of pkColumns) where[c] = row[c]
    return where
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [colsRes, rowsRes] = await Promise.all([
        api.get<ColumnInfo[]>(`/api/resources/${resourceId}/schema/${schema}/${table}/columns`),
        api.get<TableRowsResponse>(`/api/resources/${resourceId}/schema/${schema}/${table}/rows`, { params: { limit: PAGE_SIZE, offset } }),
      ])
      if (!Array.isArray(colsRes.data) || !Array.isArray(rowsRes.data.rows)) {
        throw new Error('Unexpected response from server')
      }
      setColumns(colsRes.data)
      setData(rowsRes.data)
    } catch (err: unknown) {
      setError(errMessage(err, 'Could not load table'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOffset(0)
    setEditingKey(null)
    setAddingNew(false)
  }, [resourceId, schema, table])

  useEffect(() => { load() }, [resourceId, schema, table, offset]) // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(row: Record<string, unknown>) {
    const d: Record<string, string> = {}
    for (const col of columns ?? []) d[col.name] = cellText(row[col.name])
    setDraft(d)
    setEditingKey(keyFor(row))
  }

  async function saveEdit(row: Record<string, unknown>) {
    const set: Record<string, unknown> = {}
    for (const col of columns ?? []) {
      const next = coerceInputValue(draft[col.name] ?? '', row[col.name])
      if (next !== row[col.name] && cellText(next) !== cellText(row[col.name])) set[col.name] = next
    }
    if (Object.keys(set).length === 0) { setEditingKey(null); return }
    setSaving(true)
    try {
      await api.put(`/api/resources/${resourceId}/schema/${schema}/${table}/rows`, { set, where: whereFor(row) })
      toast.success('Row updated', `${Object.keys(set).length} field${Object.keys(set).length === 1 ? '' : 's'} changed.`)
      setEditingKey(null)
      load()
    } catch (err: unknown) {
      toast.error('Update failed', errMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function deleteRow(row: Record<string, unknown>) {
    setSaving(true)
    try {
      await api.delete(`/api/resources/${resourceId}/schema/${schema}/${table}/rows`, { data: { where: whereFor(row) } })
      toast.success('Row deleted', '')
      setConfirmDeleteKey(null)
      load()
    } catch (err: unknown) {
      toast.error('Delete failed', errMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function startAdd() {
    const d: Record<string, string> = {}
    for (const col of columns ?? []) d[col.name] = ''
    setNewRow(d)
    setAddingNew(true)
  }

  async function saveNew() {
    const values: Record<string, unknown> = {}
    for (const col of columns ?? []) {
      const v = coerceInputValue(newRow[col.name] ?? '', null)
      if (v !== null) values[col.name] = v
    }
    if (Object.keys(values).length === 0) { setAddingNew(false); return }
    setSaving(true)
    try {
      await api.post(`/api/resources/${resourceId}/schema/${schema}/${table}/rows`, { values })
      toast.success('Row added', '')
      setAddingNew(false)
      load()
    } catch (err: unknown) {
      toast.error('Insert failed', errMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return (
    <Box sx={{ p: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'text.secondary' }}>
      <Spinner size={16} /> Loading {schema}.{table}…
    </Box>
  )
  if (error) return (
    <Typography variant="body2" color="error" sx={{ p: 3 }}>{error}</Typography>
  )
  if (!columns || !data) return null

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const showActions = canEdit && hasPrimaryKey

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', gap: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Typography component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{schema}.{table}</Typography>
          <Typography component="span" variant="caption" color="text.secondary">{data.total} row{data.total === 1 ? '' : 's'}</Typography>
          {!hasPrimaryKey && (
            <Typography component="span" variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'warning.main' }}>
              <AlertTriangle size={11} /> read-only (no primary key)
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          {canEdit && hasPrimaryKey && !addingNew && (
            <Button variant="secondary" size="sm" onClick={startAdd} icon={<Plus size={13} />}>Add row</Button>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary', fontSize: 12 }}>
            <RowAction label="Previous page" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}><ChevronLeft size={14} /></RowAction>
            <span>{page} / {pageCount}</span>
            <RowAction label="Next page" disabled={offset + PAGE_SIZE >= data.total} onClick={() => setOffset(o => o + PAGE_SIZE)}><ChevronRight size={14} /></RowAction>
          </Box>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {columns.map(col => (
                <TableCell key={col.name} sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: 'text.secondary', lineHeight: 1.5 }}>
                  {col.name}{col.primary_key && ' 🔑'}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75, fontWeight: 400 }}>{col.type}</Typography>
                </TableCell>
              ))}
              {showActions && <TableCell sx={{ width: 90 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {addingNew && (
              <TableRow sx={{ bgcolor: t => alpha(t.palette.primary.main, 0.08) }}>
                {columns.map(col => (
                  <TableCell key={col.name} sx={{ py: 0.5 }}>
                    <TextField
                      size="small" value={newRow[col.name] ?? ''} placeholder={col.nullable ? 'NULL' : ''}
                      onChange={e => setNewRow(prev => ({ ...prev, [col.name]: e.target.value }))}
                      sx={cellInputSx}
                      slotProps={{ htmlInput: { 'aria-label': `New ${col.name}` } }}
                    />
                  </TableCell>
                ))}
                <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap' }}>
                  <RowAction label="Save" color="success" onClick={saveNew} disabled={saving}><Check size={14} /></RowAction>
                  <RowAction label="Cancel" onClick={() => setAddingNew(false)}><X size={14} /></RowAction>
                </TableCell>
              </TableRow>
            )}
            {data.rows.length === 0 && !addingNew ? (
              <TableRow><TableCell colSpan={columns.length + 1} sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>No rows.</TableCell></TableRow>
            ) : data.rows.map((row, i) => {
              const key = keyFor(row)
              const isEditing = editingKey === key
              return (
                <TableRow key={i} hover>
                  {columns.map(col => (
                    <TableCell key={col.name} sx={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isEditing ? 'normal' : 'nowrap', py: isEditing ? 0.5 : undefined, lineHeight: 1.5 }}>
                      {isEditing ? (
                        <TextField
                          size="small" value={draft[col.name] ?? ''}
                          onChange={e => setDraft(prev => ({ ...prev, [col.name]: e.target.value }))}
                          sx={cellInputSx}
                          slotProps={{ htmlInput: { 'aria-label': `Edit ${col.name}` } }}
                        />
                      ) : (
                        row[col.name] === null ? <Box component="span" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>NULL</Box> : cellText(row[col.name])
                      )}
                    </TableCell>
                  ))}
                  {showActions && (
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <RowAction label="Save" color="success" onClick={() => saveEdit(row)} disabled={saving}><Check size={14} /></RowAction>
                          <RowAction label="Cancel" onClick={() => setEditingKey(null)}><X size={14} /></RowAction>
                        </>
                      ) : confirmDeleteKey === key ? (
                        <>
                          <RowAction label="Confirm delete" color="error" onClick={() => deleteRow(row)} disabled={saving}><Check size={14} /></RowAction>
                          <RowAction label="Cancel" onClick={() => setConfirmDeleteKey(null)}><X size={14} /></RowAction>
                        </>
                      ) : (
                        <>
                          <RowAction label="Edit row" onClick={() => startEdit(row)}><Pencil size={13} /></RowAction>
                          <RowAction label="Delete row" color="error" onClick={() => setConfirmDeleteKey(key)}><Trash2 size={13} /></RowAction>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}
