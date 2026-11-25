import type { ReactNode } from 'react'
import {
  Alert, Box, Card, Chip, CircularProgress, Collapse, IconButton, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { ChevronDown, ChevronUp, Info, RefreshCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IconComponent } from '../../types/k8s'
import { Button, EmptyState } from '../ui'

/** Page chrome shared by the audit pages: icon + title + description, then an info notice. */
export function AuditPage({ icon: Icon, title, description, notice, loading, actions, noticeIcon, noticeAction, children }: {
  icon: IconComponent; title: string; description: string; notice?: ReactNode; loading?: boolean; actions?: ReactNode; noticeIcon?: ReactNode; noticeAction?: ReactNode; children: ReactNode
}) {
  if (loading) {
    return (
      <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </div>
    )
  }
  return (
    <div className="page">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'primary.main' }}>
          <Icon size={22} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h4" component="h1">{title}</Typography>
          <Typography variant="body1" color="text.secondary">{description}</Typography>
        </Box>
        {actions}
      </Box>
      {notice && (
        <Alert severity="info" icon={noticeIcon ?? <Info size={16} />} action={noticeAction} variant="outlined" sx={{ mb: 2, '& .MuiAlert-message': { fontSize: 12 } }}>
          {notice}
        </Alert>
      )}
      {children}
    </div>
  )
}

/** Row of headline numbers (e.g. servers / scanned / flagged). */
export function AuditStats({ stats }: { stats: { label: string; value: ReactNode; danger?: boolean }[] }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 2, mb: 2 }}>
      {stats.map(s => (
        <Card key={s.label} sx={{ px: 2.5, py: 2 }}>
          <Typography variant="h4" component="div" sx={{ fontFamily: 'var(--font-mono)', color: s.danger ? 'error.main' : 'text.primary' }}>{s.value}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' }}>{s.label}</Typography>
        </Card>
      ))}
    </Box>
  )
}

export type Tone = 'error' | 'warning' | 'success' | 'default'

export function ScanBadge({ tone, icon, children }: { tone: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <Chip
      size="small"
      color={tone}
      variant={tone === 'default' ? 'outlined' : 'filled'}
      icon={icon as React.ReactElement | undefined}
      label={children}
      sx={{ fontWeight: 600 }}
    />
  )
}

/** One scannable target: identity, status badges, Scan/Rescan, and an expandable findings area. */
export function ScanTargetCard({ icon, name, subtitle, meta, badge, scanning, scanDisabled, hasResult, expanded, onScan, onToggle, actions, trailing, console: liveConsole, children }: {
  icon: ReactNode
  name: string
  subtitle: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  scanning: boolean
  scanDisabled?: boolean
  /** Extra controls shown before the Scan button (edit, delete…). */
  actions?: ReactNode
  /** Extra controls shown after the Scan button (export…). */
  trailing?: ReactNode
  /** Live output shown under the header while scanning. */
  console?: ReactNode
  hasResult: boolean
  expanded: boolean
  onScan: () => void
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <Card sx={{ overflow: 'hidden' }}>
      <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 1, border: 1, borderColor: 'divider', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography variant="subtitle2" sx={{ fontFamily: 'var(--font-mono)' }}>{name}</Typography>
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        </Box>
        {(meta || badge) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>{meta}{badge}</Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          {actions}
          <Button variant="secondary" size="sm" loading={scanning} disabled={scanDisabled} icon={<RefreshCw size={14} />} onClick={onScan}>
            {hasResult ? 'Rescan' : 'Scan'}
          </Button>
          {trailing}
          {hasResult && (
            <IconButton onClick={onToggle} aria-label={expanded ? 'Collapse findings' : 'Expand findings'} aria-expanded={expanded}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </IconButton>
          )}
        </Box>
      </Box>
      {liveConsole}
      <Collapse in={hasResult && expanded} unmountOnExit>
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>{children}</Box>
      </Collapse>
    </Card>
  )
}

export function MetaText({ children }: { children: ReactNode }) {
  return <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'var(--font-mono)' }}>{children}</Typography>
}

export function FindingsTable({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>{columns.map(c => <TableCell key={c} sx={{ bgcolor: 'action.hover' }}>{c}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </TableContainer>
  )
}

export function Cell({ children, mono, sx }: { children: ReactNode; mono?: boolean; sx?: object }) {
  return <TableCell sx={{ fontSize: 12, ...(mono ? { fontFamily: 'var(--font-mono)' } : {}), ...sx }}>{children}</TableCell>
}

export function TargetList({ empty, children }: { empty: { icon: LucideIcon; text: string } | null; children: ReactNode }) {
  if (empty) return <Paper variant="outlined"><EmptyState icon={empty.icon} title={empty.text} /></Paper>
  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pb: 4 }}>{children}</Box>
}
