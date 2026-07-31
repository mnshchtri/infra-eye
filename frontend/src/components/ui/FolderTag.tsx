import type { FolderItem } from '../../hooks/useFolders'

export function FolderTag({
  folders, value, onChange, disabled,
}: {
  folders: FolderItem[]
  value: number | null
  onChange: (id: number | null) => void
  disabled?: boolean
}) {
  const folder = folders.find(f => f.id === value) || null
  const cssVars = folder
    ? ({ '--folder-color': folder.color, '--folder-chip-bg': `${folder.color}1a` } as React.CSSProperties)
    : undefined

  return (
    <select
      value={value ?? ''}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
      title={disabled ? undefined : 'Move to folder'}
      className="folder-tag-select"
      style={cssVars}
    >
      <option value="">No folder</option>
      {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  )
}
