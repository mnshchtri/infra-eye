import type { HTMLAttributes, ReactNode } from 'react'
import Chip from '@mui/material/Chip'

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  dot?: boolean
  children: ReactNode
}

const COLOR = {
  primary: 'primary', success: 'success', warning: 'warning',
  danger: 'error', info: 'info', neutral: 'default',
} as const

export function Badge({ variant = 'neutral', dot = false, children, ...props }: BadgeProps) {
  const color = COLOR[variant]
  return (
    <Chip
      {...props}
      label={children}
      color={color}
      variant={color === 'default' ? 'outlined' : 'filled'}
      icon={dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /> : undefined}
      sx={{ height: 20, fontSize: '0.6875rem', '& .MuiChip-label': { px: 0.875 } }}
    />
  )
}
