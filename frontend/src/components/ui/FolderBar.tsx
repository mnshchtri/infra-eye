import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { FolderItem } from '../../hooks/useFolders'

export type FolderSelection = number | 'all' | 'unassigned'

const PALETTE = ['#2b9af3', '#3e8635', '#f0ab00', '#c9190b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

export function FolderBar({
  folders, counts, unassignedCount, totalCount, selected, onSelect, onCreate, onDelete, canManage,
}: {
  folders: FolderItem[]
  counts: Record<number, number>
  unassignedCount: number
  totalCount: number
  selected: FolderSelection
  onSelect: (v: FolderSelection) => void
  onCreate: (name: string, color: string) => void
  onDelete: (id: number) => void
  canManage: boolean
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])

  function submit() {
    if (!name.trim()) return
    onCreate(name.trim(), color)
    setName('')
    setColor(PALETTE[0])
    setCreating(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      <Chip active={selected === 'all'} label="All" count={totalCount} onClick={() => onSelect('all')} />
      {folders.map(f => (
        <Chip
          key={f.id}
          active={selected === f.id}
          label={f.name}
          count={counts[f.id] || 0}
          color={f.color}
          onClick={() => onSelect(f.id)}
          onDelete={canManage ? () => onDelete(f.id) : undefined}
        />
      ))}
      <Chip active={selected === 'unassigned'} label="Unassigned" count={unassignedCount} onClick={() => onSelect('unassigned')} />

      {canManage && (
        creating ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '4px 6px' }}>
            <input
              autoFocus
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setCreating(false) }}
              placeholder="Folder name"
              style={{ height: 26, fontSize: 12, padding: '0 8px', width: 130 }}
            />
            <div style={{ display: 'flex', gap: 3 }}>
              {PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 14, height: 14, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                    border: color === c ? '2px solid var(--text-primary)' : '1px solid transparent',
                  }}
                />
              ))}
            </div>
            <button type="button" onClick={submit} className="btn-icon-sm" title="Create"><Plus size={13} /></button>
            <button type="button" onClick={() => setCreating(false)} className="btn-icon-sm" title="Cancel"><X size={13} /></button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700,
              padding: '6px 12px', border: '1px dashed var(--border)', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            <Plus size={13} /> New folder
          </button>
        )
      )}
    </div>
  )
}

function Chip({
  active, label, count, color, onClick, onDelete,
}: {
  active: boolean
  label: string
  count: number
  color?: string
  onClick: () => void
  onDelete?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        padding: '6px 10px 6px 12px', fontSize: 12, fontWeight: 700,
        border: `1px solid ${active ? (color || 'var(--brand-primary)') : 'var(--border)'}`,
        background: active ? (color ? `${color}1a` : 'var(--brand-glow)') : 'transparent',
        color: active ? (color || 'var(--brand-primary)') : 'var(--text-secondary)',
        transition: 'all 0.15s',
      }}
    >
      {color && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />}
      <span>{label}</span>
      <span style={{ opacity: 0.6, fontSize: 12 }}>{count}</span>
      {onDelete && (
        <span
          onClick={e => {
            e.stopPropagation()
            if (window.confirm(`Delete folder "${label}"? Items inside become unassigned.`)) onDelete()
          }}
          style={{ display: 'flex', marginLeft: 2, opacity: 0.5 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
        >
          <X size={12} />
        </span>
      )}
    </div>
  )
}
