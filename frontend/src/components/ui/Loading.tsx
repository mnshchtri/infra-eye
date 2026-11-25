import type { HTMLAttributes } from 'react'
import CircularProgress from '@mui/material/CircularProgress'
import MuiSkeleton from '@mui/material/Skeleton'
import Backdrop from '@mui/material/Backdrop'
import Typography from '@mui/material/Typography'

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'> {
  size?: number
}

export function Spinner({ size = 20, ...props }: SpinnerProps) {
  return <CircularProgress size={size} {...props} />
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'avatar' | 'card' | 'rect'
  width?: string | number
  height?: string | number
}

export function Skeleton({ variant = 'rect', width, height, ...props }: SkeletonProps) {
  const muiVariant = variant === 'text' ? 'text' : variant === 'avatar' ? 'circular' : 'rectangular'
  return <MuiSkeleton variant={muiVariant} width={width} height={height} {...props} />
}

export interface LoadingOverlayProps {
  message?: string
}

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <Backdrop open sx={{ zIndex: 1400, flexDirection: 'column', gap: 2, color: '#fff' }}>
      <CircularProgress size={40} color="inherit" />
      {message && <Typography>{message}</Typography>}
    </Backdrop>
  )
}
