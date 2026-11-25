import { Box, MenuItem, Select } from '@mui/material'
import type { FolderItem } from '../../hooks/useFolders'

export function FolderTag({
  folders, value, onChange, disabled,
}: {
  folders: FolderItem[]
  value: number | null
  onChange: (id: number | null) => void
  disabled?: boolean
}) {
  const dot = (color?: string) => (
    <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color ?? 'text.disabled', mr: 1, flexShrink: 0, display: 'inline-block' }} />
  )
  return (
    <Select<number | ''>
      value={value ?? ''}
      displayEmpty
      disabled={disabled}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      inputProps={{ 'aria-label': 'Folder' }}
      sx={{ fontSize: 12, minWidth: 130, maxWidth: '100%', '& .MuiSelect-select': { py: 0.5, display: 'flex', alignItems: 'center' } }}
      renderValue={(v) => {
        const f = folders.find(x => x.id === Number(v))
        return <>{dot(f?.color)}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f ? f.name : 'No folder'}</span></>
      }}
    >
      <MenuItem value="">No folder</MenuItem>
      {folders.map(f => <MenuItem key={f.id} value={f.id}>{dot(f.color)}{f.name}</MenuItem>)}
    </Select>
  )
}
