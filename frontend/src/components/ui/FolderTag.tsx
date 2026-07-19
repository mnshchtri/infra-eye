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
  return (
    <select
      value={value ?? ''}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
      title={disabled ? undefined : 'Move to folder'}
      style={{
        fontSize: 9.5, fontWeight: 800, padding: '3px 8px', border: '1px solid var(--border)',
        background: folder ? `${folder.color}1a` : 'var(--bg-elevated)',
        color: folder ? folder.color : 'var(--text-muted)',
        cursor: disabled ? 'default' : 'pointer',
        textTransform: 'uppercase', letterSpacing: '0.03em',
        fontFamily: 'var(--font-mono)', maxWidth: 140,
      }}
    >
      <option value="">No folder</option>
      {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  )
}
