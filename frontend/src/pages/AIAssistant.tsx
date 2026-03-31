import { useState, useRef, useEffect } from 'react'
import { Send, Server, User, ChevronDown, Image as ImageIcon, X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import Markdown from 'react-markdown'
import chatbotLogo from '../assets/chatbot-logo.png'

interface ServerData { id: number; name: string }

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  image?: string // Base64 preview for user messages
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
  
  // Multimodal state
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [imageMime, setImageMime] = useState<string | null>(null)
  
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data)).catch(() => {})
  }, [])

  // 1. Fetch Threads when server changes
  useEffect(() => {
    const fetchThreads = async () => {
      try {
        const res = await api.get(`/api/ai/threads?server_id=${selectedServer || 0}`)
        setThreads(res.data)
        // Auto-select first thread if nothing active
        if (res.data.length > 0 && !activeThreadId) {
          setActiveThreadId(res.data[0].id)
        } else if (res.data.length === 0) {
          setActiveThreadId(null)
          showWelcome()
        }
      } catch (err) {
        console.error("Failed to fetch AI threads", err)
      }
    }
    fetchThreads()
  }, [selectedServer])

  // 2. Fetch Messages when active thread changes
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
  }, [activeThreadId])

  const showWelcome = () => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      timestamp: new Date(),
      content: "Systems online. I am **नेत्र (Netra)**.\n\nI've indexed your infrastructure. What's the mission? Post a log, ask for a post-mortem, or upload a dashboard capture. Let's make it stable."
    }])
  }

  const startNewChat = () => {
    setActiveThreadId(null)
    showWelcome()
  }

  const deleteThread = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this conversation?')) return
    try {
      await api.delete(`/api/ai/threads/${id}`)
      setThreads(prev => prev.filter(t => t.id !== id))
      if (activeThreadId === id) {
        setActiveThreadId(null)
      }
    } catch (err) {
      console.error("Failed to delete thread", err)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      // base64 contains the data:image/... prefix
      setSelectedImage(base64)
      setImageMime(file.type)
    }
    reader.readAsDataURL(file)
  }

  async function askQuestion(q?: string) {
    const text = q || question
    if (!text.trim() && !selectedImage) return
    if (loading) return

    // Extract the raw base64 data without the prefix for the backend
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

      // If it was a new thread, update sidebar
      if (!activeThreadId) {
        setActiveThreadId(res.data.thread_id)
        // Refresh threads list
        const threadsRes = await api.get(`/api/ai/threads?server_id=${selectedServer || 0}`)
        setThreads(threadsRes.data)
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'e', role: 'assistant',
        content: `**Error:** ${err.response?.data?.error || 'Failed to reach नेत्र service. Please check your Gemini API key configuration.'}`,
        timestamp: new Date()
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      askQuestion()
    }
  }

  const handleClearHistory = async () => {
    if (!confirm('Are you sure you want to clear the conversation history? This cannot be undone.')) return
    
    try {
      await api.delete(`/api/ai/history?server_id=${selectedServer || 0}`)
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        timestamp: new Date(),
        content: "History purged. I am **नेत्र (Netra)**. Ready for the next objective."
      }])
    } catch (err) {
      console.error("Failed to clear AI history", err)
    }
  }



  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-app)' }}>
      
      {/* Threads Sidebar */}
      <div style={{
        width: isSidebarCollapsed ? 64 : 280, 
        borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg-app)', display: 'flex', flexDirection: 'column',
        flexShrink: 0, transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden'
      }}>
        <div style={{ 
          padding: '24px 20px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 20,
          alignItems: isSidebarCollapsed ? 'center' : 'stretch'
        }}>
          {/* Sidebar Toggle & New Chat Row */}
          <div style={{ 
            display: 'flex', 
            justifyContent: isSidebarCollapsed ? 'center' : 'space-between', 
            alignItems: 'center',
            height: 44
          }}>
             {!isSidebarCollapsed && (
               <button
                 onClick={startNewChat}
                 style={{
                   flex: 1, height: 44, borderRadius: 12,
                   background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
                   color: 'var(--text-primary)', fontSize: 13, fontWeight: 700,
                   cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                   transition: 'all 0.2s', boxShadow: 'var(--shadow-sm)',
                   padding: '0 12px'
                 }}
                 onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand-primary)'}
                 onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-bright)'}
               >
                 <div style={{
                   width: 24, height: 24, borderRadius: 6, background: 'var(--brand-primary)',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
                 }}>
                   <X size={14} style={{ transform: 'rotate(45deg)' }} />
                 </div>
                 <span style={{ transition: 'opacity 0.2s', opacity: isSidebarCollapsed ? 0 : 1 }}>
                   New Chat
                 </span>
               </button>
             )}

             {isSidebarCollapsed && (
               <button
                 onClick={startNewChat}
                 title="New Conversation"
                 style={{
                   width: 44, height: 44, borderRadius: 12,
                   background: 'var(--brand-primary)', border: 'none',
                   color: '#fff', cursor: 'pointer', display: 'flex', 
                   alignItems: 'center', justifyContent: 'center',
                   transition: 'all 0.2s', boxShadow: '0 4px 12px var(--brand-glow)'
                 }}
               >
                 <X size={18} style={{ transform: 'rotate(45deg)' }} />
               </button>
             )}

             {!isSidebarCollapsed && (
               <button
                 onClick={() => setIsSidebarCollapsed(true)}
                 title="Collapse Sidebar"
                 style={{
                   background: 'none', border: 'none', padding: 8, cursor: 'pointer',
                   color: 'var(--text-muted)', marginLeft: 8
                 }}
               >
                 <ChevronLeft size={16} />
               </button>
             )}
          </div>
          
          {isSidebarCollapsed && (
            <button
               onClick={() => setIsSidebarCollapsed(false)}
               title="Expand Sidebar"
               style={{
                 background: 'var(--bg-card)', border: '1px solid var(--border)', 
                 borderRadius: 8, padding: 4, cursor: 'pointer', color: 'var(--text-muted)'
               }}
            >
               <ChevronRight size={14} />
            </button>
          )}
        </div>

        <div style={{ 
          flex: 1, overflowY: 'auto', padding: isSidebarCollapsed ? '0 8px' : '0 12px 20px',
          display: 'flex', flexDirection: 'column', gap: 4
        }}>
          {threads.map(t => (
            <div
              key={t.id}
              onClick={() => setActiveThreadId(t.id)}
              title={isSidebarCollapsed ? t.title : undefined}
              style={{
                padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                display: 'flex', alignItems: 'center',
                background: activeThreadId === t.id ? 'var(--bg-card)' : 'transparent',
                border: '1px solid',
                borderColor: activeThreadId === t.id ? 'var(--border-bright)' : 'transparent',
                transition: 'all 0.2s',
                height: 42,
                justifyContent: isSidebarCollapsed ? 'center' : 'space-between'
              }}
              onMouseEnter={e => {
                if (activeThreadId !== t.id) e.currentTarget.style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={e => {
                if (activeThreadId !== t.id) e.currentTarget.style.background = 'transparent'
              }}
            >
              {!isSidebarCollapsed && (
                <div style={{ 
                  fontSize: 13, color: activeThreadId === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: activeThreadId === t.id ? 700 : 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1
                }}>
                  {t.title}
                </div>
              )}
              
              {isSidebarCollapsed && (
                <div style={{ 
                   width: 8, height: 8, borderRadius: '50%',
                   background: activeThreadId === t.id ? 'var(--brand-primary)' : 'var(--border-bright)'
                }} />
              )}

              {!isSidebarCollapsed && (
                <button
                  onClick={(e) => deleteThread(t.id, e)}
                  style={{
                    background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                    color: 'var(--text-muted)', visibility: activeThreadId === t.id ? 'visible' : 'hidden'
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>

        {/* Header */}
        <div style={{
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
              <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                नेत्र
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                  Strategic Infrastructure Intelligence
                </span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                  Active Analysis
                </span>
              </div>
            </div>
          </div>

          {/* Server Switcher */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>AI Protocol</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                 <select
                   className="input-minimal"
                   value={provider}
                   onChange={e => setProvider(e.target.value as any)}
                   style={{
                     background: 'transparent', border: 'none', color: 'var(--text-primary)',
                     fontSize: 14, fontWeight: 700, cursor: 'pointer', outline: 'none',
                     padding: 0, appearance: 'none'
                   }}
                 >
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
                   <option value="">Infrastructure Wide</option>
                   {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                 </select>
                 <ChevronDown size={14} color="var(--text-muted)" />
              </div>
            </div>
          </div>
        </div>

        {/* Conversation Track */}
        <div style={{
          flex: 1, overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '40px 60px 160px', 
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 48 }}>
            
            {/* Landing State Suggestions */}
            {messages.length <= 1 && (
              <div className="fade-in" style={{ padding: '20px 0 60px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <h2 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Tactical Protocols
                  </h2>
                  <button
                    onClick={handleClearHistory}
                    title="Clear All History"
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-muted)', 
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, fontWeight: 700
                    }}
                  >
                    <Trash2 size={14} />
                    Purge History
                  </button>
                </div>
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

            {messages.map((msg) => (
              <div
                key={msg.id}
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
                      <div style={{ fontWeight: 600 }}>{msg.content}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: 24, alignSelf: 'flex-start' }} className="fade-up">
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
                  overflow: 'hidden', padding: 6, boxShadow: '0 4px 12px var(--brand-glow)',
                }}>
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

        {/* Input area */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '24px 60px 48px',
          background: 'linear-gradient(to top, var(--bg-app) 40%, transparent)',
          pointerEvents: 'none'
        }}>
          <div style={{ maxWidth: 900, margin: '0 auto', pointerEvents: 'auto' }}>
            
            {/* Image Preview Overlay */}
            {selectedImage && (
              <div className="fade-in" style={{
                padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
                borderRadius: '20px 20px 0 0', display: 'inline-flex', alignItems: 'center', gap: 12,
                marginBottom: -1, borderBottom: 'none', position: 'relative', marginLeft: 24,
                boxShadow: '0 -10px 30px rgba(0,0,0,0.1)'
              }}>
                <img src={selectedImage} alt="Preview" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }} />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Image Ready</div>
                <button 
                  onClick={() => { setSelectedImage(null); setImageMime(null) }}
                  style={{ background: 'var(--bg-elevated)', border: 'none', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-bright)',
                borderRadius: selectedImage ? '0 24px 24px 24px' : 24, 
                padding: '10px 10px 10px 24px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
                display: 'flex', gap: 10, alignItems: 'center',
            }}>
              <input 
                type="file" 
                ref={fileInputRef} 
                hidden 
                accept="image/*" 
                onChange={handleImageSelect} 
              />
              <button
                 onClick={() => fileInputRef.current?.click()}
                 style={{
                   width: 44, height: 44, borderRadius: 14, background: 'var(--bg-elevated)',
                   border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                   cursor: 'pointer', color: 'var(--text-muted)', transition: 'all 0.2s'
                 }}
                 onMouseEnter={e => e.currentTarget.style.color = 'var(--brand-primary)'}
                 onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <ImageIcon size={20} />
              </button>
              <textarea
                ref={inputRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Initialize protocol analysis..."
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
                disabled={(!question.trim() && !selectedImage) || loading}
                style={{
                  width: 48, height: 48, borderRadius: 16, flexShrink: 0,
                  background: (question.trim() || selectedImage) && !loading ? 'var(--brand-primary)' : 'var(--bg-elevated)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s', cursor: 'pointer', border: 'none'
                }}
              >
                <Send size={20} color={question.trim() ? '#fff' : 'var(--text-muted)'} />
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
