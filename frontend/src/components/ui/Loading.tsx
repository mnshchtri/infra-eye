import type { HTMLAttributes } from 'react'

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: number
}

export function Spinner({ size = 20, className = '', ...props }: SpinnerProps) {
  return (
    <div
      className={`spinner ${className}`}
      style={{ width: size, height: size }}
      {...props}
    />
  )
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'avatar' | 'card' | 'rect'
  width?: string | number
  height?: string | number
}

export function Skeleton({
  variant = 'rect',
  width,
  height,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  const variantClass = variant !== 'rect' ? `skeleton-${variant}` : ''

  return (
    <div
      className={`skeleton ${variantClass} ${className}`}
      style={{
        width,
        height,
        ...style,
      }}
      {...props}
    />
  )
}

export interface LoadingOverlayProps {
  message?: string
}

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay-scrim)',
        backdropFilter: 'var(--blur-sm)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        zIndex: 'var(--z-modal)',
      }}
    >
      <Spinner size={40} />
      {message && (
        <p style={{ color: 'white', fontSize: 'var(--text-base)' }}>{message}</p>
      )}
    </div>
  )
}
