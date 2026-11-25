import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import MuiButton from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
}

const VARIANT = {
  primary: { variant: 'contained', color: 'primary' },
  secondary: { variant: 'outlined', color: 'inherit' },
  outline: { variant: 'outlined', color: 'primary' },
  ghost: { variant: 'text', color: 'inherit' },
  danger: { variant: 'contained', color: 'error' },
  success: { variant: 'contained', color: 'success' },
} as const

const SIZE = { sm: 'small', md: 'medium', lg: 'large' } as const

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = 'primary', size = 'md', loading = false, disabled, icon, iconPosition = 'left', ...props }, ref) => {
    const v = VARIANT[variant]
    const spinner = <CircularProgress size={14} color="inherit" />
    return (
      <MuiButton
        ref={ref}
        variant={v.variant}
        color={v.color}
        size={SIZE[size]}
        disabled={disabled || loading}
        startIcon={loading ? spinner : iconPosition === 'left' ? icon : undefined}
        endIcon={!loading && iconPosition === 'right' ? icon : undefined}
        // Secondary/ghost use the neutral palette; keep their borders visible.
        sx={v.color === 'inherit' && v.variant === 'outlined' ? { borderColor: 'divider' } : undefined}
        {...props}
      >
        {children}
      </MuiButton>
    )
  },
)

Button.displayName = 'Button'
