import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { FolderItem } from '../../hooks/useFolders'

export type FolderSelection = number | 'all' | 'unassigned'

// Mirrors --info/--success/--warning/--danger plus the --accent-* hues (index.css).
// Kept as literal hex (not var() refs) because callers hex-alpha-suffix these
// values directly (e.g. `${folder.color}1a`) when rendering tinted backgrounds.
const FOLDER_COLORS = ['#2b9af3', '#3e8635', '#f0ab00', '#c9190b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

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
  const [color, setColor] = useState(FOLDER_COLORS[0])

  function submit() {
    if (!name.trim()) return
    onCreate(name.trim(), color)
    setName('')
    setColor(FOLDER_COLORS[0])
    setCreating(false)
  }

  return (
    <div className="folder-bar">
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
          <div className="folder-create-form">
            <input
              autoFocus
              className="input folder-create-input"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setCreating(false) }}
              placeholder="Folder name"
            />
            <div style={{ display: 'flex', gap: 3 }}>
              {FOLDER_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`folder-color-swatch${color === c ? ' selected' : ''}`}
                  style={{ '--folder-color': c } as React.CSSProperties}
                />
              ))}
            </div>
            <button type="button" onClick={submit} className="btn-icon-sm" title="Create"><Plus size={13} /></button>
            <button type="button" onClick={() => setCreating(false)} className="btn-icon-sm" title="Cancel"><X size={13} /></button>
          </div>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="folder-create-btn">
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
  const cssVars = color
    ? ({ '--folder-color': color, '--folder-chip-bg': `${color}1a` } as React.CSSProperties)
    : undefined

  return (
    <div onClick={onClick} className={`folder-chip${active ? ' active' : ''}`} style={cssVars}>
      {color && <span className="folder-chip-dot" />}
      <span>{label}</span>
      <span className="folder-chip-count">{count}</span>
      {onDelete && (
        <span
          className="folder-chip-delete"
          onClick={e => {
            e.stopPropagation()
            if (window.confirm(`Delete folder "${label}"? Items inside become unassigned.`)) onDelete()
          }}
        >
          <X size={12} />
        </span>
      )}
    </div>
  )
}
