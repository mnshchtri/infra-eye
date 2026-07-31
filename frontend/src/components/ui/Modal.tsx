import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  icon?: LucideIcon
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({
  isOpen,
  onClose,
  title,
  icon: Icon,
  subtitle,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const sizeClasses = {
    sm: 'modal-sm',
    md: 'modal-md',
    lg: 'modal-lg',
    xl: 'modal-xl',
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal ${sizeClasses[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="modal-header">
            <div className="modal-header-heading">
              {Icon && (
                <div className="modal-icon-box">
                  <Icon size={18} />
                </div>
              )}
              <div>
                <h2 className="modal-title">{title}</h2>
                {subtitle && <p className="modal-subtitle">{subtitle}</p>}
              </div>
            </div>
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
          </div>
        )}

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export interface ModalHeaderProps {
  children: ReactNode
  onClose?: () => void
}

export function ModalHeader({ children, onClose }: ModalHeaderProps) {
  return (
    <div className="modal-header">
      {children}
      {onClose && (
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={20} />
        </button>
      )}
    </div>
  )
}

export interface ModalBodyProps {
  children: ReactNode
}

export function ModalBody({ children }: ModalBodyProps) {
  return <div className="modal-body">{children}</div>
}

export interface ModalFooterProps {
  children: ReactNode
}

export function ModalFooter({ children }: ModalFooterProps) {
  return <div className="modal-footer">{children}</div>
}
