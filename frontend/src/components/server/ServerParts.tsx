import type { ReactNode } from 'react'
import { memo } from 'react'
import {
  Box, Card, Chip, CircularProgress, Divider, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { IconComponent } from '../../types/k8s'
import type { LucideIcon } from 'lucide-react'
import { Button, EmptyState, Modal } from '../ui'
import { MONO, toneColor } from './tokens'
import type { Tone } from './tokens'

/** Soft tinted status chip (sentence case, no all-caps). */
export function ToneChip({ label, tone = 'default' }: { label: ReactNode; tone?: Tone }) {
  return (
    <Chip
      label={label}
      color={tone}
      variant={tone === 'default' ? 'outlined' : 'filled'}
      sx={{ height: 20, fontSize: '0.6875rem', fontFamily: MONO, '& .MuiChip-label': { px: 0.875 } }}
    />
  )
}

/** Small status dot used next to names (node ready, interface up, ...). */
export function Dot({ tone, color }: { tone?: Tone; color?: string }) {
  return (
    <Box
      component="span"
      sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block', bgcolor: color ?? toneColor(tone ?? 'default') }}
    />
  )
}

export function CenteredSpinner({ size = 32, py = 7 }: { size?: number; py?: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py }} role="status" aria-label="Loading">
      <CircularProgress size={size} />
    </Box>
  )
}

/** Shown when a panel's data could not be fetched; offers a retry. */
export function LoadFailed({ icon, message, onRetry }: { icon: LucideIcon; message: string; onRetry: () => void }) {
  return <EmptyState icon={icon} title={message} action={<Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>} />
}

/** Headline number tile (icon, value, label, optional sub-line). */
export const Tile = memo(function Tile({ label, value, sub, icon: Icon, accent = 'primary.main', unit }: {
  label: string; value: string; sub?: string; icon: IconComponent; accent?: string; unit?: string
}) {
  return (
    <Card sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, minWidth: 0 }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 1, bgcolor: 'action.hover', flexShrink: 0, color: accent }}>
        <Icon size={16} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontWeight: 600 }}>{label}</Typography>
        <Typography
          component="div"
          noWrap
          sx={{ fontFamily: MONO, fontWeight: 700, lineHeight: 1.3, fontSize: value.length > 12 ? '0.9375rem' : '1.25rem' }}
        >
          {value}
          {unit && <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>{unit}</Typography>}
        </Typography>
        {sub && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontFamily: MONO }}>{sub}</Typography>}
      </Box>
    </Card>
  )
})

/** Responsive grid for a row of tiles. */
export function TileGrid({ children, min = 200, mb = 0 }: { children: ReactNode; min?: number; mb?: number }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 1.5, mb }}>
      {children}
    </Box>
  )
}

/** Titled card with an icon header, optional count and right-aligned action. */
export function SectionCard({ icon: Icon, title, count, action, children, sx }: {
  icon?: IconComponent; title: string; count?: number; action?: ReactNode; children: ReactNode; sx?: SxProps<Theme>
}) {
  return (
    <Card sx={{ overflow: 'hidden', ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, flexWrap: 'wrap', minHeight: 48 }}>
        {Icon && <Box sx={{ display: 'inline-flex', color: 'primary.main' }}><Icon size={16} /></Box>}
        <Typography variant="subtitle1" component="h3">{title}</Typography>
        {count !== undefined && <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>({count})</Typography>}
        {action && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{action}</Box>}
      </Box>
      <Divider />
      {children}
    </Card>
  )
}

/** Dense table with a sticky header, optionally height-limited. */
export function DataTable({ headers, children, maxHeight, minWidth, label }: {
  headers: (string | { label: string; align?: 'left' | 'right' })[]
  children: ReactNode
  maxHeight?: number
  minWidth?: number
  label?: string
}) {
  return (
    <TableContainer sx={{ maxHeight }}>
      <Table stickyHeader size="small" aria-label={label} sx={{ minWidth }}>
        <TableHead>
          <TableRow>
            {headers.map((h, i) => {
              const hd = typeof h === 'string' ? { label: h } : h
              return <TableCell key={`${hd.label}-${i}`} align={hd.align}>{hd.label}</TableCell>
            })}
          </TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </TableContainer>
  )
}

export function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} align="center" sx={{ py: 4, color: 'text.secondary' }}>{label}</TableCell>
    </TableRow>
  )
}

/** Table cell with monospace text; `muted` greys it out. */
export function MonoCell({ children, muted, bold, sx, align, colSpan }: {
  children?: ReactNode; muted?: boolean; bold?: boolean; sx?: SxProps<Theme>; align?: 'left' | 'right'; colSpan?: number
}) {
  return (
    <TableCell
      align={align}
      colSpan={colSpan}
      sx={{ fontFamily: MONO, lineHeight: 1.4, color: muted ? 'text.secondary' : 'text.primary', fontWeight: bold ? 700 : 400, ...sx }}
    >
      {children}
    </TableCell>
  )
}

/** Thin horizontal usage bar; pass either a palette tone or an explicit colour. */
export function UsageBar({ percent, tone, color }: { percent: number; tone?: Tone; color?: string }) {
  const pct = Math.max(0, Math.min(100, percent || 0))
  return (
    <Box
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      sx={{ height: 6, minWidth: 90, borderRadius: 1, bgcolor: 'action.hover', overflow: 'hidden' }}
    >
      <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: color ?? toneColor(tone ?? 'primary') }} />
    </Box>
  )
}

/** Small uppercase-free label above a value (key/value display). */
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body1" component="div" noWrap sx={{ fontFamily: MONO, fontWeight: 600 }}>{children}</Typography>
    </Box>
  )
}

/** Confirmation dialog (replaces window.confirm, which the desktop webview does not show). */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger = true, busy, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <Typography variant="body1">{message}</Typography>
    </Modal>
  )
}
