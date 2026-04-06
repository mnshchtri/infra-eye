import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { Send, Server, ChevronDown, Image as ImageIcon, X, Trash2, Zap } from 'lucide-react'
import { api } from '../api/client'
import chatbotLogo from '../assets/chatbot-logo.png'

// Sub-components
import { MessageItem } from '../components/ai/MessageItem'
import { ThreadSidebar } from '../components/ai/ThreadSidebar'

interface ServerData { id: number; name: string }

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  image?: string
}

interface ChatThread {
  id: number
  title: string
  created_at: string
  updated_at: string
}

const SUGGESTIONS = [
  'Run a post-mortem on the last 15 minutes of logs.',
  'Analyze resource utilization vs. limits for pods in the default namespace.',
  'Suggest a kubectl one-liner to find pods with restart count > 0.',
  'Check for potential zombie processes or memory leaks in the last metric snapshot.',
  'Draft a Terraform or Ansible snippet to scale this node\'s disk if it hits 90%.',
  'What\'s the MTTR for the recent alert spikes?',
]

const SuggestionButton = memo(({ text, onClick }: { text: string; onClick: (s: string) => void }) => (
  <button
    onClick={() => onClick(text)}
    style={{
      padding: '10px 18px', borderRadius: 0,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      color: 'var(--text-secondary)', fontSize: '10px', cursor: 'pointer',
      transition: 'all 0.15s', fontWeight: 900,
      fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em'
    }}
    onMouseEnter={e => {
      e.currentTarget.style.borderColor = 'var(--brand-primary)'
      e.currentTarget.style.color = 'var(--brand-primary)'
      e.currentTarget.style.background = 'var(--brand-glow)'
    }}
    onMouseLeave={e => {
      e.currentTarget.style.borderColor = 'var(--border)'
      e.currentTarget.style.color = 'var(--text-secondary)'
      e.currentTarget.style.background = 'var(--bg-card)'
    }}
  >
    {text}
  </button>
))

export function AIAssistant() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [selectedServer, setSelectedServer] = useState<number | ''>('')
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState<'openrouter' | 'deepseek' | 'google' | 'mistral'>('mistral')
  const [mcpAvailable, setMcpAvailable] = useState(false)
  
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [imageMime, setImageMime] = useState<string | null>(null)
  
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data)).catch(() => {})
    // Check MCP server availability
    api.get('/api/mcp/status').then(res => {
      setMcpAvailable(res.data?.available === true)
    }).catch(() => setMcpAvailable(false))
  }, [])

  const fetchThreads = useCallback(async () => {
    try {
      const res = await api.get(`/api/ai/threads?server_id=${selectedServer || 0}`)
      setThreads(res.data)
      if (res.data.length > 0 && !activeThreadId) {
        setActiveThreadId(res.data[0].id)
      } else if (res.data.length === 0) {
        setActiveThreadId(null)
      }
    } catch (err) {
      console.error("Failed to fetch AI threads", err)
    }
  }, [selectedServer, activeThreadId])

  useEffect(() => {
    fetchThreads()
  }, [selectedServer])

  const showWelcome = useCallback(() => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      timestamp: new Date(),
      content: "Systems online. I am **नेत्र (Netra)**.\n\nI've indexed your infrastructure. What's the mission? Post a log, ask for a post-mortem, or upload a dashboard capture. Let's make it stable."
    }])
  }, [])

  useEffect(() => {
    if (!activeThreadId) {
      showWelcome()
      return
    }

    const fetchHistory = async () => {
      try {
        const res = await api.get(`/api/ai/history/${activeThreadId}`)
        const history = res.data.map((m: any) => ({
          id: m.id.toString(),
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at)
        }))
        setMessages(history)
      } catch (err) {
        console.error("Failed to fetch AI history", err)
      }
    }
    fetchHistory()
  }, [activeThreadId, showWelcome])

  const startNewChat = useCallback(() => {
    setActiveThreadId(null)
    showWelcome()
  }, [showWelcome])

  const deleteThread = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('Delete this conversation?')) return
    try {
      await api.delete(`/api/ai/threads/${id}`)
      setThreads(prev => prev.filter(t => t.id !== id))
      if (activeThreadId === id) {
        setActiveThreadId(null)
      }
    } catch (err) {
      console.error("Failed to delete thread", err)
    }
  }, [activeThreadId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      setSelectedImage(base64)
      setImageMime(file.type)
    }
    reader.readAsDataURL(file)
  }, [])

  const askQuestion = useCallback(async (q?: string) => {
    const text = q || question
    if (!text.trim() && !selectedImage) return
    if (loading) return

    const base64Data = selectedImage ? selectedImage.split(',')[1] : ''
    const userMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      content: text, 
      timestamp: new Date(),
      image: selectedImage || undefined
    }
    
    setMessages(prev => [...prev, userMsg])
    setQuestion('')
    setSelectedImage(null)
    setImageMime(null)
    setLoading(true)

    try {
      const serverId = selectedServer ? Number(selectedServer) : 0
      const res = await api.post('/api/ai/chat', { 
        thread_id: activeThreadId,
        server_id: serverId, 
        question: text,
        image_base64: base64Data,
        image_mime_type: imageMime,
        provider: provider
      })
      
      const newAssistantMsg: Message = {
        id: Date.now().toString() + 'r', 
        role: 'assistant',
        content: res.data.answer, 
        timestamp: new Date()
      }
      
      setMessages(prev => [...prev, newAssistantMsg])

      if (!activeThreadId) {
        setActiveThreadId(res.data.thread_id)
        // Re-fetch threads to get the new one
        api.get(`/api/ai/threads?server_id=${selectedServer || 0}`).then(res => setThreads(res.data))
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'e', role: 'assistant',
        content: `**Error:** ${err.response?.data?.error || 'Failed to reach नेत्र service.'}`,
        timestamp: new Date()
      }])
    } finally {
      setLoading(false)
    }
  }, [question, selectedImage, loading, activeThreadId, selectedServer, provider])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      askQuestion()
    }
  }

  // MCP Tool execution — called by MessageItem when user clicks "▶ Execute"
  const executeMcpTool = useCallback(async (tool: string, args: Record<string, unknown>) => {
    try {
      const res = await api.post('/api/mcp/tool', {
        tool,
        arguments: args,
        server_id: selectedServer || 0,
      })
      const output: string = res.data?.output || JSON.stringify(res.data, null, 2)

      // Detect output format for syntax highlighting
      const trimmed = output.trim()
      let lang = 'text'
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) lang = 'json'
      else if (trimmed.includes(':\n') || /^[a-zA-Z]+:/m.test(trimmed)) lang = 'yaml'

      // Truncate very large outputs in the display card
      const lines = output.split('\n')
      const MAX_LINES = 60
      const isTruncated = lines.length > MAX_LINES
      const displayOutput = isTruncated
        ? lines.slice(0, MAX_LINES).join('\n') + `\n\n… (${lines.length - MAX_LINES} more lines)`
        : output

      const resultMsg: Message = {
        id: Date.now().toString() + '_mcp',
        role: 'assistant',
        content: [
          `**\`${tool}\`** — ${lines.length} lines retrieved`,
          '```' + lang,
          displayOutput,
          '```',
        ].join('\n'),
        timestamp: new Date()
      }
      setMessages(prev => [...prev, resultMsg])

      // Feed output back to AI for analysis silently
      setTimeout(() => {
        askQuestion(`Analyze the following \`${tool}\` output and summarize findings with actionable next steps:\n\`\`\`\n${output.slice(0, 4000)}\n\`\`\``)
      }, 400)
    } catch (err: any) {
      const errData = err.response?.data
      const errMsg: Message = {
        id: Date.now().toString() + '_mcperr',
        role: 'assistant',
        content: [
          `**⚠️ MCP Tool Error: \`${tool}\`** ${errData?.error || err.message}`,
          errData?.details ? `\n> ${errData.details}` : ''
        ].filter(Boolean).join('\n'),
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errMsg])
    }
  }, [selectedServer, askQuestion])

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm('Clear conversation history?')) return
    try {
      await api.delete(`/api/ai/history?server_id=${selectedServer || 0}`)
      showWelcome()
    } catch (err) {
      console.error("Failed to clear AI history", err)
    }
  }, [selectedServer, showWelcome])

  return (
    <div className={`ai-assistant-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ display: 'flex', height: '100%', background: 'var(--bg-app)', position: 'relative' }}>
      
      <div 
        className={`ai-sidebar-overlay ${!isSidebarCollapsed ? 'mobile-open' : ''}`} 
        onClick={() => setIsSidebarCollapsed(true)}
      />

      <ThreadSidebar 
        threads={threads} 
        activeThreadId={activeThreadId}
        onSelect={id => { setActiveThreadId(id); if (window.innerWidth <= 768) setIsSidebarCollapsed(true); }}
        onNew={() => { startNewChat(); if (window.innerWidth <= 768) setIsSidebarCollapsed(true); }}
        onDelete={deleteThread}
        isCollapsed={isSidebarCollapsed}
        onToggle={setIsSidebarCollapsed}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>
        <header className="ai-chat-header" style={{
          width: '100%', padding: '10px 20px', 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)', flexWrap: 'wrap', gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button 
              className="show-mobile-only btn-icon" 
              onClick={() => setIsSidebarCollapsed(false)}
              style={{ padding: 8, background: 'var(--bg-elevated)', borderRadius: 0, border: '1px solid var(--border)' }}
            >
              <Zap size={16} color="var(--brand-primary)" />
            </button>
            <div style={{
              width: 38, height: 38, borderRadius: 0,
              background: 'var(--bg-app)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', padding: 4, border: '1px solid var(--border)'
            }}>
              <img src={chatbotLogo} alt="Netra" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>नेत्र</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="hidden-mobile" style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Core Intelligence</span>
                <span className="hidden-mobile" style={{ width: 3, height: 3, background: 'var(--text-muted)' }} />
                <span style={{ fontSize: 9, color: 'var(--brand-primary)', fontWeight: 800, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Session Active</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Logic Engine</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                 <select value={provider} onChange={e => setProvider(e.target.value as any)}
                   style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 11, fontWeight: 900, cursor: 'pointer', outline: 'none', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                   <option value="openrouter">OpenRouter</option>
                   <option value="deepseek">DeepSeek</option>
                   <option value="google">Google</option>
                   <option value="mistral">Mistral</option>
                 </select>
                 <ChevronDown size={10} color="var(--text-muted)" />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Target System</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                 <select value={selectedServer} onChange={e => setSelectedServer(Number(e.target.value) || '')}
                   style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 11, fontWeight: 900, cursor: 'pointer', outline: 'none', maxWidth: 120, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                   <option value="">Infrastructure</option>
                   {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                 </select>
                 <ChevronDown size={10} color="var(--text-muted)" />
              </div>
            </div>
            
            {mcpAvailable && (
              <div className="hidden-mobile" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 0, background: 'var(--brand-glow)', border: '1px solid var(--brand-primary)20' }}>
                <Zap size={10} color="var(--brand-primary)" />
                <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--brand-primary)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>MCP Active</span>
              </div>
            )}
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 140px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {messages.length <= 1 && (
              <div className="fade-in" style={{ padding: '20px 0 60px', borderBottom: '1px solid #18181b', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                  <h2 style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', fontFamily: 'var(--font-mono)' }}>Deployment Protocols</h2>
                  <button onClick={handleClearHistory} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: '10px', fontWeight: 800, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                    <Trash2 size={13} /> Purge Audit Trail
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {SUGGESTIONS.map(s => <SuggestionButton key={s} text={s} onClick={askQuestion} />)}
                </div>
              </div>
            )}

            {messages.map((msg) => <MessageItem key={msg.id} msg={msg} onExecuteMcpTool={executeMcpTool} />)}

            {loading && (
              <div style={{ display: 'flex', gap: 16, alignSelf: 'flex-start' }} className="fade-up">
                <div style={{ width: 38, height: 38, borderRadius: 0, background: 'var(--bg-app)', overflow: 'hidden', padding: 4, border: '1px solid var(--border)' }}>
                  <img src={chatbotLogo} alt="L" style={{ width: '100%', height: '100%', objectFit: 'contain', animation: 'pulseScale 1.8s infinite' }} />
                </div>
                <div style={{ padding: '12px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 4, height: 4, background: 'var(--brand-primary)', animation: 'blink 1s infinite' }} />
                  <span style={{ width: 4, height: 4, background: 'var(--brand-primary)', animation: 'blink 1s 0.2s infinite' }} />
                  <span style={{ width: 4, height: 4, background: 'var(--brand-primary)', animation: 'blink 1s 0.4s infinite' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="ai-input-wrapper" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px', background: 'linear-gradient(to top, var(--bg-app) 40%, transparent)', pointerEvents: 'none' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', pointerEvents: 'auto' }}>
            {selectedImage && (
              <div className="fade-in image-preview-stack" style={{ padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: '16px 16px 0 0', display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: -1, borderBottom: 'none', position: 'relative', marginLeft: 16, boxShadow: '0 -10px 30px rgba(0,0,0,0.1)' }}>
                <img src={selectedImage} alt="Preview" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} />
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Ready</div>
                <button onClick={() => { setSelectedImage(null); setImageMime(null) }} style={{ background: 'var(--bg-elevated)', border: 'none', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
              </div>
            )}

            <div className="chat-input-container" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 0, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageSelect} />
              <button className="hidden-mobile" onClick={() => fileInputRef.current?.click()} style={{ width: 32, height: 32, borderRadius: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><ImageIcon size={16} /></button>
              <textarea ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={handleKeyDown} placeholder="Enter command protocol..." disabled={loading} rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '13px', padding: '6px 0', resize: 'none', fontFamily: 'var(--font-mono)', lineHeight: 1.6, maxHeight: 150 }}
                onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px' }}
              />
              <button onClick={() => askQuestion()} disabled={(!question.trim() && !selectedImage) || loading} style={{ width: 40, height: 40, borderRadius: 0, flexShrink: 0, background: (question.trim() || selectedImage) && !loading ? 'var(--brand-primary)' : 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', transition: 'all 0.2s' }}>
                <Send size={16} color={question.trim() || selectedImage ? 'var(--text-inverse)' : 'var(--text-muted)'} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes pulseScale { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.9); } }
      `}</style>
    </div>
  )
}
