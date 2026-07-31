import type { HTMLAttributes } from 'react'

export function FormRow({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`form-row ${className}`} {...props} />
}
