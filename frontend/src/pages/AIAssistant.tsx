import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Sparkles, Server, User, ChevronDown } from 'lucide-react'
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-app)', position: 'relative' }}>

      {/* Full-Width Header aligned to edges */}
      <div style={{
        width: '100%', padding: '24px 60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-card)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 16px var(--brand-glow)',
          }}>
            <Sparkles size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              InfraEye Assistant
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--brand-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Gemini 2.5 Flash
              </span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-muted)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                Live Infrastructure Session
              </span>
            </div>
          </div>
        </div>

        {/* Display-Aligned Server Switcher */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Target Cluster</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
               <Server size={14} color="var(--brand-primary)" />
               <select
                 className="input-minimal"
                 value={selectedServer}
                 onChange={e => setSelectedServer(Number(e.target.value) || '')}
                 style={{
                   background: 'transparent', border: 'none', color: 'var(--text-primary)',
                   fontSize: 14, fontWeight: 700, cursor: 'pointer', outline: 'none',
                   padding: 0, appearance: 'none'
                 }}
               >
                 <option value="">Global Infrastructure</option>
                 {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
               </select>
               <ChevronDown size={14} color="var(--text-muted)" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Conversation spanning the display */}
      <div style={{
        flex: 1, overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '40px 60px 140px', // Extra bottom padding for floating bar
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
          
          {/* Landing State Suggestions */}
          {messages.length === 1 && (
            <div style={{ padding: '20px 0 60px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 20 }}>
              <h2 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 20 }}>
                Suggested Insights
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => askQuestion(s)}
                    style={{
                      padding: '12px 20px', borderRadius: 12,
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer',
                      transition: 'all 0.2s', fontWeight: 600
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--brand-primary)'
                      e.currentTarget.style.background = 'var(--bg-elevated)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.background = 'var(--bg-card)'
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={msg.id}
              className="fade-up"
              style={{
                display: 'flex', gap: 24, width: '100%',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start'
              }}
            >
              {/* Avatar on the respective side */}
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: msg.role === 'assistant' 
                  ? 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))' 
                  : 'var(--bg-elevated)',
                border: msg.role === 'assistant' ? 'none' : '1px solid var(--border)',
                color: '#fff',
                boxShadow: msg.role === 'assistant' ? '0 4px 12px var(--brand-glow)' : 'none'
              }}>
                {msg.role === 'assistant' ? <Sparkles size={18} /> : <User size={18} color="var(--text-muted)" />}
              </div>

              {/* Message Content anchored to edge */}
              <div style={{
                maxWidth: '75%',
                display: 'flex', flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}>
                {/* Sender Tag */}
                <div style={{ 
                  fontSize: 10, color: 'var(--text-muted)', fontWeight: 800, 
                  textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.02em' 
                }}>
                  {msg.role === 'assistant' ? 'InfraEye AI' : 'You'}
                </div>

                <div style={{
                  padding: msg.role === 'assistant' ? '0' : '16px 22px',
                  borderRadius: 18, fontSize: 15, lineHeight: 1.7,
                  color: 'var(--text-primary)',
                  ...(msg.role === 'user' && {
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm)',
                    borderTopRightRadius: 2
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
                            background: '#0f172a', padding: '20px', borderRadius: 12,
                            fontSize: 13, overflow: 'auto', margin: '16px 0', border: '1px solid #1e293b',
                            fontFamily: '"JetBrains Mono", monospace', color: '#cbd5e1', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)'
                          }}>{children}</pre>
                        ),
                        strong: ({ children }) => <strong style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{children}</strong>,
                        ul: ({ children }) => <ul style={{ paddingLeft: 24, marginBottom: 16, listStyleType: 'square' }}>{children}</ul>,
                        li: ({ children }) => <li style={{ marginBottom: 8 }}>{children}</li>,
                      }}
                    >
                      {msg.content}
                    </Markdown>
                  ) : (
                    <div style={{ fontWeight: 600 }}>{msg.content}</div>
                  )}
                </div>
                
                {/* Timestamp */}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginTop: 8, opacity: 0.5 }}>
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          {/* Loading Indicator aligned to left */}
          {loading && (
            <div style={{ display: 'flex', gap: 24, alignSelf: 'flex-start' }} className="fade-up">
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))',
                boxShadow: '0 4px 12px var(--brand-glow)',
              }}>
                <Loader2 size={18} color="#fff" style={{ animation: 'spin 1.2s linear infinite' }} />
              </div>
              <div style={{ padding: '8px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s ease-in-out infinite' }} />
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s ease-in-out 0.2s infinite' }} />
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s ease-in-out 0.4s infinite' }} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Display-Aligned Floating Input Bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '24px 60px 48px',
        background: 'linear-gradient(to top, var(--bg-app) 40%, transparent)',
        pointerEvents: 'none'
      }}>
        <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-bright)',
            borderRadius: 20, padding: '10px 10px 10px 24px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
            display: 'flex', gap: 16, alignItems: 'center',
            pointerEvents: 'auto',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
            onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--brand-primary)' }}
            onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--border-bright)' }}
        >
          <textarea
            ref={inputRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message to InfraEye Assistant..."
            disabled={loading}
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', fontSize: 16, padding: '12px 0', resize: 'none',
              fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 180,
            }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 180) + 'px'
            }}
          />
          <button
            onClick={() => askQuestion()}
            disabled={!question.trim() || loading}
            style={{
              width: 48, height: 48, borderRadius: 14, flexShrink: 0,
              background: question.trim() && !loading
                ? 'linear-gradient(135deg, var(--brand-primary), var(--brand-dark))'
                : 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s', cursor: question.trim() && !loading ? 'pointer' : 'not-allowed',
              border: 'none', boxShadow: question.trim() && !loading ? '0 4px 12px var(--brand-glow)' : 'none',
            }}
          >
            <Send size={20} color={question.trim() && !loading ? '#fff' : 'var(--text-muted)'} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
    </div>
  )
}
