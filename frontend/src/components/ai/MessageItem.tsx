import React, { memo, useState, useCallback } from 'react'
import { User, Play, Loader, CheckCircle, AlertCircle, Terminal } from 'lucide-react'
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

const MCPToolCard = memo(({ raw, onExecute }: {
  raw: string
  onExecute?: (tool: string, args: Record<string, unknown>) => Promise<void>
}) => {
  const [runState, setRunState] = useState<RunState>('idle')

  let parsed: { tool: string; args?: Record<string, unknown> } | null = null
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    return (
      <pre style={{ background: 'var(--bg-app)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--danger)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {raw}
      </pre>
    )
  }

  if (!parsed || !parsed.tool) {
    return (
      <pre style={{ background: 'var(--bg-app)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--danger)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {raw}
      </pre>
    )
  }

  const isMutating = ['pods_delete', 'pods_exec', 'resources_create_or_update', 'resources_scale'].includes(parsed.tool)

  const handleRun = useCallback(async () => {
    if (!onExecute || !parsed) return
    setRunState('running')
    try {
      await onExecute(parsed.tool, parsed.args || {})
      setRunState('done')
    } catch {
      setRunState('error')
    }
  }, [onExecute, parsed])

  const stateColors: Record<RunState, string> = {
    idle: isMutating ? 'var(--warning)' : 'var(--brand-primary)',
    running: 'var(--text-muted)',
    done: 'var(--success)',
    error: 'var(--danger)',
  }

  return (
    <div style={{
      margin: '16px 0',
      borderRadius: 0,
      border: `1px solid ${isMutating ? 'var(--warning)' : 'var(--brand-primary)'}`,
      background: 'var(--bg-input)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 18px',
        background: isMutating ? 'var(--warning)' : 'var(--brand-primary)',
        borderBottom: `1px solid ${isMutating ? 'var(--warning)' : 'var(--brand-primary)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Terminal size={14} color="var(--text-inverse)" />
          <span style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-inverse)', fontFamily: 'var(--font-mono)' }}>
            {isMutating ? 'SYSTEM OVERRIDE' : 'QUERY PROTOCOL'}
          </span>
          <code style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-inverse)', border: '1px solid rgba(0,0,0,0.1)', padding: '2px 8px', fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.05)' }}>
            {parsed.tool}
          </code>
        </div>
        <button
          onClick={handleRun}
          disabled={runState === 'running' || runState === 'done'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 0, border: 'none',
            background: 'var(--text-inverse)',
            color: 'var(--text-primary)',
            fontSize: 10, fontWeight: 900, cursor: runState === 'idle' ? 'pointer' : 'default',
            fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em'
          }}
        >
          {runState === 'idle' && <><Play size={12} /> EXECUTE</>}
          {runState === 'running' && <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> RUNNING</>}
          {runState === 'done' && <><CheckCircle size={12} /> COMPLETE</>}
          {runState === 'error' && <><AlertCircle size={12} /> FAILED</>}
        </button>
      </div>

      {/* Args preview */}
      {parsed.args && Object.keys(parsed.args).length > 0 && (
        <div style={{ padding: '10px 14px' }}>
          {Object.entries(parsed.args).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 6, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 800, minWidth: 100, textTransform: 'uppercase' }}>{k}</span>
              <span style={{ color: 'var(--text-primary)' }}>
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

MCPToolCard.displayName = 'MCPToolCard'

// ── MessageItem ────────────────────────────────────────────────────────────
export const MessageItem = memo(({ msg, onExecuteMcpTool }: Props) => {
  return (
    <div
      className="fade-up"
      style={{
        display: 'flex', gap: 16, width: '100%',
        flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
        alignItems: 'flex-start'
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 0, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: msg.role === 'assistant' ? 'var(--bg-card)' : 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        overflow: 'hidden', padding: msg.role === 'assistant' ? 4 : 0
      }}>
        {msg.role === 'assistant' ? (
          <img src={chatbotLogo} alt="AI" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <User size={18} color="var(--brand-primary)" />
        )}
      </div>

      <div style={{
        maxWidth: '80%',
        display: 'flex', flexDirection: 'column',
        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
      }}>
        <div style={{
          fontSize: 10, color: 'var(--text-muted)', fontWeight: 900,
          textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.1em', fontFamily: 'var(--font-mono)'
        }}>
          {msg.role === 'assistant' ? 'नेत्र intelligence' : 'System Analyst'}
        </div>

        <div style={{
          padding: msg.role === 'assistant' ? '0' : '14px 20px',
          borderRadius: 0, fontSize: '13px', lineHeight: 1.7,
          color: 'var(--text-primary)',
          ...(msg.role === 'user' && {
            background: 'var(--bg-input)',
            border: '1px solid var(--border)'
          }),
          ...(msg.role === 'assistant' && {
            fontFamily: 'inherit'
          })
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
                blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--brand-primary)', margin: '12px 0', color: 'var(--text-secondary)', fontStyle: 'italic', background: 'var(--bg-app)', padding: '8px 12px', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>{children}</blockquote>,
                strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
                code: ({ children, className }) => {
                  const isInline = !className
                  return isInline ? (
                    <code style={{
                      background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 0,
                      fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)',
                      fontWeight: 900, border: '1px solid var(--border)'
                    }}>{children}</code>
                  ) : (
                    <code style={{ fontFamily: 'var(--font-mono)' }}>{children}</code>
                  )
                },
                pre: ({ children, ...props }) => {
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
                  return (
                    <div style={{ margin: '16px 0', borderRadius: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 14px', background: 'var(--bg-elevated)',
                        borderBottom: '1px solid var(--border)'
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--brand-primary)', fontFamily: 'var(--font-mono)' }}>
                          {lang}
                        </span>
                        <button
                          onClick={() => navigator.clipboard.writeText(code)}
                          style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                        >
                          COPY
                        </button>
                      </div>
                      <pre style={{
                        background: 'var(--bg-input)', padding: '14px 16px',
                        fontSize: '11px', overflowX: 'auto', margin: 0,
                        fontFamily: 'var(--font-mono)', color: 'var(--text-primary)',
                        whiteSpace: 'pre', wordBreak: 'normal', lineHeight: 1.6,
                        maxHeight: '400px', overflowY: 'auto'
                      }}>{children}</pre>
                    </div>
                  )
                },
                table: ({ children }) => (
                  <div style={{ overflowX: 'auto', marginBottom: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                    <table className="k-table" style={{ margin: 0, border: 'none', tableLayout: 'auto' }}>
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th style={{ padding: '12px 16px', textAlign: 'left', borderBottom: '2px solid var(--border)', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', background: 'rgba(248, 250, 252, 0.05)', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
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
            <div style={{ fontWeight: 600 }}>
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
