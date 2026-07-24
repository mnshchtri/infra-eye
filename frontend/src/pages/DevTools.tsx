import { useState, useEffect } from 'react'
import {
  KeySquare, Clock, ArrowRightLeft, Search,
  FileJson, Copy, Check, AlertCircle, Trash2, Eraser, type LucideIcon
} from 'lucide-react'
import { cleanManifest, DEFAULT_CLEAN_OPTIONS, type CleanOptions } from '../utils/k8sManifestCleaner'

type ToolId = 'json' | 'base64' | 'epoch' | 'jwt' | 'k8s-clean'

interface ToolMeta {
  id: ToolId
  label: string
  shortDesc: string
  longDesc: string
  icon: LucideIcon
  color: string
  group: string
}

const TOOL_GROUPS = ['Encoding', 'Time', 'Security', 'Kubernetes'] as const

const TOOLS: ToolMeta[] = [
  { id: 'json', label: 'JSON Formatter', shortDesc: 'Format, validate & minify', longDesc: 'Pretty-print, minify, and validate JSON payloads.', icon: FileJson, color: 'var(--brand-primary)', group: 'Encoding' },
  { id: 'base64', label: 'Base64 Encoder', shortDesc: 'Encode & decode strings', longDesc: 'Convert plain text to and from Base64 encoding.', icon: ArrowRightLeft, color: 'var(--info)', group: 'Encoding' },
  { id: 'epoch', label: 'Epoch Converter', shortDesc: 'Timestamp ⇄ date', longDesc: 'Convert between Unix timestamps (seconds/milliseconds) and human-readable dates.', icon: Clock, color: 'var(--warning)', group: 'Time' },
  { id: 'jwt', label: 'JWT Decoder', shortDesc: 'Inspect token claims', longDesc: 'Decode base64url-encoded JSON Web Tokens instantly.', icon: KeySquare, color: 'var(--danger)', group: 'Security' },
  { id: 'k8s-clean', label: 'K8s Manifest Cleaner', shortDesc: 'Strip cluster-generated fields', longDesc: 'Strip server-generated fields from a live manifest so it can be re-applied to any cluster.', icon: Eraser, color: 'var(--success)', group: 'Kubernetes' },
]

export function DevTools() {
  const [activeTab, setActiveTab] = useState<ToolId>('json')
  const [query, setQuery] = useState('')

  const activeTool = TOOLS.find(t => t.id === activeTab)!
  const filteredGroups = TOOL_GROUPS
    .map(group => ({ group, items: TOOLS.filter(t => t.group === group && t.label.toLowerCase().includes(query.toLowerCase())) }))
    .filter(g => g.items.length > 0)

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
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          height: '100%',
          overflow: 'hidden',
          maxWidth: '100%'
        }}>
          <div className="hidden-mobile" style={{ padding: '4px 4px 12px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                className="input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search tools..."
                style={{ height: 32, fontSize: 13, paddingLeft: 30 }}
              />
            </div>
          </div>

          <div className="dev-tools-groups" style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', overflowX: 'auto', flex: 1, paddingBottom: 4 }}>
            {filteredGroups.map(({ group, items }) => (
              <div className="dev-tools-group" key={group}>
                <div className="hidden-mobile" style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', padding: '0 12px 6px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{group}</div>
                <div className="dev-tools-group-items" style={{ display: 'flex', flexDirection: 'inherit', gap: 4 }}>
                  {items.map(tool => (
                    <ToolNavButton key={tool.id} tool={tool} active={activeTab === tool.id} onClick={() => setActiveTab(tool.id)} />
                  ))}
                </div>
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <div className="hidden-mobile" style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                No tools match &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="card dev-tools-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 400, overflow: 'hidden' }}>
          <ToolHeader tool={activeTool} />
          {activeTab === 'json' && <JsonFormatterTool />}
          {activeTab === 'base64' && <Base64Tool />}
          {activeTab === 'epoch' && <EpochConverterTool />}
          {activeTab === 'jwt' && <JwtDecoderTool />}
          {activeTab === 'k8s-clean' && <K8sManifestCleanerTool />}
        </div>
      </div>

      <style>{`
        .dev-tools-layout {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 24px;
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
          .dev-tools-groups {
            flex-direction: row !important;
            overflow-y: visible !important;
            gap: 4px !important;
          }
          .dev-tools-group {
            display: flex;
          }
          .dev-tools-group-items button {
            padding: 8px 12px !important;
            white-space: nowrap;
          }
        }
      `}</style>
    </div>
  )
}

function ToolNavButton({ tool, active, onClick }: { tool: ToolMeta, active: boolean, onClick: () => void }) {
  const Icon = tool.icon
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        border: '1px solid transparent',
        ...(active ? { borderLeft: `3px solid ${tool.color}` } : {}),
        cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'left', width: '100%'
      }}
      className={active ? '' : 'hover-lift'}
      title={tool.shortDesc}
    >
      <span style={{
        width: 28, height: 28, borderRadius: 'var(--radius-md)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? `color-mix(in srgb, ${tool.color} 16%, transparent)` : 'var(--bg-elevated)',
        color: active ? tool.color : 'var(--text-muted)'
      }}>
        <Icon size={14} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{
          fontSize: 12, fontWeight: 800, letterSpacing: '0.02em', textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)', color: active ? tool.color : 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{tool.label}</span>
        <span className="hidden-mobile" style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tool.shortDesc}</span>
      </span>
    </button>
  )
}

function ToolHeader({ tool }: { tool: ToolMeta }) {
  const Icon = tool.icon
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--bg-app)', flexShrink: 0 }}>
      <span style={{
        width: 36, height: 36, borderRadius: 'var(--radius-md)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${tool.color} 14%, transparent)`, color: tool.color
      }}>
        <Icon size={18} />
      </span>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tool.label}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0', maxWidth: 560 }}>{tool.longDesc}</p>
      </div>
    </div>
  )
}

function StatBadge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, padding: '2px 8px',
      borderRadius: 'var(--radius-full)', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      color: 'var(--text-muted)', whiteSpace: 'nowrap'
    }}>{children}</span>
  )
}

function EmptyOutput({ icon: Icon, label }: { icon: LucideIcon, label: string }) {
  return (
    <div style={{
      flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 8, border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', background: 'var(--bg-app)'
    }}>
      <Icon size={20} />
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  )
}

// ── JSON FORMATTER ──

function JsonFormatterTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  function format() {
    if (!input.trim()) return
    try {
      setOutput(JSON.stringify(JSON.parse(input), null, 2))
      setError('')
    } catch (e: any) {
      setError(e.message)
      setOutput('')
    }
  }

  function minify() {
    if (!input.trim()) return
    try {
      setOutput(JSON.stringify(JSON.parse(input)))
      setError('')
    } catch (e: any) {
      setError(e.message)
      setOutput('')
    }
  }

  function copy() {
    if (!output) return
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function clearAll() {
    setInput(''); setOutput(''); setError('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); format() }
  }

  const lines = input ? input.split('\n').length : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>INPUT</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {input && <StatBadge>{input.length} chars &middot; {lines} lines</StatBadge>}
            <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
          </div>
        </div>
        <textarea
          className="input"
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          onKeyDown={onKeyDown}
          placeholder='Paste JSON here... e.g. {"name": "infra-eye"}  ·  Ctrl/Cmd + Enter to format'
          spellCheck={false}
          style={{ height: 180, fontFamily: 'var(--font-mono)', fontSize: 13, padding: 16, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-secondary" onClick={minify} style={{ flex: 1, height: 40, fontSize: 13 }}>Minify</button>
        <button className="btn btn-primary" onClick={format} style={{ flex: 1, height: 40, fontSize: 13 }}>Format</button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 'var(--radius-md)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 160 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>OUTPUT</label>
          {output && (
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
              <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
        {output ? (
          <textarea
            className="input"
            value={output}
            readOnly
            style={{ flex: 1, minHeight: 160, background: 'var(--bg-app)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: 16, resize: 'vertical' }}
          />
        ) : (
          <EmptyOutput icon={FileJson} label="Formatted JSON will appear here" />
        )}
      </div>
    </div>
  )
}

// ── BASE64 TOOL ──

function Base64Tool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  function encode() {
    try {
      setOutput(btoa(input))
      setError('')
    } catch (e) {
      setError('Cannot encode input to Base64 (contains invalid characters).')
      setOutput('')
    }
  }

  function decode() {
    try {
      setOutput(atob(input))
      setError('')
    } catch (e) {
      setError('Invalid Base64 string.')
      setOutput('')
    }
  }

  function copy() {
    if (!output) return
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function clearAll() {
    setInput(''); setOutput(''); setError('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>INPUT</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {input && <StatBadge>{input.length} chars</StatBadge>}
            <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
          </div>
        </div>
        <textarea
          className="input"
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          placeholder="Enter text or Base64 payload..."
          style={{ height: 140, fontFamily: 'var(--font-mono)', fontSize: 13, padding: 16, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={encode} style={{ flex: 1, height: 40, fontSize: 13 }}>Encode</button>
        <button className="btn btn-secondary" onClick={decode} style={{ flex: 1, height: 40, fontSize: 13 }}>Decode</button>
      </div>

      {error && <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', borderRadius: 'var(--radius-md)' }}><AlertCircle size={14} /> {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 140 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>OUTPUT</label>
          {output && (
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
              <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
        {output ? (
          <textarea
            className="input"
            value={output}
            readOnly
            style={{ flex: 1, minHeight: 140, background: 'var(--bg-app)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: 16, resize: 'none' }}
          />
        ) : (
          <EmptyOutput icon={ArrowRightLeft} label="Encoded or decoded output will appear here" />
        )}
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 24, overflowY: 'auto' }}>
      <div className="card" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>ENTER TIMESTAMP</label>
          <StatBadge>{isSeconds ? 'seconds' : 'milliseconds'}</StatBadge>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            className="input"
            value={timestamp}
            onChange={e => setTimestamp(e.target.value)}
            style={{ fontSize: 20, fontFamily: 'var(--font-mono)', height: 48, flex: 1, minWidth: 200 }}
          />
          <button className="btn btn-secondary" style={{ height: 48 }} onClick={() => setTimestamp(Date.now().toString())}>Now (ms)</button>
          <button className="btn btn-secondary" style={{ height: 48 }} onClick={() => setTimestamp(Math.floor(Date.now() / 1000).toString())}>Now (s)</button>
        </div>
      </div>

      {isValid ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click a result to copy it</span>
          <div className="grid-2-col" style={{ gap: 16 }}>
            <ResultBox label="Local Time" value={dateObj.toLocaleString()} />
            <ResultBox label="UTC Time" value={dateObj.toUTCString()} />
            <ResultBox label="ISO 8601" value={dateObj.toISOString()} />
            <ResultBox label="Relative" value={getRelativeTime(dateObj)} />
          </div>
        </div>
      ) : (
        <EmptyOutput icon={Clock} label="Enter a valid Unix timestamp" />
      )}
    </div>
  )
}

function ResultBox({ label, value }: { label: string, value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className="hover-lift"
      style={{ padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', textAlign: 'left', cursor: 'pointer', width: '100%' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        {copied ? <Check size={13} color="var(--success)" /> : <Copy size={13} color="var(--text-muted)" />}
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{value}</div>
    </button>
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

  function copyBlock(text: string) {
    if (text) navigator.clipboard.writeText(text)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>TOKEN STRING</label>
          {jwt && <button className="btn btn-secondary btn-sm" onClick={() => setJwt('')} title="Clear"><Trash2 size={14} /></button>}
        </div>
        <textarea
          className="input"
          value={jwt}
          onChange={e => setJwt(e.target.value)}
          placeholder="eyJhbGciOiJIUz... (paste your token here)"
          style={{ height: 100, fontFamily: 'var(--font-mono)', fontSize: 13, padding: 16, resize: 'vertical', wordBreak: 'break-all' }}
        />
      </div>

      {error ? (
        <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{error}</div>
        </div>
      ) : jwt ? (
        <div className="grid-2-col" style={{ gap: 16, flex: 1, minHeight: 160 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)' }}>HEADER</label>
              <button className="btn btn-secondary btn-sm" onClick={() => copyBlock(header)} title="Copy header"><Copy size={13} /></button>
            </div>
            <pre style={{ margin: 0, padding: 16, background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--warning)', whiteSpace: 'pre-wrap', flex: 1, fontFamily: 'var(--font-mono)' }}>
              {header}
            </pre>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-primary)' }}>PAYLOAD</label>
              <button className="btn btn-secondary btn-sm" onClick={() => copyBlock(payload)} title="Copy payload"><Copy size={13} /></button>
            </div>
            <pre style={{ margin: 0, padding: 16, background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--brand-primary)', overflowX: 'auto', flex: 1, fontFamily: 'var(--font-mono)' }}>
              {payload}
            </pre>
          </div>
        </div>
      ) : (
        <EmptyOutput icon={KeySquare} label="Paste a JWT to decode its header and payload" />
      )}
    </div>
  )
}

// ── K8S MANIFEST CLEANER ──

const ALWAYS_STRIPPED_FIELDS = ['status', 'metadata.uid', 'resourceVersion', 'creationTimestamp', 'generation', 'managedFields', 'selfLink', 'ownerReferences']

function K8sManifestCleanerTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [removedFields, setRemovedFields] = useState<string[]>([])
  const [documentCount, setDocumentCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [options, setOptions] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS)

  function clean() {
    if (!input.trim()) return
    const result = cleanManifest(input, options)
    if (result.error) {
      setError(result.error)
      setOutput('')
      setRemovedFields([])
      setDocumentCount(0)
      return
    }
    setError('')
    setOutput(result.output)
    setRemovedFields(result.removedFields)
    setDocumentCount(result.documentCount)
  }

  function copy() {
    if (!output) return
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function clearAll() {
    setInput('')
    setOutput('')
    setError('')
    setRemovedFields([])
    setDocumentCount(0)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24, gap: 16, overflowY: 'auto' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Always stripped</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ALWAYS_STRIPPED_FIELDS.map(field => (
            <span
              key={field}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)'
              }}
            >
              {field}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={options.stripLastApplied}
            onChange={e => setOptions(o => ({ ...o, stripLastApplied: e.target.checked }))}
          />
          Strip <code>kubectl.kubernetes.io/last-applied-configuration</code> annotation
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={options.stripNamespace}
            onChange={e => setOptions(o => ({ ...o, stripNamespace: e.target.checked }))}
          />
          Strip <code>metadata.namespace</code> (apply into any namespace)
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>INPUT MANIFEST</label>
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
        </div>
        <textarea
          className="input"
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          placeholder="Paste kubectl get -o yaml output here..."
          spellCheck={false}
          style={{ height: 220, fontFamily: 'var(--font-mono)', padding: 16, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-secondary btn-sm" onClick={clearAll}><Trash2 size={14} /> Clear</button>
        <button className="btn btn-primary" onClick={clean} style={{ flex: 1, height: 42, fontSize: 13 }}>Clean Manifest</button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 'var(--radius-md)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {!error && (output ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                CLEANED OUTPUT <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({documentCount} document{documentCount === 1 ? '' : 's'})</span>
              </label>
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy Output'}</span>
              </button>
            </div>
            <textarea
              className="input"
              value={output}
              readOnly
              style={{ flex: 1, minHeight: 220, background: 'var(--bg-app)', fontFamily: 'var(--font-mono)', padding: 16, resize: 'vertical' }}
            />
          </div>

          {removedFields.length > 0 && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                FIELDS REMOVED
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {removedFields.map(field => (
                  <span
                    key={field}
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12, padding: '4px 8px', borderRadius: 6,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)'
                    }}
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyOutput icon={Eraser} label="Cleaned manifest will appear here" />
      ))}
    </div>
  )
}
