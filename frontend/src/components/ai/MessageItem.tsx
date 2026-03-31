import React, { memo } from 'react'
import { User } from 'lucide-react'
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

export const MessageItem = memo(({ msg }: { msg: Message }) => {
  return (
    <div
      className="fade-up"
      style={{
        display: 'flex', gap: 24, width: '100%',
        flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
        alignItems: 'flex-start'
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: msg.role === 'assistant' ? 'var(--bg-card)' : 'var(--bg-elevated)',
        border: '1px solid var(--border-bright)',
        overflow: 'hidden', padding: msg.role === 'assistant' ? 6 : 0,
        boxShadow: msg.role === 'assistant' ? '0 4px 12px var(--brand-glow)' : 'none'
      }}>
        {msg.role === 'assistant' ? (
          <img src={chatbotLogo} alt="AI" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <User size={18} color="var(--text-muted)" />
        )}
      </div>

      <div style={{
        maxWidth: '80%',
        display: 'flex', flexDirection: 'column',
        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
      }}>
        <div style={{ 
          fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, 
          textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.02em' 
        }}>
          {msg.role === 'assistant' ? 'नेत्र' : 'Analyst'}
        </div>

        <div style={{
          padding: msg.role === 'assistant' ? '0' : '16px 22px',
          borderRadius: 18, fontSize: 15, lineHeight: 1.7,
          color: 'var(--text-primary)',
          ...(msg.role === 'user' && {
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderTopRightRadius: 2,
            boxShadow: 'var(--shadow-sm)'
          }),
          ...(msg.role === 'assistant' && {
            borderTopLeftRadius: 0
          })
        }}>
          {msg.role === 'assistant' ? (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p style={{ marginBottom: 16 }}>{children}</p>,
                ul: ({ children }) => <ul style={{ marginBottom: 16, paddingLeft: 24, listStyleType: 'disc', color: 'var(--text-secondary)' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ marginBottom: 16, paddingLeft: 24, listStyleType: 'decimal', color: 'var(--text-secondary)' }}>{children}</ol>,
                li: ({ children }) => <li style={{ marginBottom: 6, lineHeight: 1.6, paddingLeft: 4 }}>{children}</li>,
                h1: ({ children }) => <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, marginTop: 24, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{children}</h1>,
                h2: ({ children }) => <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 14, marginTop: 24, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{children}</h2>,
                h3: ({ children }) => <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, marginTop: 20, color: 'var(--text-primary)' }}>{children}</h3>,
                h4: ({ children }) => <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, marginTop: 16, color: 'var(--text-primary)' }}>{children}</h4>,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: 500 }}>{children}</a>,
                blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--brand-primary)', margin: '16px 0', color: 'var(--text-secondary)', fontStyle: 'italic', background: 'var(--bg-app)', padding: '12px 16px', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>{children}</blockquote>,
                strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>,
                code: ({ children, className }) => {
                  const isInline = !className;
                  return isInline ? (
                    <code style={{
                      background: 'rgba(129, 140, 248, 0.1)', padding: '2px 6px', borderRadius: 4,
                      fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: 'var(--brand-primary)',
                      fontWeight: 600, border: '1px solid rgba(129, 140, 248, 0.2)'
                    }}>{children}</code>
                  ) : (
                    <code style={{ fontFamily: '"JetBrains Mono", monospace' }}>{children}</code>
                  );
                },
                pre: ({ children }) => (
                  <pre style={{
                    background: 'var(--bg-app)', padding: '16px', borderRadius: 'var(--radius-lg)',
                    fontSize: 13, overflow: 'auto', margin: '16px 0', border: '1px solid var(--border)',
                    fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-primary)',
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
                  }}>{children}</pre>
                ),
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
                  <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, whiteSpace: 'normal', wordBreak: 'break-word', color: 'var(--text-secondary)', verticalAlign: 'top' }}>
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
