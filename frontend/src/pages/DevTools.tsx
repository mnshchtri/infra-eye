import { useState, useEffect } from 'react'
import { 
  Code2, KeySquare, Clock, ArrowRightLeft, 
  FileJson, Copy, Check, AlertCircle, Trash2
} from 'lucide-react'

export function DevTools() {
  const [activeTab, setActiveTab] = useState<'json' | 'base64' | 'epoch' | 'jwt'>('json')

  return (
    <div className="page" style={{ height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: 24, flexShrink: 0 }}>
        <div>
          <h1 className="page-title">Developer Tools</h1>
          <p className="page-subtitle">Client-side utilities for DevOps, systems configuration, and debugging.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, flex: 1, minHeight: 0 }}>
        {/* Sidebar Navigation */}
        <div className="card" style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4, height: '100%' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', padding: '0 12px 12px', letterSpacing: '0.05em' }}>UTILITIES</div>
          <TabButton active={activeTab === 'json'} icon={FileJson} label="JSON Formatter" onClick={() => setActiveTab('json')} />
          <TabButton active={activeTab === 'base64'} icon={ArrowRightLeft} label="Base64 Encoder" onClick={() => setActiveTab('base64')} />
          <TabButton active={activeTab === 'epoch'} icon={Clock} label="Epoch Converter" onClick={() => setActiveTab('epoch')} />
          <TabButton active={activeTab === 'jwt'} icon={KeySquare} label="JWT Token Decoder" onClick={() => setActiveTab('jwt')} />
        </div>

        {/* Main Content Area */}
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {activeTab === 'json' && <JsonFormatterTool />}
          {activeTab === 'base64' && <Base64Tool />}
          {activeTab === 'epoch' && <EpochConverterTool />}
          {activeTab === 'jwt' && <JwtDecoderTool />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, icon: Icon, label, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10,
        background: active ? 'var(--brand-primary)15' : 'transparent',
        color: active ? 'var(--brand-primary)' : 'var(--text-secondary)',
        border: active ? '1px solid var(--brand-glow)' : '1px solid transparent',
        fontWeight: 600, fontSize: 14, cursor: 'pointer', transition: 'all 0.2s ease',
        textAlign: 'left'
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
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-app)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>JSON Formatter & Validator</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setInput('')}><Trash2 size={14} /> Clear</button>
          <button className="btn btn-secondary" onClick={minify}><Code2 size={14} /> Minify</button>
          <button className="btn btn-primary" onClick={format}><FileJson size={14} /> Format</button>
          <button className="btn btn-secondary" onClick={copy}>
            {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />} Copy
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
          fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: 'var(--text-primary)',
          lineHeight: 1.6
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

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-primary" onClick={encode} style={{ flex: 1 }}>Encode to Base64</button>
        <button className="btn btn-secondary" onClick={decode} style={{ flex: 1 }}>Decode from Base64</button>
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
         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
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
    <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em' }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{value}</div>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) 2fr', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#ec4899' }}>HEADER (Algorithm / Type)</label>
            <pre style={{ margin: 0, padding: 16, background: 'var(--bg-app)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, color: '#ec4899', whiteSpace: 'pre-wrap' }}>
              {header}
            </pre>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
             <label style={{ fontSize: 12, fontWeight: 700, color: '#a855f7' }}>PAYLOAD (Data)</label>
            <pre style={{ margin: 0, padding: 16, background: 'var(--bg-app)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, color: '#a855f7', overflowX: 'auto' }}>
              {payload}
            </pre>
          </div>
        </div>
      ))}
    </div>
  )
}
