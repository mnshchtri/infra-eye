import { useState, useRef, useEffect } from 'react'
import { Bot, Send, Loader2, Sparkles, Server, User, ChevronDown } from 'lucide-react'
import { api } from '../api/client'
import Markdown from 'react-markdown'

interface ServerData { id: number; name: string }

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const SUGGESTIONS = [
  'Analyze high CPU usage and suggest fixes',
  'Check for memory leaks and recommend solutions',
  'What kubectl commands should I run to debug pods?',
  'Generate a health report for this server',
]

export function AIAssistant() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [selectedServer, setSelectedServer] = useState<number | ''>('')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1', role: 'assistant', timestamp: new Date(),
      content: "Hello! I'm your **InfraEye AI Assistant** — powered by live server context.\n\nSelect a server above and ask me to diagnose issues, analyze logs, generate remediation scripts, or explain Kubernetes errors.",
    }
  ])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function askQuestion(q?: string) {
    const text = q || question
    if (!text.trim() || loading) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setQuestion('')
    setLoading(true)
    try {
      const serverId = selectedServer ? Number(selectedServer) : 0
      const res = await api.post('/api/ai/chat', { server_id: serverId, question: text })
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'r', role: 'assistant',
        content: res.data.answer, timestamp: new Date()
      }])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'e', role: 'assistant',
        content: `**Error:** ${err.response?.data?.error || 'Failed to reach AI service. Please check your API key configuration.'}`,
        timestamp: new Date()
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      askQuestion()
    }
  }

  const selectedServerName = servers.find(s => s.id === Number(selectedServer))?.name

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{
        padding: '20px 40px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)', zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 13,
            background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px var(--brand-glow)',
          }}>
            <Bot size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
              AI Assistant
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Gemini 2.5 Flash · {messages.length - 1} messages
            </p>
          </div>
        </div>

        {/* Server selector */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Server size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 14, pointerEvents: 'none' }} />
          <select
            className="input"
            value={selectedServer}
            onChange={e => setSelectedServer(Number(e.target.value) || '')}
            style={{
              paddingLeft: 36, paddingRight: 36, paddingTop: 10, paddingBottom: 10,
              width: 220, fontSize: 13, background: 'var(--bg-elevated)',
              appearance: 'none', cursor: 'pointer',
            }}
          >
            <option value="">General Context</option>
            {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <ChevronDown size={14} color="var(--text-muted)" style={{ position: 'absolute', right: 14, pointerEvents: 'none' }} />
        </div>
      </div>

      {/* Context badge */}
      {selectedServer && (
        <div style={{
          padding: '8px 40px', background: 'rgba(129, 140, 248, 0.06)',
          borderBottom: '1px solid rgba(129, 140, 248, 0.15)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <Sparkles size={12} color="var(--brand-primary)" />
          <span style={{ fontSize: 12, color: 'var(--brand-primary)', fontWeight: 600 }}>
            Active context: {selectedServerName}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            — metrics, logs, and server state are available
          </span>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Suggestions (show only if 1 message) */}
        {messages.length === 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => askQuestion(s)}
                style={{
                  padding: '8px 14px', borderRadius: 20,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#eff6ff'
                  e.currentTarget.style.borderColor = 'var(--brand-glow)'
                  e.currentTarget.style.color = 'var(--brand-primary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'var(--bg-elevated)'
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className="fade-up"
            style={{
              display: 'flex', gap: 14, maxWidth: 760,
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }}
          >
            {/* Avatar */}
            <div style={{
              width: 36, height: 36, borderRadius: 11, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800,
              ...(msg.role === 'assistant'
                ? { background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))', boxShadow: '0 4px 12px var(--brand-glow)', color: 'var(--text-primary)' }
                : { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }
              ),
            }}>
              {msg.role === 'assistant' ? <Sparkles size={15} /> : <User size={15} />}
            </div>

            {/* Bubble */}
            <div style={{
              padding: '14px 18px', borderRadius: 18, fontSize: 14, lineHeight: 1.65,
              ...(msg.role === 'assistant'
                ? { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderTopLeftRadius: 4 }
                : { background: '#eff6ff', border: '1px solid #bfdbfe', borderTopRightRadius: 4 }
              ),
            }}>
              {msg.role === 'assistant' ? (
                <Markdown
                  components={{
                    p: ({ children }) => <p style={{ marginBottom: 8, color: 'var(--text-primary)' }}>{children}</p>,
                    code: ({ children }) => (
                      <code style={{
                        background: '#f1f5f9', padding: '2px 6px', borderRadius: 5,
                        fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: 'var(--brand-dark)',
                      }}>{children}</code>
                    ),
                    pre: ({ children }) => (
                      <pre style={{
                        background: '#f8fafc', padding: '12px 16px', borderRadius: 10,
                        fontSize: 12, overflow: 'auto', margin: '8px 0', border: '1px solid var(--border)',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}>{children}</pre>
                    ),
                    strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{children}</strong>,
                    ul: ({ children }) => <ul style={{ paddingLeft: 20, marginBottom: 8 }}>{children}</ul>,
                    li: ({ children }) => <li style={{ marginBottom: 4, color: 'var(--text-secondary)' }}>{children}</li>,
                  }}
                >
                  {msg.content}
                </Markdown>
              ) : (
                <span style={{ color: 'var(--text-primary)' }}>{msg.content}</span>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: msg.role === 'user' ? 'right' : 'left' }}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: 'flex', gap: 14, maxWidth: 760, alignSelf: 'flex-start' }} className="fade-up">
            <div style={{
              width: 36, height: 36, borderRadius: 11, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))',
              boxShadow: '0 4px 12px var(--brand-glow)',
            }}>
              <Loader2 size={15} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
            <div style={{
              padding: '14px 20px', borderRadius: 18, borderTopLeftRadius: 4,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s ease-in-out infinite' }} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s ease-in-out 0.2s infinite' }} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s ease-in-out 0.4s infinite' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div style={{
        padding: '16px 40px 24px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-card)',
        zIndex: 10, flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-end',
          background: 'var(--bg-app)',
          border: '1px solid var(--border)',
          borderRadius: 18, padding: '4px 4px 4px 18px',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
          onFocusCapture={e => {
            e.currentTarget.style.borderColor = 'var(--brand-primary)'
            e.currentTarget.style.boxShadow = '0 0 0 3px var(--brand-glow)'
          }}
          onBlurCapture={e => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          <textarea
            ref={inputRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about CPU spikes, log errors, kubectl commands… (Enter to send)"
            disabled={loading}
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 14, padding: '12px 0', resize: 'none',
              fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120,
            }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={() => askQuestion()}
            disabled={!question.trim() || loading}
            style={{
              width: 42, height: 42, borderRadius: 13, flexShrink: 0,
              background: question.trim() && !loading
                ? 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))'
                : 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s', cursor: question.trim() && !loading ? 'pointer' : 'not-allowed',
              border: 'none', boxShadow: question.trim() && !loading ? '0 4px 12px var(--brand-glow)' : 'none',
            }}
          >
            <Send size={16} color={question.trim() && !loading ? '#fff' : 'var(--text-muted)'} />
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
          Shift+Enter for new line · Enter to send
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
    </div>
  )
}
