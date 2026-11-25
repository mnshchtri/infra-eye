import React, { memo, useState, useCallback } from 'react'
import { User, Play, Loader, CheckCircle, AlertCircle, Terminal, ShieldAlert, Copy, Check } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Avatar, Box, Button as MuiButton, Chip, Link, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography, alpha,
} from '@mui/material'
import chatbotLogo from '../../assets/chatbot-logo.png'
import { Modal, Button } from '../ui'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  image?: string
}

interface Props {
  msg: Message
  onExecuteMcpTool?: (tool: string, args: Record<string, unknown>) => Promise<void>
}

// ── MCP Tool Call Card ─────────────────────────────────────────────────────
type RunState = 'idle' | 'running' | 'done' | 'error'

const MUTATING_TOOLS = ['pods_delete', 'pods_exec', 'resources_create_or_update', 'resources_scale']

const MCPToolCard = memo(({ raw, onExecute }: {
  raw: string
  onExecute?: (tool: string, args: Record<string, unknown>) => Promise<void>
}) => {
  const [runState, setRunState] = useState<RunState>('idle')
  const [confirmOpen, setConfirmOpen] = useState(false)

  let parsed: { tool: string; args?: Record<string, unknown> } | null = null
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    parsed = null
  }

  const run = useCallback(async () => {
    if (!onExecute || !parsed?.tool) return
    setRunState('running')
    try {
      await onExecute(parsed.tool, parsed.args || {})
      setRunState('done')
    } catch {
      setRunState('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExecute, raw])

  const handleRun = useCallback(() => {
    if (!onExecute || !parsed?.tool) return
    if (MUTATING_TOOLS.includes(parsed.tool)) {
      setConfirmOpen(true)
      return
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExecute, raw, run])

  if (!parsed || !parsed.tool) {
    return (
      <Box component="pre" sx={{ bgcolor: 'background.default', p: 1.5, borderRadius: 1, fontSize: 13, color: 'error.main', border: 1, borderColor: 'divider', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {raw}
      </Box>
    )
  }

  const isMutating = MUTATING_TOOLS.includes(parsed.tool)
  const accent = isMutating ? 'warning' : 'primary'
  const argsPreview = JSON.stringify(parsed.args || {}, null, 0)

  return (
    <Paper variant="outlined" sx={{ my: 1.75, overflow: 'hidden', borderLeft: 3, borderLeftColor: `${accent}.main` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.75, py: 1, gap: 1.25, flexWrap: 'wrap', bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          {isMutating ? <ShieldAlert size={14} /> : <Terminal size={14} />}
          <Typography component="code" sx={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{parsed.tool}</Typography>
          <Chip size="small" variant="outlined" color={accent} label={isMutating ? 'Mutating' : 'Read-only'} />
        </Box>
        <MuiButton
          size="small"
          variant={runState === 'idle' ? 'contained' : 'outlined'}
          color={accent}
          onClick={handleRun}
          disabled={runState === 'running' || runState === 'done'}
          startIcon={
            runState === 'idle' ? <Play size={13} />
              : runState === 'running' ? <Loader size={13} className="spin" />
                : runState === 'done' ? <CheckCircle size={13} /> : <AlertCircle size={13} />
          }
        >
          {runState === 'idle' ? 'Execute' : runState === 'running' ? 'Running' : runState === 'done' ? 'Done' : 'Failed'}
        </MuiButton>
      </Box>

      {parsed.args && Object.keys(parsed.args).length > 0 && (
        <Box sx={{ px: 1.75, py: 1.25 }}>
          {Object.entries(parsed.args).map(([k, v]) => (
            <Box key={k} sx={{ display: 'flex', gap: 1.25, mb: 0.5, fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 600, minWidth: 90 }}>{k}</Box>
              <Box component="span" sx={{ wordBreak: 'break-word' }}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {isMutating && runState === 'idle' && (
        <Typography variant="body2" sx={{ px: 1.75, py: 1, borderTop: 1, borderColor: 'divider', color: 'warning.main', fontWeight: 500 }}>
          This action changes cluster state — review the arguments before executing.
        </Typography>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Run mutating tool"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setConfirmOpen(false); run() }}>Run tool</Button>
          </>
        }
      >
        <Typography variant="body1" sx={{ mb: 1 }}><b>{parsed.tool}</b> modifies the cluster. Run it with these arguments?</Typography>
        <Box component="pre" sx={{ m: 0, p: 1.25, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{argsPreview}</Box>
      </Modal>
    </Paper>
  )
})

MCPToolCard.displayName = 'MCPToolCard'

// ── Code block with copy button ────────────────────────────────────────────
const CodeBlock = ({ lang, code, children }: { lang: string; code: string; children: React.ReactNode }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Paper variant="outlined" sx={{ my: 1.75, overflow: 'hidden', maxWidth: '100%', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.5, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontFamily: 'var(--font-mono)' }}>{lang}</Typography>
        <MuiButton
          size="small"
          color={copied ? 'success' : 'inherit'}
          onClick={handleCopy}
          startIcon={copied ? <Check size={12} /> : <Copy size={12} />}
          sx={{ color: copied ? undefined : 'text.secondary', minWidth: 0 }}
        >
          {copied ? 'Copied' : 'Copy'}
        </MuiButton>
      </Box>
      <Box component="pre" sx={{
        bgcolor: 'background.default', px: 1.75, py: 1.5, fontSize: 12.5, overflowX: 'auto', m: 0,
        fontFamily: 'var(--font-mono)', whiteSpace: 'pre', wordBreak: 'normal', lineHeight: 1.6,
        maxHeight: 400, overflowY: 'auto',
      }}>{children}</Box>
    </Paper>
  )
}

// ── MessageItem ────────────────────────────────────────────────────────────
const markdownSx = {
  '& p': { m: 0, mb: 1.5 },
  '& ul, & ol': { mt: 0, mb: 1.5, pl: 2.5, color: 'text.secondary' },
  '& ul': { listStyleType: 'disc' },
  '& ol': { listStyleType: 'decimal' },
  '& li': { mb: 0.5, lineHeight: 1.6, pl: 0.5 },
  '& h1': { fontSize: '1.125rem', fontWeight: 600, mt: 2, mb: 1.5 },
  '& h2': { fontSize: '1rem', fontWeight: 600, mt: 2, mb: 1.25 },
  '& h3, & h4': { fontSize: '0.875rem', fontWeight: 600, mt: 1.5, mb: 1 },
  '& strong': { fontWeight: 700 },
  '& blockquote': { fontSize: 13, lineHeight: 1.7, borderLeft: 3, borderColor: 'primary.main', mx: 0, my: 1.5, color: 'text.secondary', bgcolor: 'action.hover', px: 1.5, py: 1, borderRadius: '0 4px 4px 0' },
  '& blockquote p': { fontSize: 'inherit', m: 0, mb: 1 },
  '& blockquote p:last-child': { mb: 0 },
} as const

export const MessageItem = memo(({ msg, onExecuteMcpTool }: Props) => {
  const isUser = msg.role === 'user'
  return (
    <Box
      className="fade-up"
      sx={{ display: 'flex', gap: 1.75, width: '100%', flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start' }}
    >
      {isUser ? (
        <Avatar variant="rounded" sx={{ width: 32, height: 32, flexShrink: 0, bgcolor: 'action.hover', color: 'primary.main', border: 1, borderColor: 'divider' }}>
          <User size={16} />
        </Avatar>
      ) : (
        <Avatar variant="rounded" src={chatbotLogo} alt="Netra" sx={{ width: 32, height: 32, flexShrink: 0, bgcolor: 'background.paper', border: 1, borderColor: 'divider', p: 0.5, '& img': { objectFit: 'contain' } }} />
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', maxWidth: { xs: 'calc(100% - 8px)', md: '82%' }, minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mb: 0.75, color: 'text.secondary' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{isUser ? 'You' : 'Netra'}</Typography>
          <Typography variant="caption">
            {msg.timestamp instanceof Date && !isNaN(msg.timestamp.getTime())
              ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : ''}
          </Typography>
        </Box>

        <Box sx={{
          p: isUser ? '10px 14px' : 0,
          borderRadius: isUser ? 2 : 0,
          fontSize: 13, lineHeight: 1.7,
          maxWidth: '100%', minWidth: 0, overflowWrap: 'break-word',
          ...(isUser && { bgcolor: (t) => alpha(t.palette.primary.main, 0.1), border: 1, borderColor: (t) => alpha(t.palette.primary.main, 0.25) }),
          ...(!isUser && markdownSx),
        }}>
          {!isUser ? (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover">{children}</Link>,
                code: ({ children, className }) => {
                  const isInline = !className
                  return isInline ? (
                    <Box component="code" sx={{
                      bgcolor: 'action.hover', px: 0.75, py: '1px', borderRadius: 0.5,
                      fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600,
                      border: 1, borderColor: 'divider', overflowWrap: 'anywhere',
                    }}>{children}</Box>
                  ) : (
                    <code style={{ fontFamily: 'var(--font-mono)' }}>{children}</code>
                  )
                },
                pre: ({ children }) => {
                  // Detect MCP tool call blocks (```mcp ... ```)
                  const child = React.Children.only(children) as React.ReactElement<{ className?: string; children?: string }>
                  if (child?.props?.className === 'language-mcp') {
                    return (
                      <MCPToolCard
                        raw={String(child.props.children ?? '').trim()}
                        onExecute={onExecuteMcpTool}
                      />
                    )
                  }
                  const langClass = (child?.props?.className || '') as string
                  const lang = langClass.replace('language-', '') || 'text'
                  const code = String(child?.props?.children ?? '').trimEnd()
                  return <CodeBlock lang={lang} code={code}>{children}</CodeBlock>
                },
                table: ({ children }) => (
                  <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                    <Table size="small">{children}</Table>
                  </TableContainer>
                ),
                thead: ({ children }) => <TableHead>{children}</TableHead>,
                tbody: ({ children }) => <TableBody>{children}</TableBody>,
                tr: ({ children }) => <TableRow>{children}</TableRow>,
                th: ({ children }) => <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap', bgcolor: 'action.hover', lineHeight: 1.5 }}>{children}</TableCell>,
                td: ({ children }) => <TableCell sx={{ whiteSpace: 'normal', wordBreak: 'break-word', color: 'text.secondary', verticalAlign: 'top', lineHeight: 1.5 }}>{children}</TableCell>,
              }}
            >
              {msg.content}
            </Markdown>
          ) : (
            <Box sx={{ fontWeight: 500, whiteSpace: 'pre-wrap' }}>
              {msg.content}
              {msg.image && (
                <Box sx={{ mt: 1.5 }}>
                  <Box component="img" src={msg.image} alt="Upload" sx={{ maxWidth: '100%', borderRadius: 1.5, border: 1, borderColor: 'divider' }} />
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
})

MessageItem.displayName = 'MessageItem'
