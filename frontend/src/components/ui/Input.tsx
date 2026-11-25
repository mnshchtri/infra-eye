import type { InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef, useId } from 'react'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'

// All three fields render native elements (native <select>, plain <input>) so
// callers keep receiving ordinary React change events with e.target.value.

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  error?: string
  helper?: string
  icon?: ReactNode
  required?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, icon, required, id, className, style, ...props }, ref) => {
    const autoId = useId()
    return (
      <TextField
        id={id ?? autoId}
        label={label}
        required={required}
        error={!!error}
        helperText={error || helper}
        fullWidth
        className={className}
        style={style}
        inputRef={ref}
        slotProps={{
          input: icon ? { startAdornment: <InputAdornment position="start">{icon}</InputAdornment> } : undefined,
          htmlInput: props,
          inputLabel: { shrink: props.type === 'date' || props.type === 'time' || undefined },
        }}
      />
    )
  },
)
Input.displayName = 'Input'

export interface TextareaProps extends InputHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  helper?: string
  required?: boolean
  rows?: number
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helper, required, id, rows = 4, className, style, ...props }, ref) => {
    const autoId = useId()
    return (
      <TextField
        id={id ?? autoId}
        label={label}
        required={required}
        error={!!error}
        helperText={error || helper}
        fullWidth
        multiline
        minRows={rows}
        className={className}
        style={style}
        inputRef={ref}
        slotProps={{ htmlInput: props }}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export interface SelectProps extends Omit<InputHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  error?: string
  helper?: string
  required?: boolean
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, helper, required, options, id, className, style, ...props }, ref) => {
    const autoId = useId()
    return (
      <TextField
        id={id ?? autoId}
        label={label}
        required={required}
        error={!!error}
        helperText={error || helper}
        fullWidth
        select
        className={className}
        style={style}
        inputRef={ref}
        slotProps={{ select: { native: true }, htmlInput: props, inputLabel: { shrink: true } }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </TextField>
    )
  },
)
Select.displayName = 'Select'
