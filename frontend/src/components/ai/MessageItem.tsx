import React, { memo, useState, useCallback } from 'react'
import { User, Play, Loader, CheckCircle, AlertCircle, Terminal, ShieldAlert, Copy, Check } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import chatbotLogo from '../../assets/chatbot-logo.png'

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

  let parsed: { tool: string; args?: Record<string, unknown> } | null = null
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    parsed = null
  }

  const handleRun = useCallback(async () => {
    if (!onExecute || !parsed?.tool) return
    if (MUTATING_TOOLS.includes(parsed.tool)) {
      const argsPreview = JSON.stringify(parsed.args || {}, null, 0)
      if (!window.confirm(`"${parsed.tool}" modifies the cluster:\n\n${argsPreview}\n\nRun it?`)) return
    }
    setRunState('running')
    try {
      await onExecute(parsed.tool, parsed.args || {})
      setRunState('done')
    } catch {
      setRunState('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExecute, raw])

  if (!parsed || !parsed.tool) {
    return (
      <pre style={{ background: 'var(--bg-app)', padding: 12, borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--danger)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {raw}
      </pre>
    )
  }

  const isMutating = MUTATING_TOOLS.includes(parsed.tool)
  const accent = isMutating ? 'var(--warning)' : 'var(--brand-primary)'

  return (
    <div style={{
      margin: '14px 0',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${accent}`,
      background: 'var(--bg-card)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', gap: 10, flexWrap: 'wrap',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {isMutating ? <ShieldAlert size={14} color={accent} /> : <Terminal size={14} color={accent} />}
          <code style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {parsed.tool}
          </code>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: accent, border: `1px solid ${accent}`, padding: '1px 7px', borderRadius: 99,
          }}>
            {isMutating ? 'Mutating' : 'Read-only'}
          </span>
        </div>
        <button
          onClick={handleRun}
          disabled={runState === 'running' || runState === 'done'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: `1px solid ${accent}`,
            background: runState === 'idle' ? accent : 'transparent',
            color: runState === 'idle' ? 'var(--text-inverse)' : accent,
            fontSize: 12, fontWeight: 800, cursor: runState === 'idle' ? 'pointer' : 'default',
          }}
        >
          {runState === 'idle' && <><Play size={13} /> Execute</>}
          {runState === 'running' && <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> Running</>}
          {runState === 'done' && <><CheckCircle size={13} /> Done</>}
          {runState === 'error' && <><AlertCircle size={13} /> Failed</>}
        </button>
      </div>

      {/* Args preview */}
      {parsed.args && Object.keys(parsed.args).length > 0 && (
        <div style={{ padding: '10px 14px' }}>
          {Object.entries(parsed.args).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 4, fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 700, minWidth: 90 }}>{k}</span>
              <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
      {isMutating && runState === 'idle' && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
          This action changes cluster state — review the arguments before executing.
        </div>
      )}
    </div>
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
    <div style={{ margin: '14px 0', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden', maxWidth: '100%', minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {lang}
        </span>
        <button
          onClick={handleCopy}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: copied ? 'var(--success)' : 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          onMouseEnter={e => !copied && (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => !copied && (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <pre style={{
        background: 'var(--bg-input)', padding: '12px 14px',
        fontSize: 12.5, overflowX: 'auto', margin: 0,
        fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
        whiteSpace: 'pre', wordBreak: 'normal', lineHeight: 1.6,
        maxHeight: 400, overflowY: 'auto',
      }}>{children}</pre>
    </div>
  )
}

// ── MessageItem ────────────────────────────────────────────────────────────
export const MessageItem = memo(({ msg, onExecuteMcpTool }: Props) => {
  return (
    <div
      className="fade-up"
      style={{
        display: 'flex', gap: 14, width: '100%',
        flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 'var(--radius-md)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: msg.role === 'assistant' ? 'var(--bg-card)' : 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        overflow: 'hidden', padding: msg.role === 'assistant' ? 4 : 0,
      }}>
        {msg.role === 'assistant' ? (
          <img src={chatbotLogo} alt="Netra" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <User size={16} color="var(--brand-primary)" />
        )}
      </div>

      <div className="ai-msg-col" style={{
        display: 'flex', flexDirection: 'column',
        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
      }}>
        <div style={{
          fontSize: 12, color: 'var(--text-muted)', fontWeight: 700,
          marginBottom: 6, display: 'flex', gap: 8, alignItems: 'baseline',
        }}>
          <span>{msg.role === 'assistant' ? 'Netra' : 'You'}</span>
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            {msg.timestamp instanceof Date && !isNaN(msg.timestamp.getTime())
              ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : ''}
          </span>
        </div>

        <div style={{
          padding: msg.role === 'assistant' ? 0 : '12px 16px',
          borderRadius: msg.role === 'user' ? 'var(--radius-lg)' : 0,
          fontSize: 13, lineHeight: 1.7,
          color: 'var(--text-primary)',
          maxWidth: '100%', minWidth: 0, overflowWrap: 'break-word',
          ...(msg.role === 'user' && {
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
          }),
        }}>
          {msg.role === 'assistant' ? (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p style={{ marginBottom: 12 }}>{children}</p>,
                ul: ({ children }) => <ul style={{ marginBottom: 12, paddingLeft: 20, listStyleType: 'disc', color: 'var(--text-secondary)' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ marginBottom: 12, paddingLeft: 20, listStyleType: 'decimal', color: 'var(--text-secondary)' }}>{children}</ol>,
                li: ({ children }) => <li style={{ marginBottom: 4, lineHeight: 1.6, paddingLeft: 4 }}>{children}</li>,
                h1: ({ children }) => <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 12, marginTop: 16, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{children}</h1>,
                h2: ({ children }) => <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 10, marginTop: 16, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{children}</h2>,
                h3: ({ children }) => <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 8, marginTop: 12, color: 'var(--text-primary)' }}>{children}</h3>,
                h4: ({ children }) => <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 8, marginTop: 12, color: 'var(--text-primary)' }}>{children}</h4>,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: 500 }}>{children}</a>,
                blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--brand-primary)', margin: '12px 0', color: 'var(--text-secondary)', background: 'var(--bg-app)', padding: '8px 12px', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>{children}</blockquote>,
                strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
                code: ({ children, className }) => {
                  const isInline = !className
                  return isInline ? (
                    <code style={{
                      background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4,
                      fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-primary)',
                      fontWeight: 700, border: '1px solid var(--border)',
                      overflowWrap: 'anywhere',
                    }}>{children}</code>
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
                  <div style={{ overflowX: 'auto', marginBottom: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                    <table className="k-table" style={{ margin: 0, border: 'none', tableLayout: 'auto' }}>
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th style={{ padding: '12px 16px', textAlign: 'left', borderBottom: '2px solid var(--border)', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', background: 'rgba(248, 250, 252, 0.05)', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 'var(--text-xs)', whiteSpace: 'normal', wordBreak: 'break-word', color: 'var(--text-secondary)', verticalAlign: 'top' }}>
                    {children}
                  </td>
                ),
              }}
            >
              {msg.content}
            </Markdown>
          ) : (
            <div style={{ fontWeight: 500, whiteSpace: 'pre-wrap' }}>
              {msg.content}
              {msg.image && (
                <div style={{ marginTop: 12 }}>
                  <img src={msg.image} alt="Upload" style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

MessageItem.displayName = 'MessageItem'
