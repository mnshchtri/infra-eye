import React, { memo } from 'react'
import { User } from 'lucide-react'
import Markdown from 'react-markdown'
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
              components={{
                p: ({ children }) => <p style={{ marginBottom: 16 }}>{children}</p>,
                code: ({ children }) => (
                  <code style={{
                    background: 'rgba(129, 140, 248, 0.1)', padding: '2px 6px', borderRadius: 4,
                    fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: 'var(--brand-primary)',
                    fontWeight: 700
                  }}>{children}</code>
                ),
                pre: ({ children }) => (
                  <pre style={{
                    background: 'var(--bg-app)', padding: '20px', borderRadius: 12,
                    fontSize: 13, overflow: 'auto', margin: '16px 0', border: '1px solid var(--border)',
                    fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-primary)'
                  }}>{children}</pre>
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
