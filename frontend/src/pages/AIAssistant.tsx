import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { Send, Image as ImageIcon, X, Trash2, Zap, Activity, Shield, Boxes, Gauge, Menu } from 'lucide-react'
import { Box, ButtonBase, Chip, IconButton, InputBase, MenuItem, Paper, TextField, Tooltip, Typography, Button as MuiButton, alpha } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { Modal, Button } from '../components/ui'
import { api } from '../api/client'
import chatbotLogo from '../assets/chatbot-logo.png'

// Sub-components
import { MessageItem } from '../components/ai/MessageItem'
import { ThreadSidebar } from '../components/ai/ThreadSidebar'
import { apiError, apiErrorBody, errMessage } from '../utils/errors'

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
  color: 'primary' | 'info' | 'error' | 'success'
  items: string[]
}

const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    label: 'Diagnose',
    icon: Activity,
    color: 'primary',
    items: [
      'Run a post-mortem on the recent logs — what broke, when, and why?',
      'CPU and load are climbing. Walk me through the top suspects with exact commands.',
      'Disk usage is growing fast — help me find what is eating space safely.',
    ],
  },
  {
    label: 'Kubernetes',
    icon: Boxes,
    color: 'info',
    items: [
      'Find pods that are CrashLooping or OOMKilled and explain the root cause.',
      'Audit resource requests vs limits — which workloads are at eviction or throttling risk?',
      'A service is unreachable. Debug it end-to-end: endpoints, DNS, NetworkPolicy, CNI.',
    ],
  },
  {
    label: 'Security',
    icon: Shield,
    color: 'error',
    items: [
      'Audit RBAC: which service accounts have cluster-admin or wildcard permissions?',
      'Scan recent logs for SSH brute-force attempts or auth anomalies.',
      'Find privileged containers, hostPath mounts, and workloads running as root.',
    ],
  },
  {
    label: 'Reliability',
    icon: Gauge,
    color: 'success',
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
    <ButtonBase
      onClick={() => onClick(text)}
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, textAlign: 'left',
        p: '12px 14px', borderRadius: 1, bgcolor: 'background.paper', border: 1, borderColor: 'divider',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        '&:hover': { borderColor: `${group.color}.main`, boxShadow: 2 },
      }}
    >
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: `${group.color}.main`, fontSize: 12, fontWeight: 600 }}>
        <Icon size={13} /> {group.label}
      </Box>
      <Typography component="span" variant="body1" sx={{ lineHeight: 1.5 }}>{text}</Typography>
    </ButtonBase>
  )
})
SuggestionCard.displayName = 'SuggestionCard'

const blink = keyframes`0%, 100% { opacity: 0.3; } 50% { opacity: 1; }`
const pulseScale = keyframes`0%, 100% { transform: scale(1); } 50% { transform: scale(0.9); }`

type AIProvider = 'openrouter' | 'deepseek' | 'google' | 'mistral' | 'claude' | 'local'

export function AIAssistant() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [selectedServer, setSelectedServer] = useState<number | ''>('')
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState<AIProvider>('mistral')
  const [mcpAvailable, setMcpAvailable] = useState(false)
  const [deleteThreadId, setDeleteThreadId] = useState<number | null>(null)
  const [clearOpen, setClearOpen] = useState(false)

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
        const history = res.data.map((m: { id: number; role: string; content: string; created_at: string }) => ({
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

  const requestDeleteThread = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteThreadId(id)
  }, [])

  const deleteThread = useCallback(async (id: number) => {
    setDeleteThreadId(null)
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
    } catch (err: unknown) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'e', role: 'assistant',
        content: `**Error:** ${apiError(err) || 'Failed to reach the Netra service.'}`,
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
    } catch (err: unknown) {
      const errData = apiErrorBody(err)
      const errMsg: Message = {
        id: Date.now().toString() + '_mcperr',
        role: 'assistant',
        content: [
          `**⚠️ MCP Tool Error: \`${tool}\`** ${errData?.error || errMessage(err)}`,
          errData?.details ? `\n> ${errData.details}` : '',
        ].filter(Boolean).join('\n'),
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errMsg])
    }
  }, [selectedServer, askQuestion])

  const handleClearHistory = useCallback(async () => {
    setClearOpen(false)
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

  return (
    <Box sx={{ display: 'flex', height: '100%', bgcolor: 'background.default', position: 'relative', minHeight: 0 }}>

      {!isSidebarCollapsed && (
        <Box
          onClick={() => setIsSidebarCollapsed(true)}
          sx={(t) => ({ display: { xs: 'block', md: 'none' }, position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.4)', zIndex: t.zIndex.drawer })}
        />
      )}

      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={id => { setActiveThreadId(id); if (window.innerWidth <= 900) setIsSidebarCollapsed(true) }}
        onNew={() => { startNewChat(); if (window.innerWidth <= 900) setIsSidebarCollapsed(true) }}
        onDelete={requestDeleteThread}
        isCollapsed={isSidebarCollapsed}
        onToggle={setIsSidebarCollapsed}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minWidth: 0 }}>
        {/* ── Header ── */}
        <Box component="header" sx={{
          width: '100%', px: { xs: 1.5, md: 2.5 }, py: 1.25,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, borderBottom: 1, borderColor: 'divider',
          bgcolor: 'background.paper', flexWrap: 'wrap', gap: 1.5,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Tooltip title="Conversations">
              <IconButton aria-label="Open conversations" onClick={() => setIsSidebarCollapsed(false)} sx={{ display: { xs: 'inline-flex', md: 'none' }, border: 1, borderColor: 'divider' }}>
                <Menu size={16} />
              </IconButton>
            </Tooltip>
            <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', p: 0.5, border: 1, borderColor: 'divider' }}>
              <Box component="img" src={chatbotLogo} alt="Netra" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </Box>
            <Box>
              <Typography variant="h5" component="h1" sx={{ lineHeight: 1.2 }}>
                नेत्र <Typography component="span" color="text.secondary" sx={{ fontSize: 'inherit', fontWeight: 500 }}>Netra</Typography>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                DevSecOps copilot · <Box component="span" sx={{ color: 'text.primary' }}>{scopeLabel}</Box>
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <TextField
              select
              label="Model"
              value={provider}
              onChange={e => setProvider(e.target.value as AIProvider)}
              title="AI model provider"
              sx={{ minWidth: 130 }}
            >
              <MenuItem value="mistral">Mistral</MenuItem>
              <MenuItem value="claude">Claude</MenuItem>
              <MenuItem value="google">Gemini</MenuItem>
              <MenuItem value="deepseek">DeepSeek</MenuItem>
              <MenuItem value="openrouter">OpenRouter</MenuItem>
              <MenuItem value="local">Local LLM</MenuItem>
            </TextField>

            <TextField
              select
              label="Scope"
              value={selectedServer === '' ? '' : String(selectedServer)}
              onChange={e => setSelectedServer(Number(e.target.value) || '')}
              title="Context scope — which system Netra analyzes"
              sx={{ minWidth: 170, maxWidth: 220 }}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            >
              <MenuItem value="">All infrastructure</MenuItem>
              {servers.map(s => <MenuItem key={s.id} value={String(s.id)}>{s.is_k8s ? '☸ ' : ''}{s.name}</MenuItem>)}
            </TextField>

            <Tooltip title={mcpAvailable ? 'Live cluster access is available — Netra can run Kubernetes queries from chat' : 'MCP sidecar unreachable — cluster tool execution disabled'}>
              <Chip
                size="small"
                variant="outlined"
                color={mcpAvailable ? 'primary' : 'default'}
                icon={<Zap size={12} />}
                label={mcpAvailable ? 'MCP live' : 'MCP offline'}
                sx={{ display: { xs: 'none', md: 'inline-flex' } }}
              />
            </Tooltip>
          </Box>
        </Box>

        {/* ── Messages ── */}
        <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', px: 2, pt: 3, pb: '150px' }}>
          <Box sx={{ maxWidth: 980, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            {messages.length <= 1 && (
              <Box className="fade-in" sx={{ py: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.75 }}>
                  <Typography variant="subtitle1" component="h2" color="text.secondary">
                    Where do you want to start?
                  </Typography>
                  <MuiButton size="small" color="inherit" onClick={() => setClearOpen(true)} startIcon={<Trash2 size={14} />} sx={{ color: 'text.secondary' }}>
                    Clear history
                  </MuiButton>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 1.5 }}>
                  {SUGGESTION_GROUPS.flatMap(g => g.items.map(text => (
                    <SuggestionCard key={text} group={g} text={text} onClick={askQuestion} />
                  )))}
                </Box>
              </Box>
            )}

            {messages.map((msg) => <MessageItem key={msg.id} msg={msg} onExecuteMcpTool={executeMcpTool} />)}

            {loading && (
              <Box className="fade-up" sx={{ display: 'flex', gap: 1.75, alignSelf: 'flex-start', alignItems: 'center' }}>
                <Box sx={{ width: 32, height: 32, borderRadius: 1, bgcolor: 'background.paper', overflow: 'hidden', p: 0.5, border: 1, borderColor: 'divider', flexShrink: 0 }}>
                  <Box component="img" src={chatbotLogo} alt="Netra" sx={{ width: '100%', height: '100%', objectFit: 'contain', animation: `${pulseScale} 1.8s infinite` }} />
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} role="status">
                  <Typography variant="body1" color="text.secondary">Analyzing</Typography>
                  {[0, 0.2, 0.4].map(d => (
                    <Box key={d} component="span" sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: 'primary.main', animation: `${blink} 1s ${d}s infinite` }} />
                  ))}
                </Box>
              </Box>
            )}
            <div ref={bottomRef} />
          </Box>
        </Box>

        {/* ── Input ── */}
        <Box sx={(t) => ({
          position: 'absolute', bottom: 0, left: 0, right: 0, p: { xs: 1.5, sm: 2.5 }, pointerEvents: 'none',
          background: `linear-gradient(to top, ${t.palette.background.default} 55%, ${alpha(t.palette.background.default, 0)})`,
        })}>
          <Box sx={{ maxWidth: 980, mx: 'auto', pointerEvents: 'auto' }}>
            {selectedImage && (
              <Paper variant="outlined" className="fade-in" sx={{ px: 1.5, py: 1, display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 1, ml: 1 }}>
                <Box component="img" src={selectedImage} alt="Preview" sx={{ width: 36, height: 36, borderRadius: 0.75, objectFit: 'cover', border: 1, borderColor: 'divider' }} />
                <Typography variant="body2" color="text.secondary">Image attached</Typography>
                <Tooltip title="Remove image">
                  <IconButton aria-label="Remove image" onClick={() => { setSelectedImage(null); setImageMime(null) }}><X size={13} /></IconButton>
                </Tooltip>
              </Paper>
            )}

            <Paper variant="outlined" sx={{
              px: 1.5, py: 1, display: 'flex', gap: 1.25, alignItems: 'flex-end', borderRadius: 2,
              transition: 'border-color 0.15s, box-shadow 0.15s',
              '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.2)}` },
            }}>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageSelect} />
              <Tooltip title="Attach a screenshot or dashboard capture">
                <IconButton aria-label="Attach image" onClick={() => fileInputRef.current?.click()} sx={{ display: { xs: 'none', sm: 'inline-flex' }, border: 1, borderColor: 'divider', borderRadius: 1, p: 0.75 }}>
                  <ImageIcon size={16} />
                </IconButton>
              </Tooltip>
              <InputBase
                inputRef={inputRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Netra — describe the incident, paste a log, or attach a screenshot…"
                disabled={loading}
                multiline
                maxRows={6}
                fullWidth
                inputProps={{ 'aria-label': 'Message Netra' }}
                sx={{ flex: 1, fontSize: 13, lineHeight: 1.6, py: 0.5 }}
              />
              <Tooltip title="Send (Enter)">
                <span>
                  <IconButton
                    aria-label="Send message"
                    onClick={() => askQuestion()}
                    disabled={(!question.trim() && !selectedImage) || loading}
                    sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 1, p: 1, '&:hover': { bgcolor: 'primary.dark' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground' } }}
                  >
                    <Send size={16} />
                  </IconButton>
                </span>
              </Tooltip>
            </Paper>
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, justifyContent: 'center', gap: 1.75, mt: 1, color: 'text.secondary' }}>
              <Typography variant="caption">Enter to send · Shift+Enter for a new line</Typography>
              {mcpAvailable && <Typography variant="caption">· Cluster queries run only after you approve them</Typography>}
            </Box>
          </Box>
        </Box>
      </Box>

      <Modal
        isOpen={deleteThreadId !== null}
        onClose={() => setDeleteThreadId(null)}
        title="Delete conversation"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteThreadId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteThreadId !== null && deleteThread(deleteThreadId)}>Delete</Button>
          </>
        }
      >
        <Typography variant="body1" color="text.secondary">
          Delete <b>{threads.find(t => t.id === deleteThreadId)?.title ?? 'this conversation'}</b>? This cannot be undone.
        </Typography>
      </Modal>

      <Modal
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear history"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClearOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleClearHistory}>Clear history</Button>
          </>
        }
      >
        <Typography variant="body1" color="text.secondary">Clear conversation history for this scope?</Typography>
      </Modal>

    </Box>
  )
}
