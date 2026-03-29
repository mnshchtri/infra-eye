import { useState, useRef, useEffect } from 'react'
import { Server, Bot, Send, Loader2, Sparkles } from 'lucide-react'
import { api } from '../api/client'
import Markdown from 'react-markdown'

interface ServerData { id: number; name: string }

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function AIAssistant() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [selectedServer, setSelectedServer] = useState<number | ''>('')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1', role: 'assistant', timestamp: new Date(),
      content: 'Hello! I am your InfraEye DevOps Assistant. Select a server context and ask me to diagnose issues, analyze logs, or suggest commands.',
    }
  ])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/api/servers').then(res => setServers(res.data))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function askQuestion(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!question.trim() || loading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: question, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    const currentQ = question
    setQuestion('')
    setLoading(true)

    try {
      const serverId = selectedServer ? Number(selectedServer) : 0
      const res = await api.post('/api/ai/chat', { server_id: serverId, question: currentQ })
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'r', role: 'assistant',
        content: res.data.answer, timestamp: new Date()
      }])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + 'e', role: 'assistant',
        content: `❌ Error: ${err.response?.data?.error || 'Failed to reach AI'}`, timestamp: new Date()
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bot size={24} color="var(--accent)" /> AI Assistant
          </h1>
          <p className="page-subtitle">GPT-4o powered diagnosis with live server context</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Context:</span>
          <select className="input" style={{ width: 200, padding: '6px 12px' }}
            value={selectedServer} onChange={e => setSelectedServer(Number(e.target.value))}>
            <option value="">General (No specific server)</option>
            {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card ai-chat-container">
        <div className="ai-chat-messages">
          {messages.map(msg => (
            <div key={msg.id} className={`ai-message-row ${msg.role}`}>
              <div className="ai-message-avatar">
                {msg.role === 'assistant' ? <Sparkles size={16} /> : 'U'}
              </div>
              <div className="ai-message-bubble">
                {msg.role === 'assistant' ? (
                  <Markdown className="markdown-body">{msg.content}</Markdown>
                ) : (
                  msg.content
                )}
                <div className="ai-message-time">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className={`ai-message-row assistant`}>
              <div className="ai-message-avatar"><Loader2 size={16} className="spin-icon" /></div>
              <div className="ai-message-bubble pulse" style={{ opacity: 0.6, fontStyle: 'italic' }}>
                Analyzing server context...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form className="ai-chat-input-row" onSubmit={askQuestion}>
          <input
            className="input"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask about high CPU, log errors, or kubectl commands..."
            disabled={loading}
          />
          <button type="submit" className="btn btn-primary" disabled={!question.trim() || loading}
            style={{ padding: '0 20px' }}>
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
