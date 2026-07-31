import type { HTMLAttributes } from 'react'

export function FormGrid({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`form-grid ${className}`} {...props} />
}
