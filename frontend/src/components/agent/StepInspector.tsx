import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X } from 'lucide-react'
import {
  Box, IconButton, Link, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography, useTheme,
} from '@mui/material'
import { Badge } from '../ui'
import type { AgentStep } from '../../pages/agentTypes'
import { kindMeta, nodeColor } from './agentFlowMeta'

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

const markdownSx = {
  '& p': { m: 0, mb: 1.25 },
  '& ul, & ol': { mt: 0, mb: 1.25, pl: 2.5, color: 'text.secondary' },
  '& ul': { listStyleType: 'disc' },
  '& ol': { listStyleType: 'decimal' },
  '& li': { mb: 0.625, lineHeight: 1.6, pl: 0.25 },
  '& h1': { fontSize: 15, fontWeight: 600, mt: 2, mb: 1 },
  '& h2': { fontSize: 14, fontWeight: 600, mt: 2, mb: 1 },
  '& h3, & h4': { fontSize: 13, fontWeight: 600, mt: 1.5, mb: 0.75 },
  '& hr': { border: 'none', borderTop: 1, borderColor: 'divider', my: 1.75 },
  '& strong': { fontWeight: 700 },
  '& blockquote': { borderLeft: 3, borderColor: 'primary.main', mx: 0, my: 1.25, color: 'text.secondary', bgcolor: 'action.hover', px: 1.5, py: 1, borderRadius: '0 4px 4px 0' },
} as const

const markdownComponents: Components = {
  a: ({ href, children }) => <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover">{children}</Link>,
  code: ({ children, className }) => {
    const isInline = !className
    return isInline ? (
      <Box component="code" sx={{
        bgcolor: 'action.hover', px: 0.75, py: '1px', borderRadius: 0.5, fontFamily: 'var(--font-mono)', fontSize: 12,
        fontWeight: 600, border: 1, borderColor: 'divider', overflowWrap: 'anywhere',
      }}>{children}</Box>
    ) : (
      <code style={{ fontFamily: 'var(--font-mono)' }}>{children}</code>
    )
  },
  pre: ({ children }) => (
    <Box component="pre" sx={{ m: 0, mb: 1.25, px: 1.5, py: 1.25, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: 11.5, fontFamily: 'var(--font-mono)', border: 1, borderColor: 'divider' }}>{children}</Box>
  ),
  table: ({ children }) => (
    <TableContainer component={Paper} variant="outlined" sx={{ mb: 1.25 }}>
      <Table size="small">{children}</Table>
    </TableContainer>
  ),
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.5 }}>{children}</TableCell>,
  td: ({ children }) => <TableCell sx={{ color: 'text.secondary', verticalAlign: 'top', lineHeight: 1.5 }}>{children}</TableCell>,
}

const preSx = {
  m: 0, px: 1.5, py: 1.125, bgcolor: 'action.hover', borderRadius: 1, fontSize: 11.5,
  overflowX: 'auto', fontFamily: 'var(--font-mono)',
} as const

interface StepInspectorProps {
  step: AgentStep
  onClose: () => void
}

export function StepInspector({ step, onClose }: StepInspectorProps) {
  const theme = useTheme()
  const color = nodeColor(step, theme)
  const meta = kindMeta(step.kind, theme)
  const isFinal = step.kind === 'final_answer'

  return (
    <Paper
      className="fade-up"
      elevation={8}
      component="aside"
      aria-label={`Step ${step.step_number} details`}
      sx={{
        position: 'absolute', top: 14, right: 14, bottom: 14, width: 380, maxWidth: 'calc(100% - 28px)',
        border: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 20,
      }}
    >
      <Box sx={{ px: 2, py: 1.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary">Step {step.step_number}</Typography>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color, lineHeight: 1.3 }}>{meta.label}</Typography>
          {step.tool_name && (
            <Box component="code" sx={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'text.secondary', bgcolor: 'action.hover', px: 0.875, py: 0.25, borderRadius: 0.75, mt: 0.75, display: 'inline-block' }}>{step.tool_name}</Box>
          )}
        </Box>
        <Tooltip title="Close">
          <IconButton aria-label="Close step details" onClick={onClose}><X size={14} /></IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {step.status === 'pending_approval' && <Badge variant="warning" dot>Awaiting approval — use the node's Approve / Reject buttons</Badge>}
        {step.status === 'rejected' && <Badge variant="neutral">Rejected</Badge>}

        {!isFinal && step.reasoning && (
          <Box sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6, ...markdownSx }}>
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{step.reasoning}</Markdown>
          </Box>
        )}

        {isFinal && (
          <Box sx={{ fontSize: 13.5, lineHeight: 1.6, ...markdownSx }}>
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{step.reasoning}</Markdown>
          </Box>
        )}

        {step.tool_args && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>Arguments</Typography>
            <Box component="pre" sx={{ ...preSx, color: 'text.secondary' }}>{prettyArgs(step.tool_args)}</Box>
          </Box>
        )}

        {step.status === 'executed' && step.output && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>Output</Typography>
            <Box component="pre" sx={{ ...preSx, maxHeight: 320, overflowY: 'auto' }}>{step.output}</Box>
          </Box>
        )}

        {step.status === 'failed' && step.error_text && (
          <Box>
            <Typography variant="caption" color="error" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>Error</Typography>
            <Box component="pre" sx={{ ...preSx, border: 1, borderColor: 'error.main', color: 'error.main', maxHeight: 320, overflowY: 'auto' }}>{step.error_text}</Box>
          </Box>
        )}
      </Box>
    </Paper>
  )
}
