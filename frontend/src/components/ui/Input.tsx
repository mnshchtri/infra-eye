import type { InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'
import { AlertCircle } from 'lucide-react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helper?: string
  icon?: ReactNode
  required?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helper,
      icon,
      required,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`
    const hasError = !!error

    return (
      <div className="input-group">
        {label && (
          <label
            htmlFor={inputId}
            className={`input-label ${required ? 'input-label-required' : ''}`}
          >
            {label}
          </label>
        )}

        {icon ? (
          <div className="input-icon-wrapper">
            <div className="input-icon">{icon}</div>
            <input
              ref={ref}
              id={inputId}
              className={`input ${hasError ? 'input-error' : ''} ${className}`}
              {...props}
            />
          </div>
        ) : (
          <input
            ref={ref}
            id={inputId}
            className={`input ${hasError ? 'input-error' : ''} ${className}`}
            {...props}
          />
        )}

        {error && (
          <div className="input-error-text">
            <AlertCircle size={13} />
            <span>{error}</span>
          </div>
        )}

        {helper && !error && <div className="input-helper">{helper}</div>}
      </div>
    )
  }
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
  (
    {
      label,
      error,
      helper,
      required,
      className = '',
      id,
      rows = 4,
      ...props
    },
    ref
  ) => {
    const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`
    const hasError = !!error

    return (
      <div className="input-group">
        {label && (
          <label
            htmlFor={textareaId}
            className={`input-label ${required ? 'input-label-required' : ''}`}
          >
            {label}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={`textarea ${hasError ? 'input-error' : ''} ${className}`}
          {...props}
        />

        {error && (
          <div className="input-error-text">
            <AlertCircle size={13} />
            <span>{error}</span>
          </div>
        )}

        {helper && !error && <div className="input-helper">{helper}</div>}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'

export interface SelectProps extends InputHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  helper?: string
  required?: boolean
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      helper,
      required,
      options,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`
    const hasError = !!error

    return (
      <div className="input-group">
        {label && (
          <label
            htmlFor={selectId}
            className={`input-label ${required ? 'input-label-required' : ''}`}
          >
            {label}
          </label>
        )}

        <select
          ref={ref}
          id={selectId}
          className={`select ${hasError ? 'input-error' : ''} ${className}`}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {error && (
          <div className="input-error-text">
            <AlertCircle size={13} />
            <span>{error}</span>
          </div>
        )}

        {helper && !error && <div className="input-helper">{helper}</div>}
      </div>
    )
  }
)

Select.displayName = 'Select'
