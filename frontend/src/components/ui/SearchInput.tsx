import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import { Search, X } from 'lucide-react'

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({ value, onChange, placeholder = 'Search...', className }: SearchInputProps) {
  return (
    <TextField
      className={className}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      fullWidth
      slotProps={{
        htmlInput: { 'aria-label': placeholder },
        input: {
          startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment>,
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton onClick={() => onChange('')} aria-label="Clear search"><X size={14} /></IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  )
}
