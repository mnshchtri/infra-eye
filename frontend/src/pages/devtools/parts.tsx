import type { ReactNode, KeyboardEvent, ChangeEvent, InputHTMLAttributes } from 'react'
import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import Paper from '@mui/material/Paper'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import { alpha, useTheme } from '@mui/material/styles'
import { Check, Copy, type LucideIcon } from 'lucide-react'

type Kids = { children?: ReactNode; sx?: SxProps<Theme> }

/** Body of one tool: vertical stack with consistent spacing. */
export function ToolBody({ children, gap = 18 }: Kids & { gap?: number }) {
  return <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: `${gap}px` }}>{children}</Box>
}

export function Toolbar({ children, sx }: Kids) {
  return <Box sx={[{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}>{children}</Box>
}

export function ToolbarSpacer({ children }: Kids) {
  return <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{children}</Box>
}

export function ErrorBanner({ children, neutral, tone, mono }: Kids & { neutral?: boolean; tone?: 'success' | 'warning'; mono?: boolean }) {
  const key = neutral ? null : tone ?? 'error'
  return (
    <Box
      role={key === 'error' ? 'alert' : undefined}
      sx={(t: Theme) => ({
        px: 2, py: 1.5, fontSize: mono ? 12.5 : 13, display: 'flex', alignItems: 'center', gap: 1, borderRadius: 1,
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        bgcolor: key ? alpha(t.palette[key].main, 0.1) : 'action.hover',
        color: key ? (key === 'warning' ? 'warning.dark' : `${key}.main`) : 'text.secondary',
      })}
    >
      {children}
    </Box>
  )
}

export function Pane({ children }: Kids) {
  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 }}>{children}</Box>
}

export function PaneLabelRow({ children }: Kids) {
  return <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{children}</Box>
}

export function PaneLabel({ children, block, color = 'text.secondary' }: Kids & { block?: boolean; color?: string }) {
  return (
    <Typography component="span" variant="caption" sx={{ fontWeight: 600, color, display: block ? 'block' : undefined, mb: block ? 1 : 0 }}>
      {children}
    </Typography>
  )
}

export function SplitPane({ children }: Kids) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5, alignItems: 'start' }}>{children}</Box>
  )
}

/** Auto-fit grid for result tiles. */
export function ResultGrid({ children, gap = 16 }: Kids & { gap?: number }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: `${gap}px` }}>{children}</Box>
  )
}

/** Tinted surface used for inputs rows and option groups. */
export function ToolCard({ children, sx }: Kids) {
  return <Paper variant="outlined" sx={[{ p: 2, bgcolor: 'background.default' }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}>{children}</Paper>
}

interface ToolTextareaProps {
  value: string
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown?: (e: KeyboardEvent) => void
  placeholder?: string
  readOnly?: boolean
  spellCheck?: boolean
  'aria-label'?: string
  rows?: number
  breakAll?: boolean
}

/** Monospace multi-line editor. Plain textarea inside MUI so tests/IME behave natively. */
export function ToolTextarea({ value, onChange, onKeyDown, placeholder, readOnly, spellCheck = false, rows = 16, breakAll, ...rest }: ToolTextareaProps) {
  return (
    <TextField
      multiline
      rows={rows}
      fullWidth
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      sx={{
        '& .MuiInputBase-root': { alignItems: 'flex-start', bgcolor: readOnly ? 'background.default' : undefined, p: 0 },
        '& textarea': {
          fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, p: '12px 14px', resize: 'vertical',
          wordBreak: breakAll ? 'break-all' : undefined,
        },
      }}
      slotProps={{ htmlInput: { readOnly, spellCheck, 'aria-label': rest['aria-label'] ?? (readOnly ? 'Output' : 'Input') } }}
    />
  )
}

type ToolInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'style'> & {
  'aria-label'?: string
  big?: boolean
  mono?: boolean
  width?: number | string
}

/** Single-line field. `big` is the large readout-style input used by the converters. */
export function ToolInput({ big, mono, width, 'aria-label': ariaLabel, ...props }: ToolInputProps) {
  return (
    <TextField
      size="small"
      fullWidth={!width}
      sx={{
        width,
        '& input': {
          fontFamily: big || mono ? 'var(--font-mono)' : undefined,
          fontSize: big ? 20 : undefined,
          height: big ? 36 : undefined,
        },
      }}
      slotProps={{ htmlInput: { ...props, 'aria-label': ariaLabel } }}
    />
  )
}

/** Small icon-only action; always labelled and with a tooltip. */
export function IconAction({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton size="small" aria-label={label} onClick={onClick} disabled={disabled} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {children}
        </IconButton>
      </span>
    </Tooltip>
  )
}

export function StatBadge({ children }: Kids) {
  return <Chip size="small" variant="outlined" label={children} sx={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
}

type Tone = 'warn' | 'ok' | 'edit' | undefined

export function ToolChip({ tone, children }: Kids & { tone?: Tone }) {
  const color = tone === 'warn' ? 'error' : tone === 'ok' ? 'success' : tone === 'edit' ? 'warning' : 'default'
  return <Chip size="small" color={color} variant={tone ? 'filled' : 'outlined'} label={children} sx={{ fontFamily: 'var(--font-mono)', fontSize: 12, height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 } }} />
}

export function OptionGroup({ children }: Kids) {
  return <ToolCard sx={{ py: 0.5, px: 2, display: 'flex', flexDirection: 'column' }}>{children}</ToolCard>
}

export function OptionRow({ children }: Kids) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 20px', py: 1, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
      {children}
    </Box>
  )
}

export function OptionRowLabel({ children }: Kids) {
  return <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 92 }}>{children}</Typography>
}

/** Inline label wrapping text + a small control. */
export function OptionLabel({ children }: Kids) {
  return <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, color: 'text.secondary' }}>{children}</Box>
}

export function OptionCheckbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <FormControlLabel
      control={<Checkbox size="small" checked={checked} onChange={e => onChange(e.target.checked)} />}
      label={children}
      sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 13, color: 'text.secondary' } }}
    />
  )
}

export function DocCard({ children, dropped }: Kids & { dropped?: boolean }) {
  return (
    <ToolCard sx={{ py: 1.25, px: 1.75, ...(dropped ? { borderLeft: 3, borderLeftColor: 'text.disabled', opacity: 0.75 } : {}) }}>{children}</ToolCard>
  )
}

export function DocTitle({ children }: Kids) {
  return <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{children}</Box>
}

export function NamespaceBar({ children }: Kids) {
  return <ToolCard sx={{ borderLeft: 3, borderLeftColor: 'primary.main', py: 1.5 }}>{children}</ToolCard>
}

export function TableWrap({ children }: Kids) {
  return <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>{children}</Box>
}

/** Native table styled from the theme (keeps th/td/tr markup as-is). */
export function DevTable({ children }: Kids) {
  return (
    <Box
      component="table"
      sx={{
        width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12.5,
        '& th': { textAlign: 'left', px: 1.75, py: 1.25, bgcolor: 'action.hover', color: 'text.secondary', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' },
        '& td': { px: 1.75, py: 1.1, borderTop: 1, borderColor: 'divider', color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.5 },
        '& tbody tr:hover td': { bgcolor: 'action.hover' },
      }}
    >
      {children}
    </Box>
  )
}

/** Copy button glyph that flips to a green check once copied. */
export function CopyIcon({ copied, size = 14, icon: Icon = Copy }: { copied: boolean; size?: number; icon?: LucideIcon }) {
  const theme = useTheme()
  return copied ? <Check size={size} color={theme.palette.success.main} /> : <Icon size={size} />
}

/** Native select styled via MUI. */
export function ToolSelect({ value, onChange, children, width, 'aria-label': ariaLabel }: {
  value: string
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
  width?: number | string
  'aria-label': string
}) {
  return (
    <TextField
      select
      size="small"
      value={value}
      onChange={onChange as unknown as (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void}
      sx={{ width, '& select': { fontFamily: 'var(--font-mono)' } }}
      slotProps={{ select: { native: true }, htmlInput: { 'aria-label': ariaLabel } }}
    >
      {children}
    </TextField>
  )
}
