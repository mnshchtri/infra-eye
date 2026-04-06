import { useState, useEffect } from 'react'
import { 
  Code2, KeySquare, Clock, ArrowRightLeft, 
  FileJson, Copy, Check, AlertCircle, Trash2
} from 'lucide-react'

export function DevTools() {
  const [activeTab, setActiveTab] = useState<'json' | 'base64' | 'epoch' | 'jwt'>('json')

  return (
    <div className="page" style={{ minHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: 24, flexShrink: 0 }}>
        <div>
          <h1 className="page-title">Developer Tools</h1>
          <p className="page-subtitle hidden-mobile">Client-side utilities for DevOps, systems configuration, and debugging.</p>
        </div>
      </div>

      <div className="dev-tools-layout" style={{ flex: 1, minHeight: 0 }}>
        {/* Navigation - Sidebar on Desktop, Tabs on Mobile */}
        <div className="dev-tools-nav card" style={{ 
          padding: '8px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 4, 
          height: '100%',
          overflowX: 'auto',
          maxWidth: '100%'
        }}>
          <div className="hidden-mobile" style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', padding: '8px 12px 12px', letterSpacing: '0.05em' }}>UTILITIES</div>
          <div className="dev-tools-nav-inner" style={{ display: 'flex', flexDirection: 'inherit', gap: 4 }}>
            <TabButton active={activeTab === 'json'} icon={FileJson} label="JSON Formatter" onClick={() => setActiveTab('json')} />
            <TabButton active={activeTab === 'base64'} icon={ArrowRightLeft} label="Base64 Encoder" onClick={() => setActiveTab('base64')} />
            <TabButton active={activeTab === 'epoch'} icon={Clock} label="Epoch Converter" onClick={() => setActiveTab('epoch')} />
            <TabButton active={activeTab === 'jwt'} icon={KeySquare} label="JWT Decoder" onClick={() => setActiveTab('jwt')} />
          </div>
        </div>

        {/* Main Content Area */}
        <div className="card dev-tools-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 400, overflow: 'hidden' }}>
          {activeTab === 'json' && <JsonFormatterTool />}
          {activeTab === 'base64' && <Base64Tool />}
          {activeTab === 'epoch' && <EpochConverterTool />}
          {activeTab === 'jwt' && <JwtDecoderTool />}
        </div>
      </div>

      <style>{`
        .dev-tools-layout {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 24px;
        }
        .dev-tools-nav-inner {
          flex: 1;
        }
        @media (max-width: 768px) {
          .dev-tools-layout {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .dev-tools-nav {
            flex-direction: row !important;
            height: auto !important;
            padding: 6px !important;
            background: var(--bg-elevated) !important;
            border-radius: 0 !important;
          }
          .dev-tools-nav-inner {
            flex-direction: row !important;
            width: 100%;
          }
          .dev-tools-nav-inner button {
            flex: 1;
            justify-content: center;
            padding: 10px 12px !important;
            white-space: nowrap;
          }
          .dev-tools-nav-inner button span {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}

function TabButton({ active, icon: Icon, label, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 0,
        background: active ? 'var(--bg-elevated)' : 'transparent',
        color: active ? 'var(--brand-primary)' : 'var(--text-secondary)',
        border: '1px solid transparent',
        ...(active ? { borderLeft: '3px solid var(--brand-primary)' } : {}),
        fontWeight: 900, fontSize: 10, cursor: 'pointer', transition: 'all 0.2s ease',
        textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em',
        fontFamily: 'var(--font-mono)'
      }}
      className={active ? '' : 'hover-lift'}
    >
      <Icon size={18} color={active ? 'var(--brand-primary)' : 'var(--text-muted)'} />
      {label}
    </button>
  )
}

// ── JSON FORMATTER ──

function JsonFormatterTool() {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  function format() {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      setInput(JSON.stringify(parsed, null, 2))
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }

  function minify() {
    if (!input.trim()) return
    try {
      const parsed = JSON.parse(input)
      setInput(JSON.stringify(parsed))
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }

  function copy() {
    navigator.clipboard.writeText(input)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-app)', flexWrap: 'wrap', gap: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>JSON Formatter</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setInput('')} title="Clear"><Trash2 size={14} /></button>
          <button className="btn btn-secondary btn-sm" onClick={minify}>Minify</button>
          <button className="btn btn-primary btn-sm" onClick={format}>Format</button>
          <button className="btn btn-secondary btn-sm" onClick={copy}>
            {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />} 
            <span className="hidden-mobile" style={{ marginLeft: 6 }}>Copy</span>
          </button>
        </div>
      </div>
      {error && (
        <div style={{ padding: '12px 24px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      <textarea
        value={input}
        onChange={e => { setInput(e.target.value); setError('') }}
        placeholder='Paste JSON here... e.g. {"name": "infra-eye"}'
        style={{
          flex: 1, padding: 24, border: 'none', background: 'transparent', resize: 'none', outline: 'none',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)',
          lineHeight: 1.5, fontWeight: 500
        }}
        spellCheck={false}
      />
    </div>
  )
}

// ── BASE64 TOOL ──

function Base64Tool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  function encode() {
    try {
      setOutput(btoa(input))
      setError('')
    } catch (e) {
      setError('Cannot encode input to Base64 (contains invalid characters).')
    }
  }

  function decode() {
    try {
      setOutput(atob(input))
      setError('')
    } catch (e) {
      setError('Invalid Base64 string.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 24, overflowY: 'auto' }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Base64 Encode / Decode</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Paste your string or Base64 payload below.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>INPUT</label>
        <textarea
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter text..."
          style={{ height: 160, fontFamily: '"JetBrains Mono", monospace', padding: 16, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={encode} style={{ flex: 1, height: 42, fontSize: 13 }}>Encode</button>
        <button className="btn btn-secondary" onClick={decode} style={{ flex: 1, height: 42, fontSize: 13 }}>Decode</button>
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><AlertCircle size={14}/> {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>OUTPUT</label>
          <button className="btn" style={{ fontSize: 11, height: 24, padding: '0 8px' }} onClick={() => navigator.clipboard.writeText(output)}>Copy Output</button>
        </div>
        <textarea
          className="input"
          value={output}
          readOnly
          style={{ flex: 1, minHeight: 160, background: 'var(--bg-app)', fontFamily: '"JetBrains Mono", monospace', padding: 16, resize: 'none' }}
        />
      </div>
    </div>
  )
}

// ── EPOCH CONVERTER ──

function EpochConverterTool() {
  const [timestamp, setTimestamp] = useState(Date.now().toString())
  
  const tsNum = parseInt(timestamp) || 0
  const isSeconds = timestamp.length <= 10
  const dateObj = new Date(isSeconds ? tsNum * 1000 : tsNum)
  
  const isValid = !isNaN(dateObj.getTime())

  // Helper method inside component to easily manage dependencies like Date.now() difference
  const getRelativeTime = (d1: Date) => {
    const elapsed = d1.getTime() - Date.now()
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    const abs = Math.abs(elapsed)
    if (abs < 1000 * 60) return rtf.format(Math.round(elapsed / 1000), 'second')
    if (abs < 1000 * 60 * 60) return rtf.format(Math.round(elapsed / (1000 * 60)), 'minute')
    if (abs < 1000 * 60 * 60 * 24) return rtf.format(Math.round(elapsed / (1000 * 60 * 60)), 'hour')
    if (abs < 1000 * 60 * 60 * 24 * 30) return rtf.format(Math.round(elapsed / (1000 * 60 * 60 * 24)), 'day')
    if (abs < 1000 * 60 * 60 * 24 * 365) return rtf.format(Math.round(elapsed / (1000 * 60 * 60 * 24 * 30)), 'month')
    return rtf.format(Math.round(elapsed / (1000 * 60 * 60 * 24 * 365)), 'year')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 32 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Unix Epoch Converter</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Convert between Unix timestamps (seconds/milliseconds) and human-readable dates.</p>
      </div>

      <div className="card" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 12 }}>ENTER TIMESTAMP</label>
        <div style={{ display: 'flex', gap: 12 }}>
          <input 
            className="input" 
            value={timestamp}
            onChange={e => setTimestamp(e.target.value)}
            style={{ fontSize: 20, fontFamily: '"JetBrains Mono", monospace', height: 48, flex: 1 }}
          />
          <button className="btn btn-secondary" style={{ height: 48 }} onClick={() => setTimestamp(Date.now().toString())}>Now (ms)</button>
          <button className="btn btn-secondary" style={{ height: 48 }} onClick={() => setTimestamp(Math.floor(Date.now()/1000).toString())}>Now (s)</button>
        </div>
      </div>

      {isValid ? (
         <div className="grid-2-col" style={{ gap: 16 }}>
           <ResultBox label="Local Time" value={dateObj.toLocaleString()} />
           <ResultBox label="UTC Time" value={dateObj.toUTCString()} />
           <ResultBox label="ISO 8601" value={dateObj.toISOString()} />
           <ResultBox label="Relative" value={getRelativeTime(dateObj)} />
         </div>
      ) : (
         <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger)' }}>Invalid Timestamp</div>
      )}
    </div>
  )
}

function ResultBox({ label, value }: { label: string, value: string }) {
  return (
    <div style={{ padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 0, background: 'var(--bg-elevated)20' }}>
      <div style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  )
}

// ── JWT DECODER ──

function JwtDecoderTool() {
  const [jwt, setJwt] = useState('')
  const [header, setHeader] = useState('')
  const [payload, setPayload] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!jwt.trim()) {
      setHeader(''); setPayload(''); setError(''); return;
    }
    
    try {
      const parts = jwt.split('.')
      if (parts.length !== 3) throw new Error('JWT must have 3 parts (header.payload.signature)')
      
      const decodeB64Url = (str: string) => {
        let b64 = str.replace(/-/g, '+').replace(/_/g, '/')
        while (b64.length % 4) b64 += '='
        return decodeURIComponent(atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''))
      }

      setHeader(JSON.stringify(JSON.parse(decodeB64Url(parts[0])), null, 2))
      setPayload(JSON.stringify(JSON.parse(decodeB64Url(parts[1])), null, 2))
      setError('')
    } catch (e: any) {
      setError(e.message || 'Invalid JWT format')
      setHeader('')
      setPayload('')
    }
  }, [jwt])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 24, overflowY: 'auto' }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>JWT Decoder</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Decode base64url-encoded JSON Web Tokens instantly.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>TOKEN STRING</label>
        <textarea
          className="input"
          value={jwt}
          onChange={e => setJwt(e.target.value)}
          placeholder="eyJhbGciOiJIUz... (paste your token here)"
          style={{ height: 100, fontFamily: '"JetBrains Mono", monospace', padding: 16, resize: 'vertical', wordBreak: 'break-all' }}
        />
      </div>

      {error ? (
        <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 10 }}>
          <AlertCircle size={16} style={{ marginBottom: 8 }} />
          <div>{error}</div>
        </div>
      ) : (jwt && (
        <div className="grid-2-col" style={{ gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#ec4899' }}>HEADER</label>
            <pre style={{ margin: 0, padding: 16, background: 'var(--bg-app)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, color: '#ec4899', whiteSpace: 'pre-wrap' }}>
              {header}
            </pre>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
             <label style={{ fontSize: 11, fontWeight: 700, color: '#a855f7' }}>PAYLOAD</label>
            <pre style={{ margin: 0, padding: 16, background: 'var(--bg-app)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, color: '#a855f7', overflowX: 'auto' }}>
              {payload}
            </pre>
          </div>
        </div>
      ))}
    </div>
  )
}
