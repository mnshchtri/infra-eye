import type { ReactNode } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import IconButton from '@mui/material/IconButton'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
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

const MAX_WIDTH = { sm: 'xs', md: 'sm', lg: 'md', xl: 'lg' } as const

export function Modal({ isOpen, onClose, title, icon: Icon, subtitle, children, footer, size = 'md' }: ModalProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      maxWidth={MAX_WIDTH[size]}
      fullWidth
    >
      {title && (
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pr: 1 }}>
          {Icon && (
            <Box sx={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 1, bgcolor: 'action.selected', color: 'primary.main' }}>
              <Icon size={18} />
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="span" sx={{ display: 'block' }}>{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          <IconButton onClick={onClose} aria-label="Close modal"><X size={18} /></IconButton>
        </DialogTitle>
      )}
      <DialogContent dividers={!!title}>{children}</DialogContent>
      {footer && <DialogActions sx={{ px: 2, py: 1.25 }}>{footer}</DialogActions>}
    </Dialog>
  )
}

export interface ModalHeaderProps {
  children: ReactNode
  onClose?: () => void
}

export function ModalHeader({ children, onClose }: ModalHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
      {children}
      {onClose && <IconButton onClick={onClose} aria-label="Close modal"><X size={18} /></IconButton>}
    </Box>
  )
}

// Modal already pads its content; these only group children, so callers that
// nest them inside <Modal> don't get doubled padding.
export function ModalBody({ children }: { children: ReactNode }) {
  return <Box>{children}</Box>
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, width: '100%' }}>{children}</Box>
}
