import Chip from '@mui/material/Chip'

export interface StatusPillProps {
  status: string
  color: string
  variant?: 'solid' | 'outline'
}

// `color` is an arbitrary CSS colour supplied by the caller, so it is applied
// through sx rather than mapped onto the MUI palette.
export function StatusPill({ status, color, variant = 'solid' }: StatusPillProps) {
  return (
    <Chip
      label={status}
      variant="outlined"
      sx={{
        height: 20,
        fontSize: '0.6875rem',
        color,
        borderColor: `${color}30`,
        bgcolor: variant === 'solid' ? `${color}18` : 'transparent',
        '& .MuiChip-label': { px: 0.875 },
      }}
    />
  )
}
