import { useEffect, useState } from 'react'
import {
  Loader2, Plus, Pencil, Trash2, Check, X, ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react'
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
    <div style={{ padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)' }}>
      <Loader2 size={16} className="spin" /> Loading {schema}.{table}…
    </div>
  )
  if (error) return (
    <div style={{ padding: 24, fontSize: 13, color: 'var(--danger)' }}>{error}</div>
  )
  if (!columns || !data) return null

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{schema}.{table}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{data.total} row{data.total === 1 ? '' : 's'}</span>
          {!hasPrimaryKey && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--warning)' }}>
              <AlertTriangle size={11} /> read-only (no primary key)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canEdit && hasPrimaryKey && !addingNew && (
            <button className="btn btn-secondary btn-sm" onClick={startAdd} style={{ gap: 6 }}>
              <Plus size={13} /> Add row
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            <button className="btn-icon" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))} style={{ width: 26, height: 26 }}>
              <ChevronLeft size={13} />
            </button>
            <span>{page} / {pageCount}</span>
            <button className="btn-icon" disabled={offset + PAGE_SIZE >= data.total} onClick={() => setOffset(o => o + PAGE_SIZE)} style={{ width: 26, height: 26 }}>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {columns.map(col => (
                <th key={col.name} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', background: 'var(--bg-elevated)', position: 'sticky', top: 0, whiteSpace: 'nowrap' }}>
                  {col.name}{col.primary_key && ' 🔑'}
                  <span style={{ fontWeight: 500, textTransform: 'none', marginLeft: 6, color: 'var(--text-muted)' }}>{col.type}</span>
                </th>
              ))}
              {canEdit && hasPrimaryKey && <th style={{ width: 70, background: 'var(--bg-elevated)', position: 'sticky', top: 0 }} />}
            </tr>
          </thead>
          <tbody>
            {addingNew && (
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--brand-glow)' }}>
                {columns.map(col => (
                  <td key={col.name} style={{ padding: '4px 8px' }}>
                    <input className="input" value={newRow[col.name] ?? ''} placeholder={col.nullable ? 'NULL' : ''}
                      onChange={e => setNewRow(prev => ({ ...prev, [col.name]: e.target.value }))}
                      style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', padding: '4px 8px', height: 30 }} />
                  </td>
                ))}
                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                  <button onClick={saveNew} disabled={saving} className="btn-icon" title="Save" style={{ color: 'var(--success)', width: 28, height: 28 }}><Check size={14} /></button>
                  <button onClick={() => setAddingNew(false)} className="btn-icon" title="Cancel" style={{ width: 28, height: 28 }}><X size={14} /></button>
                </td>
              </tr>
            )}
            {data.rows.length === 0 && !addingNew ? (
              <tr><td colSpan={columns.length + 1} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No rows.</td></tr>
            ) : data.rows.map((row, i) => {
              const key = keyFor(row)
              const isEditing = editingKey === key
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {columns.map(col => (
                    <td key={col.name} style={{ padding: isEditing ? '4px 8px' : '8px 12px', fontSize: 12.5, fontFamily: 'var(--font-mono)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isEditing ? 'normal' : 'nowrap' }}>
                      {isEditing ? (
                        <input className="input" value={draft[col.name] ?? ''}
                          onChange={e => setDraft(prev => ({ ...prev, [col.name]: e.target.value }))}
                          style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', padding: '4px 8px', height: 30 }} />
                      ) : (
                        row[col.name] === null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>NULL</span> : cellText(row[col.name])
                      )}
                    </td>
                  ))}
                  {canEdit && hasPrimaryKey && (
                    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(row)} disabled={saving} className="btn-icon" title="Save" style={{ color: 'var(--success)', width: 28, height: 28 }}><Check size={14} /></button>
                          <button onClick={() => setEditingKey(null)} className="btn-icon" title="Cancel" style={{ width: 28, height: 28 }}><X size={14} /></button>
                        </>
                      ) : confirmDeleteKey === key ? (
                        <>
                          <button onClick={() => deleteRow(row)} disabled={saving} className="btn-icon danger" title="Confirm delete" style={{ width: 28, height: 28 }}><Check size={14} /></button>
                          <button onClick={() => setConfirmDeleteKey(null)} className="btn-icon" title="Cancel" style={{ width: 28, height: 28 }}><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(row)} className="btn-icon" title="Edit row" style={{ width: 28, height: 28 }}><Pencil size={13} /></button>
                          <button onClick={() => setConfirmDeleteKey(key)} className="btn-icon danger" title="Delete row" style={{ width: 28, height: 28 }}><Trash2 size={13} /></button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
