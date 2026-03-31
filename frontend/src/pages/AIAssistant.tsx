import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { Send, Server, User, ChevronDown, Image as ImageIcon, X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
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
  const [provider, setProvider] = useState<'openrouter' | 'deepseek' | 'google'>('openrouter')
  
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [imageMime, setImageMime] = useState<string | null>(null)
  
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data)).catch(() => {})
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
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-app)' }}>
      
      <ThreadSidebar 
        threads={threads} 
        activeThreadId={activeThreadId}
        onSelect={setActiveThreadId}
        onNew={startNewChat}
        onDelete={deleteThread}
        isCollapsed={isSidebarCollapsed}
        onToggle={setIsSidebarCollapsed}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <header style={{
          width: '100%', padding: '24px 60px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-card)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'var(--bg-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 16px var(--brand-glow)',
              overflow: 'hidden', padding: 6, border: '1px solid var(--border-bright)'
            }}>
              <img src={chatbotLogo} alt="Netra" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>नेत्र</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Strategic Infrastructure Intelligence</span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Active Analysis</span>
              </div>
            </div>
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>AI Protocol</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                 <select value={provider} onChange={e => setProvider(e.target.value as any)}
                   style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer', outline: 'none' }}>
                   <option value="openrouter">OpenRouter (Auto)</option>
                   <option value="deepseek">DeepSeek (Native)</option>
                   <option value="google">Google Gemini</option>
                 </select>
                 <ChevronDown size={14} color="var(--text-muted)" />
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Context</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                 <Server size={14} color="var(--brand-primary)" />
                 <select value={selectedServer} onChange={e => setSelectedServer(Number(e.target.value) || '')}
                   style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer', outline: 'none' }}>
                   <option value="">Infrastructure Wide</option>
                   {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                 </select>
                 <ChevronDown size={14} color="var(--text-muted)" />
              </div>
            </div>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '40px 60px 160px' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 48 }}>
            {messages.length <= 1 && (
              <div className="fade-in" style={{ padding: '20px 0 60px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <h2 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tactical Protocols</h2>
                  <button onClick={handleClearHistory} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700 }}>
                    <Trash2 size={14} /> Purge History
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {SUGGESTIONS.map(s => <SuggestionButton key={s} text={s} onClick={askQuestion} />)}
                </div>
              </div>
            )}

            {messages.map((msg) => <MessageItem key={msg.id} msg={msg} />)}

            {loading && (
              <div style={{ display: 'flex', gap: 24, alignSelf: 'flex-start' }} className="fade-up">
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-bright)', padding: 6, boxShadow: '0 4px 12px var(--brand-glow)' }}>
                  <img src={chatbotLogo} alt="L" style={{ width: '100%', height: '100%', objectFit: 'contain', animation: 'pulseScale 1.8s infinite' }} />
                </div>
                <div style={{ padding: '8px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s infinite' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s 0.2s infinite' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1.2s 0.4s infinite' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 60px 48px', background: 'linear-gradient(to top, var(--bg-app) 40%, transparent)', pointerEvents: 'none' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', pointerEvents: 'auto' }}>
            {selectedImage && (
              <div className="fade-in" style={{ padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: '20px 20px 0 0', display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: -1, borderBottom: 'none', position: 'relative', marginLeft: 24, boxShadow: '0 -10px 30px rgba(0,0,0,0.1)' }}>
                <img src={selectedImage} alt="Preview" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }} />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Image Ready</div>
                <button onClick={() => { setSelectedImage(null); setImageMime(null) }} style={{ background: 'var(--bg-elevated)', border: 'none', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
              </div>
            )}

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: selectedImage ? '0 24px 24px 24px' : 24, padding: '10px 10px 10px 24px', boxShadow: '0 20px 50px rgba(0,0,0,0.15)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageSelect} />
              <button onClick={() => fileInputRef.current?.click()} style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><ImageIcon size={20} /></button>
              <textarea ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={handleKeyDown} placeholder="Initialize protocol analysis..." disabled={loading} rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 16, padding: '12px 0', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 180 }}
                onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px' }}
              />
              <button onClick={() => askQuestion()} disabled={(!question.trim() && !selectedImage) || loading} style={{ width: 48, height: 48, borderRadius: 16, flexShrink: 0, background: (question.trim() || selectedImage) && !loading ? 'var(--brand-primary)' : 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none' }}>
                <Send size={20} color={question.trim() || selectedImage ? '#fff' : 'var(--text-muted)'} />
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
