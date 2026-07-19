import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { Send, ChevronDown, Image as ImageIcon, X, Trash2, Zap, Activity, Shield, Boxes, Gauge, Menu } from 'lucide-react'
import { api } from '../api/client'
import chatbotLogo from '../assets/chatbot-logo.png'

// Sub-components
import { MessageItem } from '../components/ai/MessageItem'
import { ThreadSidebar } from '../components/ai/ThreadSidebar'

interface ServerData { id: number; name: string; is_k8s?: boolean }

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

// ── Suggestion prompts, grouped by DevSecOps discipline ─────────────────────
interface SuggestionGroup {
  label: string
  icon: typeof Activity
  color: string
  items: string[]
}

const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    label: 'Diagnose',
    icon: Activity,
    color: 'var(--brand-primary)',
    items: [
      'Run a post-mortem on the recent logs — what broke, when, and why?',
      'CPU and load are climbing. Walk me through the top suspects with exact commands.',
      'Disk usage is growing fast — help me find what is eating space safely.',
    ],
  },
  {
    label: 'Kubernetes',
    icon: Boxes,
    color: 'var(--info, #3b82f6)',
    items: [
      'Find pods that are CrashLooping or OOMKilled and explain the root cause.',
      'Audit resource requests vs limits — which workloads are at eviction or throttling risk?',
      'A service is unreachable. Debug it end-to-end: endpoints, DNS, NetworkPolicy, CNI.',
    ],
  },
  {
    label: 'Security',
    icon: Shield,
    color: 'var(--danger)',
    items: [
      'Audit RBAC: which service accounts have cluster-admin or wildcard permissions?',
      'Scan recent logs for SSH brute-force attempts or auth anomalies.',
      'Find privileged containers, hostPath mounts, and workloads running as root.',
    ],
  },
  {
    label: 'Reliability',
    icon: Gauge,
    color: 'var(--success)',
    items: [
      'Review my alert rules for coverage gaps and suggest self-healing rules worth adding.',
      'Check the resource catalog — are any dependencies degraded or exposed without the gateway?',
      'Draft a rollback-safe remediation plan for the current failing workload.',
    ],
  },
]

const SuggestionCard = memo(({ group, text, onClick }: { group: SuggestionGroup; text: string; onClick: (s: string) => void }) => {
  const Icon = group.icon
  return (
    <button
      onClick={() => onClick(text)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left',
        padding: '14px 16px', borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.5,
        cursor: 'pointer', transition: 'all 0.15s', fontWeight: 500,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = group.color
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08))'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: group.color }}>
        <Icon size={12} /> {group.label}
      </span>
      <span style={{ color: 'var(--text-primary)' }}>{text}</span>
    </button>
  )
})
SuggestionCard.displayName = 'SuggestionCard'

export function AIAssistant() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [selectedServer, setSelectedServer] = useState<number | ''>('')
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState<'openrouter' | 'deepseek' | 'google' | 'mistral' | 'claude'>('mistral')
  const [mcpAvailable, setMcpAvailable] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)

  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [imageMime, setImageMime] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data)).catch(() => {})
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
      console.error('Failed to fetch AI threads', err)
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
      content: "**नेत्र (Netra)** online — your DevSecOps copilot.\n\nI have live context on your fleet: metrics, logs, cluster events, alert rules, self-healing history, and the resource catalog. Pick a target system above, then describe the incident, paste a log, or upload a screenshot — I'll debug it with evidence and propose rollback-safe fixes.",
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
          timestamp: new Date(m.created_at),
        }))
        setMessages(history)
      } catch (err) {
        console.error('Failed to fetch AI history', err)
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
      console.error('Failed to delete thread', err)
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
      image: selectedImage || undefined,
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
        provider: provider,
      })

      const newAssistantMsg: Message = {
        id: Date.now().toString() + 'r',
        role: 'assistant',
        content: res.data.answer,
        timestamp: new Date(),
      }

      setMessages(prev => [...prev, newAssistantMsg])

      if (!activeThreadId) {
        setActiveThreadId(res.data.thread_id)
        api.get(`/api/ai/threads?server_id=${selectedServer || 0}`).then(res => setThreads(res.data))
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'e', role: 'assistant',
        content: `**Error:** ${err.response?.data?.error || 'Failed to reach the Netra service.'}`,
        timestamp: new Date(),
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

  // MCP Tool execution — called by MessageItem when user clicks "Execute"
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
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, resultMsg])

      // Feed output back to AI for analysis
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
          errData?.details ? `\n> ${errData.details}` : '',
        ].filter(Boolean).join('\n'),
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errMsg])
    }
  }, [selectedServer, askQuestion])

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm('Clear conversation history for this scope?')) return
    try {
      await api.delete(`/api/ai/history?server_id=${selectedServer || 0}`)
      showWelcome()
    } catch (err) {
      console.error('Failed to clear AI history', err)
    }
  }, [selectedServer, showWelcome])

  const selectedServerData = servers.find(s => s.id === selectedServer)
  const scopeLabel = selectedServerData
    ? selectedServerData.name
    : 'Entire infrastructure'

  const selectStyle: React.CSSProperties = {
    height: 34, padding: '0 26px 0 10px', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none',
  }

  return (
    <div className={`ai-assistant-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={{ display: 'flex', height: '100%', background: 'var(--bg-app)', position: 'relative' }}>

      <div
        className={`ai-sidebar-overlay ${!isSidebarCollapsed ? 'mobile-open' : ''}`}
        onClick={() => setIsSidebarCollapsed(true)}
      />

      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={id => { setActiveThreadId(id); if (window.innerWidth <= 768) setIsSidebarCollapsed(true) }}
        onNew={() => { startNewChat(); if (window.innerWidth <= 768) setIsSidebarCollapsed(true) }}
        onDelete={deleteThread}
        isCollapsed={isSidebarCollapsed}
        onToggle={setIsSidebarCollapsed}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>
        {/* ── Header ── */}
        <header className="ai-chat-header" style={{
          width: '100%', padding: '12px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)', flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="show-mobile-only btn-icon"
              onClick={() => setIsSidebarCollapsed(false)}
              title="Conversations"
              style={{ padding: 8, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
            >
              <Menu size={16} />
            </button>
            <div style={{
              width: 38, height: 38, borderRadius: 'var(--radius-md)',
              background: 'var(--bg-app)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', padding: 4, border: '1px solid var(--border)',
            }}>
              <img src={chatbotLogo} alt="Netra" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                नेत्र <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Netra</span>
              </h1>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                DevSecOps copilot · <span style={{ color: 'var(--text-secondary)' }}>{scopeLabel}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <select value={provider} onChange={e => setProvider(e.target.value as any)} title="AI model provider" style={selectStyle}>
                <option value="mistral">Mistral</option>
                <option value="claude">Claude</option>
                <option value="google">Gemini</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openrouter">OpenRouter</option>
              </select>
              <ChevronDown size={12} color="var(--text-muted)" style={{ position: 'absolute', right: 8, pointerEvents: 'none' }} />
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <select value={selectedServer} onChange={e => setSelectedServer(Number(e.target.value) || '')} title="Context scope — which system Netra analyzes" style={{ ...selectStyle, maxWidth: 180 }}>
                <option value="">All infrastructure</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.is_k8s ? '☸ ' : ''}{s.name}</option>)}
              </select>
              <ChevronDown size={12} color="var(--text-muted)" style={{ position: 'absolute', right: 8, pointerEvents: 'none' }} />
            </div>

            <div className="hidden-mobile" title={mcpAvailable ? 'Live cluster access is available — Netra can run Kubernetes queries from chat' : 'MCP sidecar unreachable — cluster tool execution disabled'} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              background: mcpAvailable ? 'var(--brand-glow)' : 'var(--bg-elevated)',
              border: `1px solid ${mcpAvailable ? 'var(--brand-primary)' : 'var(--border)'}`,
            }}>
              <Zap size={11} color={mcpAvailable ? 'var(--brand-primary)' : 'var(--text-muted)'} />
              <span style={{ fontSize: 10, fontWeight: 800, color: mcpAvailable ? 'var(--brand-primary)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {mcpAvailable ? 'MCP Live' : 'MCP Offline'}
              </span>
            </div>
          </div>
        </header>

        {/* ── Messages ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '24px 16px 150px' }}>
          <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
            {messages.length <= 1 && (
              <div className="fade-in" style={{ padding: '8px 0 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <h2 style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Where do you want to start?
                  </h2>
                  <button onClick={handleClearHistory} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700 }}>
                    <Trash2 size={13} /> Clear history
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                  {SUGGESTION_GROUPS.flatMap(g => g.items.map(text => (
                    <SuggestionCard key={text} group={g} text={text} onClick={askQuestion} />
                  )))}
                </div>
              </div>
            )}

            {messages.map((msg) => <MessageItem key={msg.id} msg={msg} onExecuteMcpTool={executeMcpTool} />)}

            {loading && (
              <div style={{ display: 'flex', gap: 14, alignSelf: 'flex-start', alignItems: 'center' }} className="fade-up">
                <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', overflow: 'hidden', padding: 4, border: '1px solid var(--border)', flexShrink: 0 }}>
                  <img src={chatbotLogo} alt="Netra" style={{ width: '100%', height: '100%', objectFit: 'contain', animation: 'pulseScale 1.8s infinite' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Analyzing</span>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1s infinite' }} />
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1s 0.2s infinite' }} />
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--brand-primary)', animation: 'blink 1s 0.4s infinite' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Input ── */}
        <div className="ai-input-wrapper" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px', background: 'linear-gradient(to top, var(--bg-app) 55%, transparent)', pointerEvents: 'none' }}>
          <div style={{ maxWidth: 980, margin: '0 auto', pointerEvents: 'auto' }}>
            {selectedImage && (
              <div className="fade-in image-preview-stack" style={{ padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-bright)', borderRadius: '12px 12px 0 0', display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: -1, borderBottom: 'none', position: 'relative', marginLeft: 16, boxShadow: '0 -10px 30px rgba(0,0,0,0.1)' }}>
                <img src={selectedImage} alt="Preview" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} />
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Image attached</div>
                <button onClick={() => { setSelectedImage(null); setImageMime(null) }} style={{ background: 'var(--bg-elevated)', border: 'none', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={12} /></button>
              </div>
            )}

            <div className="chat-input-container" style={{
              background: 'var(--bg-input)',
              border: `1px solid ${inputFocused ? 'var(--brand-primary)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-lg)', padding: '12px 14px',
              display: 'flex', gap: 10, alignItems: 'flex-end',
              boxShadow: inputFocused ? '0 0 0 3px var(--brand-glow)' : 'var(--shadow-sm, none)',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageSelect} />
              <button className="hidden-mobile" onClick={() => fileInputRef.current?.click()} title="Attach a screenshot or dashboard capture"
                style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
                <ImageIcon size={16} />
              </button>
              <textarea ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={handleKeyDown}
                onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
                placeholder="Ask Netra — describe the incident, paste a log, or attach a screenshot…"
                disabled={loading} rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13, padding: '8px 0', resize: 'none', lineHeight: 1.6, maxHeight: 150 }}
                onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px' }}
              />
              <button onClick={() => askQuestion()} disabled={(!question.trim() && !selectedImage) || loading} title="Send (Enter)"
                style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', flexShrink: 0, background: (question.trim() || selectedImage) && !loading ? 'var(--brand-primary)' : 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', transition: 'all 0.2s' }}>
                <Send size={16} color={question.trim() || selectedImage ? 'var(--text-inverse)' : 'var(--text-muted)'} />
              </button>
            </div>
            <div className="hidden-mobile" style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 8, fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600 }}>
              <span>Enter to send · Shift+Enter for a new line</span>
              {mcpAvailable && <span>· Cluster queries run only after you approve them</span>}
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
