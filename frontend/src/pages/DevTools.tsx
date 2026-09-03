import { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import {
  KeySquare, KeyRound, Clock, ArrowRightLeft, CalendarClock,
  FileJson, Braces, Hash, Copy, Check, AlertCircle, Trash2, Eraser, Route,
  Network, ShieldCheck, Cpu, GitCompare, Fingerprint, Container, FileCode2, type LucideIcon
} from 'lucide-react'
import { cleanManifest, DEFAULT_CLEAN_OPTIONS, type CleanOptions } from '../utils/k8sManifestCleaner'
import { convertIngressToGateway } from '../utils/ingressToGateway'
import { calculateCidr } from '../utils/cidrCalculator'
import { decodeCertificate } from '../utils/certDecoder'
import { parseCron } from '../utils/cronParser'
import { computeDiff } from '../utils/textDiff'
import { evaluateJsonnet } from '../utils/jsonnetEvaluator'
import { SectionHeader, EmptyState, TabSwitcher } from '../components/ui'
import { errMessage } from '../utils/errors'

type ToolId =
  | 'json' | 'base64' | 'yaml-json' | 'hash'
  | 'epoch' | 'cron'
  | 'jwt' | 'jwt-encode' | 'cert-decode'
  | 'k8s-clean' | 'ingress2gateway' | 'k8s-units' | 'jsonnet'
  | 'cidr'
  | 'uuid' | 'diff' | 'docker-image'

type Category = 'Encoding' | 'Time' | 'Security' | 'Kubernetes' | 'Networking' | 'Utilities'

const CATEGORIES: Category[] = ['Encoding', 'Time', 'Security', 'Kubernetes', 'Networking', 'Utilities']

interface ToolMeta {
  id: ToolId
  label: string
  subtitle: string
  icon: LucideIcon
  color: string
  group: Category
}

const TOOLS: ToolMeta[] = [
  { id: 'json', label: 'JSON Formatter', subtitle: 'Pretty-print, minify, and validate JSON payloads.', icon: FileJson, color: 'var(--brand-primary)', group: 'Encoding' },
  { id: 'base64', label: 'Base64 Encoder', subtitle: 'Convert plain text to and from Base64 encoding.', icon: ArrowRightLeft, color: 'var(--info)', group: 'Encoding' },
  { id: 'yaml-json', label: 'YAML ↔ JSON', subtitle: 'Convert between YAML and JSON, either direction.', icon: Braces, color: 'var(--brand-primary)', group: 'Encoding' },
  { id: 'hash', label: 'Hash Generator', subtitle: 'SHA-1 / SHA-256 / SHA-384 / SHA-512 digest of pasted text.', icon: Hash, color: 'var(--info)', group: 'Encoding' },
  { id: 'epoch', label: 'Epoch Converter', subtitle: 'Convert between Unix timestamps (seconds/milliseconds) and human-readable dates.', icon: Clock, color: 'var(--warning)', group: 'Time' },
  { id: 'cron', label: 'Cron Parser', subtitle: 'Explain a 5-field cron expression in plain English and show its next run times.', icon: CalendarClock, color: 'var(--warning)', group: 'Time' },
  { id: 'jwt', label: 'JWT Decoder', subtitle: 'Decode base64url-encoded JSON Web Tokens instantly.', icon: KeySquare, color: 'var(--danger)', group: 'Security' },
  { id: 'jwt-encode', label: 'JWT Encoder', subtitle: 'Sign a header/payload pair into an HS256 JWT for local testing.', icon: KeyRound, color: 'var(--danger)', group: 'Security' },
  { id: 'cert-decode', label: 'TLS Certificate Decoder', subtitle: 'Paste a PEM certificate to see its Subject, Issuer, validity window, and SANs.', icon: ShieldCheck, color: 'var(--danger)', group: 'Security' },
  { id: 'k8s-clean', label: 'K8s Manifest Cleaner', subtitle: 'Strip server-generated fields from a live manifest so it can be re-applied to any cluster.', icon: Eraser, color: 'var(--success)', group: 'Kubernetes' },
  { id: 'ingress2gateway', label: 'Ingress → Gateway API', subtitle: 'Convert an Ingress into a Gateway and HTTPRoute (Gateway API). Best-effort — review annotation-driven behavior manually.', icon: Route, color: 'var(--accent-purple)', group: 'Kubernetes' },
  { id: 'k8s-units', label: 'Resource Units', subtitle: 'Convert CPU (millicores/cores) and memory (Ki/Mi/Gi/Ti, decimal/binary) quantities.', icon: Cpu, color: 'var(--success)', group: 'Kubernetes' },
  { id: 'jsonnet', label: 'Jsonnet Evaluator', subtitle: 'Evaluate Jsonnet — the language Tanka (grafana.com/oss/tanka) uses for Kubernetes config — into JSON or YAML.', icon: FileCode2, color: 'var(--accent-cyan)', group: 'Kubernetes' },
  { id: 'cidr', label: 'CIDR Calculator', subtitle: 'Network/broadcast address, usable host range, and netmask for a CIDR block.', icon: Network, color: 'var(--accent-cyan)', group: 'Networking' },
  { id: 'uuid', label: 'UUID / Secret Generator', subtitle: 'Generate UUIDv4s or cryptographically random secrets.', icon: Fingerprint, color: 'var(--accent-purple)', group: 'Utilities' },
  { id: 'diff', label: 'Diff Checker', subtitle: 'Compare two blocks of text line by line.', icon: GitCompare, color: 'var(--accent-pink)', group: 'Utilities' },
  { id: 'docker-image', label: 'Image Reference Parser', subtitle: 'Break a container image reference into registry, repository, tag, and digest.', icon: Container, color: 'var(--accent-lime)', group: 'Utilities' },
]

export function DevTools() {
  const [activeTab, setActiveTab] = useState<ToolId>('json')
  const activeTool = TOOLS.find(t => t.id === activeTab)!
  const activeGroup = activeTool.group

  function selectGroup(g: Category) {
    const first = TOOLS.find(t => t.group === g)
    if (first) setActiveTab(first.id)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Developer Tools</h1>
          <p className="page-subtitle hidden-mobile">Client-side utilities for DevOps, systems configuration, and debugging.</p>
        </div>
      </div>

      <div className="tabs-scroll-x" style={{ marginBottom: 10, flexShrink: 0 }}>
        <TabSwitcher
          className="tab-switcher-secondary"
          tabs={CATEGORIES.map(g => ({ id: g, label: g }))}
          active={activeGroup}
          onChange={id => selectGroup(id as Category)}
        />
      </div>

      <div className="tabs-scroll-x" style={{ marginBottom: 20, flexShrink: 0 }}>
        <TabSwitcher
          tabs={TOOLS.filter(t => t.group === activeGroup).map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
          active={activeTab}
          onChange={id => setActiveTab(id as ToolId)}
        />
      </div>

      <div className="card devtools-card" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
        <div className="devtools-header">
          <SectionHeader
            className="section-header-flush"
            icon={activeTool.icon}
            iconColor={activeTool.color}
            title={activeTool.label}
            subtitle={activeTool.subtitle}
          />
        </div>
        {activeTab === 'json' && <JsonFormatterTool />}
        {activeTab === 'base64' && <Base64Tool />}
        {activeTab === 'yaml-json' && <YamlJsonTool />}
        {activeTab === 'hash' && <HashGeneratorTool />}
        {activeTab === 'epoch' && <EpochConverterTool />}
        {activeTab === 'cron' && <CronParserTool />}
        {activeTab === 'jwt' && <JwtDecoderTool />}
        {activeTab === 'jwt-encode' && <JwtEncoderTool />}
        {activeTab === 'cert-decode' && <CertDecoderTool />}
        {activeTab === 'k8s-clean' && <K8sManifestCleanerTool />}
        {activeTab === 'ingress2gateway' && <Ingress2GatewayTool />}
        {activeTab === 'k8s-units' && <ResourceUnitsTool />}
        {activeTab === 'jsonnet' && <JsonnetEvaluatorTool />}
        {activeTab === 'cidr' && <CidrCalculatorTool />}
        {activeTab === 'uuid' && <UuidGeneratorTool />}
        {activeTab === 'diff' && <DiffCheckerTool />}
        {activeTab === 'docker-image' && <DockerImageParserTool />}
      </div>

      <style>{`
        .devtools-header { padding: 20px 24px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
        .tab-switcher-secondary .tab-switcher-btn { padding: 5px 12px; font-size: 12px; background: transparent; border-color: transparent; color: var(--text-muted); }
        .tab-switcher-secondary .tab-switcher-btn.active { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border); }
        .devtools-body { padding: 24px; display: flex; flex-direction: column; gap: 18px; }
        .devtools-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .devtools-toolbar-spacer { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .devtools-error { padding: 12px 16px; background: rgba(239, 68, 68, 0.1); color: var(--danger); font-size: 13px; display: flex; align-items: center; gap: 8px; border-radius: var(--radius-md); }
        .devtools-pane { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
        .devtools-pane-label-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .devtools-pane-label { font-size: 12px; font-weight: 800; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; }
        .devtools-split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
        .devtools-textarea { width: 100%; min-height: 420px; font-family: var(--font-mono); font-size: 13.5px; line-height: 1.6; padding: 18px 20px; resize: vertical; box-sizing: border-box; }
        .devtools-options { display: flex; flex-wrap: wrap; gap: 20px; padding: 14px 16px; background: var(--bg-app); border: 1px solid var(--border); border-radius: var(--radius-md); }
        .devtools-option { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
        @media (max-width: 960px) {
          .devtools-split { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .devtools-textarea { min-height: 260px; }
          .devtools-body { padding: 18px; }
          .devtools-header { padding: 16px 18px; }
        }
      `}</style>
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
    } catch (e: unknown) {
      setError(errMessage(e))
      setOutput('')
    }
  }

  function minify() {
    if (!input.trim()) return
    try {
      setOutput(JSON.stringify(JSON.parse(input)))
      setError('')
    } catch (e: unknown) {
      setError(errMessage(e))
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
    <div className="devtools-body">
      <div className="devtools-toolbar">
        <button className="btn btn-secondary" onClick={minify}>Minify</button>
        <button className="btn btn-primary" onClick={format}>Format</button>
        <div className="devtools-toolbar-spacer">
          {input && <StatBadge>{input.length} chars &middot; {lines} lines</StatBadge>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
        </div>
      </div>

      {error && (
        <div className="devtools-error"><AlertCircle size={16} /> {error}</div>
      )}

      <div className="devtools-split">
        <div className="devtools-pane">
          <label className="devtools-pane-label">Input</label>
          <textarea
            className="input devtools-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            onKeyDown={onKeyDown}
            placeholder='Paste JSON here... e.g. {"name": "infra-eye"}  ·  Ctrl/Cmd + Enter to format'
            spellCheck={false}
          />
        </div>

        <div className="devtools-pane">
          <div className="devtools-pane-label-row">
            <label className="devtools-pane-label">Output</label>
            {output && (
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          {output ? (
            <textarea
              className="input devtools-textarea"
              value={output}
              readOnly
              style={{ background: 'var(--bg-app)' }}
            />
          ) : (
            <EmptyState icon={FileJson} title="Formatted JSON will appear here" />
          )}
        </div>
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
    } catch {
      setError('Cannot encode input to Base64 (contains invalid characters).')
      setOutput('')
    }
  }

  function decode() {
    try {
      setOutput(atob(input))
      setError('')
    } catch {
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
    <div className="devtools-body">
      <div className="devtools-toolbar">
        <button className="btn btn-primary" onClick={encode}>Encode</button>
        <button className="btn btn-secondary" onClick={decode}>Decode</button>
        <div className="devtools-toolbar-spacer">
          {input && <StatBadge>{input.length} chars</StatBadge>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
        </div>
      </div>

      {error && <div className="devtools-error"><AlertCircle size={14} /> {error}</div>}

      <div className="devtools-split">
        <div className="devtools-pane">
          <label className="devtools-pane-label">Input</label>
          <textarea
            className="input devtools-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Enter text or Base64 payload..."
          />
        </div>

        <div className="devtools-pane">
          <div className="devtools-pane-label-row">
            <label className="devtools-pane-label">Output</label>
            {output && (
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          {output ? (
            <textarea
              className="input devtools-textarea"
              value={output}
              readOnly
              style={{ background: 'var(--bg-app)' }}
            />
          ) : (
            <EmptyState icon={ArrowRightLeft} title="Encoded or decoded output will appear here" />
          )}
        </div>
      </div>
    </div>
  )
}

// ── EPOCH CONVERTER ──

function EpochConverterTool() {
  const [timestamp, setTimestamp] = useState(() => Date.now().toString())

  const tsNum = parseInt(timestamp) || 0
  const isSeconds = timestamp.length <= 10
  const dateObj = new Date(isSeconds ? tsNum * 1000 : tsNum)

  const isValid = !isNaN(dateObj.getTime())

  // Helper method inside component to easily manage dependencies like Date.now() difference
  const getRelativeTime = (d1: Date) => {
    // A relative-time readout is inherently a function of the current clock.
  // eslint-disable-next-line react-hooks/purity
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
    <div className="devtools-body" style={{ gap: 24 }}>
      <div className="card" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <label className="devtools-pane-label">Enter timestamp</label>
          <StatBadge>{isSeconds ? 'seconds' : 'milliseconds'}</StatBadge>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            className="input"
            value={timestamp}
            onChange={e => setTimestamp(e.target.value)}
            style={{ fontSize: 22, fontFamily: 'var(--font-mono)', height: 52, flex: 1, minWidth: 240, padding: '0 18px' }}
          />
          <button className="btn btn-secondary" style={{ height: 52 }} onClick={() => setTimestamp(Date.now().toString())}>Now (ms)</button>
          <button className="btn btn-secondary" style={{ height: 52 }} onClick={() => setTimestamp(Math.floor(Date.now() / 1000).toString())}>Now (s)</button>
        </div>
      </div>

      {isValid ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click a result to copy it</span>
          <div className="grid-2-col" style={{ gap: 20 }}>
            <ResultBox label="Local Time" value={dateObj.toLocaleString()} />
            <ResultBox label="UTC Time" value={dateObj.toUTCString()} />
            <ResultBox label="ISO 8601" value={dateObj.toISOString()} />
            <ResultBox label="Relative" value={getRelativeTime(dateObj)} />
          </div>
        </div>
      ) : (
        <EmptyState icon={Clock} title="Enter a valid Unix timestamp" />
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
      style={{ padding: '16px 20px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', textAlign: 'left', cursor: 'pointer', width: '100%' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        {copied ? <Check size={13} color="var(--success)" /> : <Copy size={13} color="var(--text-muted)" />}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{value}</div>
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
    } catch (e: unknown) {
      setError(errMessage(e) || 'Invalid JWT format')
      setHeader('')
      setPayload('')
    }
  }, [jwt])

  function copyBlock(text: string) {
    if (text) navigator.clipboard.writeText(text)
  }

  return (
    <div className="devtools-body">
      <div className="devtools-pane">
        <div className="devtools-pane-label-row">
          <label className="devtools-pane-label">Token string</label>
          {jwt && <button className="btn btn-secondary btn-sm" onClick={() => setJwt('')} title="Clear"><Trash2 size={14} /></button>}
        </div>
        <textarea
          className="input devtools-textarea"
          value={jwt}
          onChange={e => setJwt(e.target.value)}
          placeholder="eyJhbGciOiJIUz... (paste your token here)"
          style={{ minHeight: 140, wordBreak: 'break-all' }}
        />
      </div>

      {error ? (
        <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{error}</div>
        </div>
      ) : jwt ? (
        <div className="devtools-split">
          <div className="devtools-pane">
            <div className="devtools-pane-label-row">
              <label className="devtools-pane-label" style={{ color: 'var(--warning)' }}>Header</label>
              <button className="btn btn-secondary btn-sm" onClick={() => copyBlock(header)} title="Copy header"><Copy size={13} /></button>
            </div>
            <pre className="devtools-textarea" style={{ margin: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--warning)', whiteSpace: 'pre-wrap', minHeight: 260 }}>
              {header}
            </pre>
          </div>
          <div className="devtools-pane">
            <div className="devtools-pane-label-row">
              <label className="devtools-pane-label" style={{ color: 'var(--brand-primary)' }}>Payload</label>
              <button className="btn btn-secondary btn-sm" onClick={() => copyBlock(payload)} title="Copy payload"><Copy size={13} /></button>
            </div>
            <pre className="devtools-textarea" style={{ margin: 0, background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--brand-primary)', overflowX: 'auto', minHeight: 260 }}>
              {payload}
            </pre>
          </div>
        </div>
      ) : (
        <EmptyState icon={KeySquare} title="Paste a JWT to decode its header and payload" />
      )}
    </div>
  )
}

// ── K8S MANIFEST CLEANER ──

const ALWAYS_STRIPPED_FIELDS = [
  'status', 'metadata.uid', 'resourceVersion', 'creationTimestamp', 'generation',
  'managedFields', 'selfLink', 'ownerReferences', 'pod-template creationTimestamp',
  'cluster-managed annotations',
]

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
    <div className="devtools-body">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="devtools-pane-label">Always stripped</label>
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

      <div className="devtools-options">
        <label className="devtools-option">
          <input
            type="checkbox"
            checked={options.stripLastApplied}
            onChange={e => setOptions(o => ({ ...o, stripLastApplied: e.target.checked }))}
          />
          Strip <code>kubectl.kubernetes.io/last-applied-configuration</code> annotation
        </label>
        <label className="devtools-option">
          <input
            type="checkbox"
            checked={options.stripNamespace}
            onChange={e => setOptions(o => ({ ...o, stripNamespace: e.target.checked }))}
          />
          Strip <code>metadata.namespace</code> (apply into any namespace)
        </label>
        <label className="devtools-option">
          <input
            type="checkbox"
            checked={options.stripFinalizers}
            onChange={e => setOptions(o => ({ ...o, stripFinalizers: e.target.checked }))}
          />
          Strip cluster-managed <code>finalizers</code> (pvc/pv-protection)
        </label>
        <label className="devtools-option">
          <input
            type="checkbox"
            checked={options.stripBindingInfo}
            onChange={e => setOptions(o => ({ ...o, stripBindingInfo: e.target.checked }))}
          />
          Strip binding info (Service <code>clusterIP</code>, PVC <code>volumeName</code>, Pod <code>nodeName</code>)
        </label>
      </div>

      <div className="devtools-toolbar">
        <button className="btn btn-primary" onClick={clean}>Clean Manifest</button>
        <div className="devtools-toolbar-spacer">
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
        </div>
      </div>

      {error && (
        <div className="devtools-error"><AlertCircle size={16} /> {error}</div>
      )}

      <div className="devtools-split">
        <div className="devtools-pane">
          <label className="devtools-pane-label">Input manifest</label>
          <textarea
            className="input devtools-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Paste kubectl get -o yaml output here..."
            spellCheck={false}
          />
        </div>

        <div className="devtools-pane">
          <div className="devtools-pane-label-row">
            <label className="devtools-pane-label">
              Cleaned output {output && <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>&nbsp;({documentCount} document{documentCount === 1 ? '' : 's'})</span>}
            </label>
            {output && (
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy Output'}</span>
              </button>
            )}
          </div>
          {output ? (
            <textarea
              className="input devtools-textarea"
              value={output}
              readOnly
              style={{ background: 'var(--bg-app)' }}
            />
          ) : (
            <EmptyState icon={Eraser} title="Cleaned manifest will appear here" />
          )}
        </div>
      </div>

      {removedFields.length > 0 && (
        <div>
          <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 8 }}>
            Fields removed
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
    </div>
  )
}

// ── INGRESS → GATEWAY API ──

function Ingress2GatewayTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [ingressCount, setIngressCount] = useState(0)
  const [copied, setCopied] = useState(false)

  function convert() {
    if (!input.trim()) return
    const result = convertIngressToGateway(input)
    if (result.error) {
      setError(result.error)
      setOutput('')
      setWarnings([])
      setIngressCount(0)
      return
    }
    setError('')
    setOutput(result.output)
    setWarnings(result.warnings)
    setIngressCount(result.ingressCount)
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
    setWarnings([])
    setIngressCount(0)
  }

  return (
    <div className="devtools-body">
      <div className="devtools-error" style={{ background: 'var(--bg-app)', color: 'var(--text-secondary)' }}>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        Best-effort mapping (hosts, paths, backends, TLS) — annotation-driven behavior like nginx rewrite-target or canary weighting has no Gateway API equivalent and is called out below instead of guessed at.
      </div>

      <div className="devtools-toolbar">
        <button className="btn btn-primary" onClick={convert}>Convert</button>
        <div className="devtools-toolbar-spacer">
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
        </div>
      </div>

      {error && (
        <div className="devtools-error"><AlertCircle size={16} /> {error}</div>
      )}

      <div className="devtools-split">
        <div className="devtools-pane">
          <label className="devtools-pane-label">Input ingress</label>
          <textarea
            className="input devtools-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Paste kubectl get ingress -o yaml output here..."
            spellCheck={false}
          />
        </div>

        <div className="devtools-pane">
          <div className="devtools-pane-label-row">
            <label className="devtools-pane-label">
              Gateway + HTTPRoute {output && <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>&nbsp;({ingressCount} ingress{ingressCount === 1 ? '' : 'es'} converted)</span>}
            </label>
            {output && (
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy Output'}</span>
              </button>
            )}
          </div>
          {output ? (
            <textarea
              className="input devtools-textarea"
              value={output}
              readOnly
              style={{ background: 'var(--bg-app)' }}
            />
          ) : (
            <EmptyState icon={Route} title="Converted Gateway + HTTPRoute will appear here" />
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <div>
          <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 8, color: 'var(--warning)' }}>
            Needs manual review
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {warnings.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13, padding: '8px 12px', borderRadius: 'var(--radius-md)',
                  background: 'rgba(240, 171, 0, 0.1)', border: '1px solid rgba(240, 171, 0, 0.3)', color: 'var(--text-secondary)',
                  display: 'flex', gap: 8, alignItems: 'flex-start'
                }}
              >
                <AlertCircle size={14} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── JSONNET EVALUATOR (TANKA) ──

const JSONNET_PLACEHOLDER = `// Jsonnet is the config language Tanka (grafana.com/oss/tanka) uses to
// generate Kubernetes manifests. This evaluates a standalone snippet
// in-browser — no imports of external files, matching Tanka's "jsonnet
// eval" step but without a project's lib/vendor tree.
local deployment(name, image, replicas=1) = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: name },
  spec: {
    replicas: replicas,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: { containers: [{ name: name, image: image }] },
    },
  },
};

deployment('web', 'nginx:1.27', replicas=3)
`

function JsonnetEvaluatorTool() {
  const [input, setInput] = useState(JSONNET_PLACEHOLDER)
  const [outputFormat, setOutputFormat] = useState<'json' | 'yaml'>('yaml')
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const output = result === null ? '' : outputFormat === 'yaml'
    ? yaml.dump(result, { lineWidth: -1, noRefs: true })
    : JSON.stringify(result, null, 2)

  async function evaluate() {
    if (!input.trim()) return
    setBusy(true)
    setError('')
    try {
      const evaluated = await evaluateJsonnet(input)
      if (evaluated.error) {
        setError(evaluated.error)
        setResult(null)
      } else {
        setResult(JSON.parse(evaluated.output))
      }
    } catch (e) {
      setError(e instanceof Error ? errMessage(e) : 'Could not evaluate this Jsonnet snippet.')
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  function copy() {
    if (!output) return
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function clearAll() {
    setInput(''); setResult(null); setError('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); evaluate() }
  }

  return (
    <div className="devtools-body">
      <div className="devtools-error" style={{ background: 'var(--bg-app)', color: 'var(--text-secondary)' }}>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        Standalone snippet only — no <code>import</code> of external files or Tanka's <code>lib/</code>/<code>vendor/</code>. First run downloads a ~2MB WASM evaluator.
      </div>

      <div className="devtools-toolbar">
        <button className="btn btn-primary" onClick={evaluate} disabled={busy || !input.trim()}>
          {busy ? 'Evaluating…' : 'Evaluate'}
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn btn-sm ${outputFormat === 'yaml' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOutputFormat('yaml')}>YAML</button>
          <button className={`btn btn-sm ${outputFormat === 'json' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOutputFormat('json')}>JSON</button>
        </div>
        <div className="devtools-toolbar-spacer">
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
        </div>
      </div>

      {error && (
        <div className="devtools-error"><AlertCircle size={16} /> <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>{error}</pre></div>
      )}

      <div className="devtools-split">
        <div className="devtools-pane">
          <label className="devtools-pane-label">Jsonnet Input</label>
          <textarea
            className="input devtools-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            onKeyDown={onKeyDown}
            placeholder="Paste Jsonnet here... Ctrl/Cmd + Enter to evaluate"
            spellCheck={false}
          />
        </div>

        <div className="devtools-pane">
          <div className="devtools-pane-label-row">
            <label className="devtools-pane-label">Output ({outputFormat.toUpperCase()})</label>
            {output && (
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          {output ? (
            <textarea className="input devtools-textarea" value={output} readOnly style={{ background: 'var(--bg-app)' }} />
          ) : (
            <EmptyState icon={FileCode2} title="Evaluated manifest will appear here" />
          )}
        </div>
      </div>
    </div>
  )
}

// ── YAML ↔ JSON ──

function YamlJsonTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  function toJson() {
    if (!input.trim()) return
    try {
      setOutput(JSON.stringify(yaml.load(input), null, 2))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? errMessage(e) : 'Invalid YAML')
      setOutput('')
    }
  }

  function toYaml() {
    if (!input.trim()) return
    try {
      setOutput(yaml.dump(JSON.parse(input), { lineWidth: -1, noRefs: true }))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? errMessage(e) : 'Invalid JSON')
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
    <div className="devtools-body">
      <div className="devtools-toolbar">
        <button className="btn btn-primary" onClick={toJson}>YAML → JSON</button>
        <button className="btn btn-secondary" onClick={toYaml}>JSON → YAML</button>
        <div className="devtools-toolbar-spacer">
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
        </div>
      </div>

      {error && <div className="devtools-error"><AlertCircle size={14} /> {error}</div>}

      <div className="devtools-split">
        <div className="devtools-pane">
          <label className="devtools-pane-label">Input</label>
          <textarea
            className="input devtools-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Paste YAML or JSON here..."
            spellCheck={false}
          />
        </div>

        <div className="devtools-pane">
          <div className="devtools-pane-label-row">
            <label className="devtools-pane-label">Output</label>
            {output && (
              <button className="btn btn-secondary btn-sm" onClick={copy}>
                {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          {output ? (
            <textarea className="input devtools-textarea" value={output} readOnly style={{ background: 'var(--bg-app)' }} />
          ) : (
            <EmptyState icon={Braces} title="Converted output will appear here" />
          )}
        </div>
      </div>
    </div>
  )
}

// ── HASH GENERATOR ──

const HASH_ALGOS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const

function HashGeneratorTool() {
  const [input, setInput] = useState('')
  const [hashes, setHashes] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState(false)

  async function compute() {
    if (!input) { setHashes(null); return }
    setBusy(true)
    const data = new TextEncoder().encode(input)
    const results: Record<string, string> = {}
    for (const algo of HASH_ALGOS) {
      const buf = await crypto.subtle.digest(algo, data)
      results[algo] = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
    }
    setHashes(results)
    setBusy(false)
  }

  function clearAll() {
    setInput(''); setHashes(null)
  }

  return (
    <div className="devtools-body">
      <div className="devtools-pane">
        <div className="devtools-pane-label-row">
          <label className="devtools-pane-label">Input</label>
          {input && <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>}
        </div>
        <textarea
          className="input devtools-textarea"
          value={input}
          onChange={e => { setInput(e.target.value); setHashes(null) }}
          placeholder="Enter text to hash..."
          style={{ minHeight: 160 }}
        />
      </div>

      <button className="btn btn-primary" onClick={compute} disabled={busy || !input} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Computing…' : 'Compute Hashes'}
      </button>

      {hashes ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {HASH_ALGOS.map(algo => (
            <ResultBox key={algo} label={algo} value={hashes[algo]} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Hash} title="Digests will appear here" />
      )}
    </div>
  )
}

// ── CRON PARSER ──

function CronParserTool() {
  const [expr, setExpr] = useState('*/15 * * * *')
  const [result, setResult] = useState(() => parseCron('*/15 * * * *'))

  function parse(value: string) {
    setExpr(value)
    setResult(parseCron(value))
  }

  return (
    <div className="devtools-body" style={{ gap: 24 }}>
      <div className="card" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
        <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 12 }}>Cron expression (minute hour day-of-month month day-of-week)</label>
        <input
          className="input"
          value={expr}
          onChange={e => parse(e.target.value)}
          placeholder="*/15 * * * *"
          style={{ fontSize: 18, fontFamily: 'var(--font-mono)', height: 48, padding: '0 16px' }}
          spellCheck={false}
        />
      </div>

      {result.error ? (
        <div className="devtools-error"><AlertCircle size={16} /> {result.error}</div>
      ) : (
        <>
          <div style={{ padding: '16px 20px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            {result.description}
          </div>

          <div>
            <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 10 }}>Next {result.nextRuns.length} runs (UTC)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {result.nextRuns.map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  <span>{d.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{d.toLocaleString()}</span>
                </div>
              ))}
              {result.nextRuns.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No matching run found in the next 4 years — check the expression (e.g. Feb 30 never occurs).</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── JWT ENCODER ──

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signJwtHS256(payloadJson: string, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  JSON.parse(payloadJson) // validate before encoding
  const headerPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)))
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(JSON.parse(payloadJson))))
  const signingInput = `${headerPart}.${payloadPart}`

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sigBuf))}`
}

function JwtEncoderTool() {
  const [payload, setPayload] = useState('{\n  "sub": "1234567890",\n  "name": "Jane Doe",\n  "iat": 1516239022\n}')
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function sign() {
    if (!payload.trim() || !secret) return
    try {
      setToken(await signJwtHS256(payload, secret))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? errMessage(e) : 'Could not sign token — check the payload is valid JSON.')
      setToken('')
    }
  }

  function copy() {
    if (!token) return
    navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="devtools-body">
      <div className="devtools-error" style={{ background: 'var(--bg-app)', color: 'var(--text-secondary)' }}>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        HS256 only, signed entirely in the browser — for generating local test tokens, not for issuing production credentials.
      </div>

      <div className="devtools-pane">
        <label className="devtools-pane-label">Payload (JSON)</label>
        <textarea
          className="input devtools-textarea"
          value={payload}
          onChange={e => { setPayload(e.target.value); setError('') }}
          style={{ minHeight: 200 }}
          spellCheck={false}
        />
      </div>

      <div className="devtools-toolbar">
        <input
          className="input"
          value={secret}
          onChange={e => setSecret(e.target.value)}
          placeholder="Signing secret"
          style={{ maxWidth: 320, fontFamily: 'var(--font-mono)' }}
          type="password"
        />
        <button className="btn btn-primary" onClick={sign} disabled={!payload.trim() || !secret}>Sign Token</button>
      </div>

      {error && <div className="devtools-error"><AlertCircle size={14} /> {error}</div>}

      {token ? (
        <div className="devtools-pane">
          <div className="devtools-pane-label-row">
            <label className="devtools-pane-label">Token</label>
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
              <span style={{ marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <textarea className="input devtools-textarea" value={token} readOnly style={{ minHeight: 120, background: 'var(--bg-app)', wordBreak: 'break-all' }} />
        </div>
      ) : (
        <EmptyState icon={KeyRound} title="Signed token will appear here" />
      )}
    </div>
  )
}

// ── TLS CERTIFICATE DECODER ──

function CertField({ label, value, mono = true }: { label: string, value: string, mono?: boolean }) {
  return (
    <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

function CertDecoderTool() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<typeof decodeCertificate>> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function decode() {
    if (!input.trim()) return
    setBusy(true)
    try {
      setResult(await decodeCertificate(input))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? errMessage(e) : 'Could not parse this as a PEM certificate.')
      setResult(null)
    }
    setBusy(false)
  }

  function clearAll() {
    setInput(''); setResult(null); setError('')
  }

  return (
    <div className="devtools-body">
      <div className="devtools-pane">
        <div className="devtools-pane-label-row">
          <label className="devtools-pane-label">PEM certificate</label>
          {input && <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>}
        </div>
        <textarea
          className="input devtools-textarea"
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
          style={{ minHeight: 220 }}
          spellCheck={false}
        />
      </div>

      <button className="btn btn-primary" onClick={decode} disabled={busy || !input.trim()} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Decoding…' : 'Decode Certificate'}
      </button>

      {error && <div className="devtools-error"><AlertCircle size={16} /> {error}</div>}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result.otherCertsInInput > 0 && (
            <div className="devtools-error" style={{ background: 'var(--bg-app)', color: 'var(--text-secondary)' }}>
              <AlertCircle size={14} /> Input contains {result.otherCertsInInput + 1} certificates — showing the first one only.
            </div>
          )}

          <div style={{
            padding: '12px 16px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 700,
            background: result.isExpired ? 'rgba(201, 25, 11, 0.1)' : 'rgba(62, 134, 53, 0.1)',
            color: result.isExpired ? 'var(--danger)' : 'var(--success)',
          }}>
            <ShieldCheck size={16} />
            {result.isExpired
              ? `Expired ${Math.abs(result.daysRemaining ?? 0)} days ago`
              : `Valid — expires in ${result.daysRemaining} days`}
          </div>

          <div className="grid-2-col" style={{ gap: 12 }}>
            <CertField label="Subject" value={result.subject || '(empty)'} mono={false} />
            <CertField label="Issuer" value={result.issuer || '(empty)'} mono={false} />
            <CertField label="Not Before" value={result.notBefore?.toUTCString() || 'unknown'} />
            <CertField label="Not After" value={result.notAfter?.toUTCString() || 'unknown'} />
            <CertField label="Serial Number" value={result.serialNumber} />
            <CertField label="Version" value={`v${result.version}`} />
            <CertField label="Signature Algorithm" value={result.signatureAlgorithm} />
            <CertField
              label="Public Key"
              value={result.publicKeyCurve ? `${result.publicKeyAlgorithm} (${result.publicKeyCurve})` : result.publicKeyBits ? `${result.publicKeyAlgorithm} ${result.publicKeyBits}-bit` : result.publicKeyAlgorithm}
            />
            <CertField label="CA Certificate" value={result.isCA ? 'Yes' : 'No'} />
          </div>

          <div>
            <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 8 }}>Subject Alternative Names</label>
            {result.sans.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.sans.map((s, i) => (
                  <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                    {s.type}:{s.value}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>None</span>
            )}
          </div>

          <div className="grid-2-col" style={{ gap: 12 }}>
            <CertField label="SHA-256 Fingerprint" value={result.fingerprintSha256} />
            <CertField label="SHA-1 Fingerprint" value={result.fingerprintSha1} />
          </div>
        </div>
      )}

      {!result && !error && <EmptyState icon={ShieldCheck} title="Certificate details will appear here" />}
    </div>
  )
}

// ── K8S RESOURCE UNITS ──

function parseCpuQuantity(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)(m)?$/)
  if (!m) return null
  const value = parseFloat(m[1])
  return m[2] === 'm' ? value / 1000 : value
}

const MEMORY_MULTIPLIERS: Record<string, number> = {
  Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60,
  k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
}

function parseMemoryQuantity(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/)
  if (!m) return null
  const value = parseFloat(m[1])
  return m[2] ? value * MEMORY_MULTIPLIERS[m[2]] : value
}

function formatNumber(n: number): string {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 4 : 8
  return parseFloat(n.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits })
}

function ResourceUnitsTool() {
  const [cpuInput, setCpuInput] = useState('500m')
  const [memInput, setMemInput] = useState('256Mi')

  const cores = parseCpuQuantity(cpuInput)
  const bytes = parseMemoryQuantity(memInput)

  return (
    <div className="devtools-body" style={{ gap: 28 }}>
      <div>
        <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 10 }}>CPU (bare cores or millicores, e.g. 0.5 or 500m)</label>
        <input
          className="input"
          value={cpuInput}
          onChange={e => setCpuInput(e.target.value)}
          style={{ fontSize: 18, fontFamily: 'var(--font-mono)', height: 48, padding: '0 16px', marginBottom: 16, maxWidth: 320 }}
          spellCheck={false}
        />
        {cores !== null ? (
          <div className="grid-2-col" style={{ gap: 16 }}>
            <ResultBox label="Cores" value={formatNumber(cores)} />
            <ResultBox label="Millicores" value={`${formatNumber(cores * 1000)}m`} />
            <ResultBox label="Microcores" value={`${formatNumber(cores * 1e6)}u`} />
            <ResultBox label="Nanocores" value={`${formatNumber(cores * 1e9)}n`} />
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--danger)' }}>Enter a bare number (cores) or a number with an "m" suffix (millicores).</span>
        )}
      </div>

      <div>
        <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 10 }}>Memory (Ki/Mi/Gi/Ti binary or k/M/G/T decimal, e.g. 256Mi)</label>
        <input
          className="input"
          value={memInput}
          onChange={e => setMemInput(e.target.value)}
          style={{ fontSize: 18, fontFamily: 'var(--font-mono)', height: 48, padding: '0 16px', marginBottom: 16, maxWidth: 320 }}
          spellCheck={false}
        />
        {bytes !== null ? (
          <div className="grid-2-col" style={{ gap: 16 }}>
            <ResultBox label="Bytes" value={formatNumber(bytes)} />
            <ResultBox label="Ki / Mi / Gi / Ti" value={`${formatNumber(bytes / 2 ** 10)}Ki  ·  ${formatNumber(bytes / 2 ** 20)}Mi  ·  ${formatNumber(bytes / 2 ** 30)}Gi  ·  ${formatNumber(bytes / 2 ** 40)}Ti`} />
            <ResultBox label="k / M / G / T (decimal)" value={`${formatNumber(bytes / 1e3)}k  ·  ${formatNumber(bytes / 1e6)}M  ·  ${formatNumber(bytes / 1e9)}G  ·  ${formatNumber(bytes / 1e12)}T`} />
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--danger)' }}>Enter a bare number (bytes) or a number with a valid k8s memory suffix.</span>
        )}
      </div>
    </div>
  )
}

// ── CIDR CALCULATOR ──

function CidrCalculatorTool() {
  const [input, setInput] = useState('10.0.0.0/24')
  const calc = calculateCidr(input)

  return (
    <div className="devtools-body">
      <div className="card" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
        <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 12 }}>IPv4 CIDR block</label>
        <input
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="10.0.0.0/24"
          style={{ fontSize: 20, fontFamily: 'var(--font-mono)', height: 52, padding: '0 18px' }}
          spellCheck={false}
        />
      </div>

      {calc.ok ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click a result to copy it</span>
          <div className="grid-2-col" style={{ gap: 16 }}>
            <ResultBox label="Network Address" value={calc.result.networkAddress} />
            <ResultBox label="Broadcast Address" value={calc.result.broadcastAddress} />
            <ResultBox label="Netmask" value={calc.result.netmask} />
            <ResultBox label="Wildcard Mask" value={calc.result.wildcardMask} />
            <ResultBox label="First Usable Host" value={calc.result.firstUsable} />
            <ResultBox label="Last Usable Host" value={calc.result.lastUsable} />
            <ResultBox label="Total Addresses" value={calc.result.totalAddresses.toLocaleString()} />
            <ResultBox label="Usable Hosts" value={calc.result.usableHosts.toLocaleString()} />
            <ResultBox label="IP Class" value={calc.result.ipClass} />
            <ResultBox label="Previous Subnet" value={calc.result.previousSubnet} />
            <ResultBox label="Next Subnet" value={calc.result.nextSubnet} />
          </div>
        </div>
      ) : (
        <div className="devtools-error"><AlertCircle size={16} /> {calc.error}</div>
      )}
    </div>
  )
}

// ── UUID / SECRET GENERATOR ──

const SECRET_CHARSETS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  'alphanumeric+symbols': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+',
  hex: '0123456789abcdef',
} as const

function generateSecret(length: number, charset: string): string {
  const max = 256 - (256 % charset.length)
  let result = ''
  const buf = new Uint8Array(1)
  while (result.length < length) {
    crypto.getRandomValues(buf)
    if (buf[0] < max) result += charset[buf[0] % charset.length]
  }
  return result
}

function UuidGeneratorTool() {
  const [count, setCount] = useState(5)
  const [uuids, setUuids] = useState<string[]>(() => Array.from({ length: 5 }, () => crypto.randomUUID()))
  const [copiedAll, setCopiedAll] = useState(false)

  const [secretLength, setSecretLength] = useState(32)
  const [charsetKey, setCharsetKey] = useState<keyof typeof SECRET_CHARSETS>('alphanumeric')
  const [secret, setSecret] = useState(() => generateSecret(32, SECRET_CHARSETS.alphanumeric))

  function regenUuids() {
    setUuids(Array.from({ length: Math.max(1, Math.min(50, count)) }, () => crypto.randomUUID()))
  }

  function copyAll() {
    navigator.clipboard.writeText(uuids.join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  function regenSecret() {
    setSecret(generateSecret(Math.max(4, Math.min(256, secretLength)), SECRET_CHARSETS[charsetKey]))
  }

  return (
    <div className="devtools-body" style={{ gap: 28 }}>
      <div>
        <div className="devtools-toolbar" style={{ marginBottom: 12 }}>
          <label className="devtools-pane-label">UUIDv4</label>
          <div className="devtools-toolbar-spacer">
            <input
              className="input" type="number" min={1} max={50} value={count}
              onChange={e => setCount(Number(e.target.value))}
              style={{ width: 70, height: 32, fontSize: 13, padding: '0 10px' }}
            />
            <button className="btn btn-secondary btn-sm" onClick={regenUuids}>Generate</button>
            <button className="btn btn-secondary btn-sm" onClick={copyAll}>
              {copiedAll ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
              <span style={{ marginLeft: 6 }}>{copiedAll ? 'Copied' : 'Copy All'}</span>
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {uuids.map((u, i) => <ResultBox key={i} label={`#${i + 1}`} value={u} />)}
        </div>
      </div>

      <div>
        <div className="devtools-toolbar" style={{ marginBottom: 12 }}>
          <label className="devtools-pane-label">Random Secret</label>
          <div className="devtools-toolbar-spacer">
            <input
              className="input" type="number" min={4} max={256} value={secretLength}
              onChange={e => setSecretLength(Number(e.target.value))}
              style={{ width: 70, height: 32, fontSize: 13, padding: '0 10px' }}
            />
            <select
              className="input"
              value={charsetKey}
              onChange={e => setCharsetKey(e.target.value as keyof typeof SECRET_CHARSETS)}
              style={{ height: 32, fontSize: 13, width: 190 }}
            >
              <option value="alphanumeric">Alphanumeric</option>
              <option value="alphanumeric+symbols">Alphanumeric + symbols</option>
              <option value="hex">Hex</option>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={regenSecret}>Generate</button>
          </div>
        </div>
        <ResultBox label={`${secret.length} characters — click to copy`} value={secret} />
      </div>
    </div>
  )
}

// ── DIFF CHECKER ──

function DiffCheckerTool() {
  const [original, setOriginal] = useState('')
  const [modified, setModified] = useState('')
  const [result, setResult] = useState<ReturnType<typeof computeDiff> | null>(null)

  function compare() {
    setResult(computeDiff(original, modified))
  }

  function clearAll() {
    setOriginal(''); setModified(''); setResult(null)
  }

  return (
    <div className="devtools-body">
      <div className="devtools-toolbar">
        <button className="btn btn-primary" onClick={compare} disabled={!original && !modified}>Compare</button>
        <div className="devtools-toolbar-spacer">
          {result && !result.error && <StatBadge>+{result.additions} / -{result.removals}</StatBadge>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll} title="Clear"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="devtools-split">
        <div className="devtools-pane">
          <label className="devtools-pane-label">Original</label>
          <textarea className="input devtools-textarea" value={original} onChange={e => setOriginal(e.target.value)} placeholder="Paste the original text..." spellCheck={false} style={{ minHeight: 280 }} />
        </div>
        <div className="devtools-pane">
          <label className="devtools-pane-label">Modified</label>
          <textarea className="input devtools-textarea" value={modified} onChange={e => setModified(e.target.value)} placeholder="Paste the modified text..." spellCheck={false} style={{ minHeight: 280 }} />
        </div>
      </div>

      {result?.error && <div className="devtools-error"><AlertCircle size={16} /> {result.error}</div>}

      {result && !result.error && (
        <div>
          <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 8 }}>Diff</label>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'auto', maxHeight: 480, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {result.lines.map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', gap: 12, padding: '2px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  background: l.type === 'add' ? 'rgba(62, 134, 53, 0.12)' : l.type === 'remove' ? 'rgba(201, 25, 11, 0.12)' : 'transparent',
                  color: l.type === 'add' ? 'var(--success)' : l.type === 'remove' ? 'var(--danger)' : 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--text-muted)', userSelect: 'none', flexShrink: 0, width: 60 }}>
                  {l.oldLine ?? ''}{l.oldLine && l.newLine ? '·' : ''}{l.newLine ?? ''}
                </span>
                <span style={{ flexShrink: 0, userSelect: 'none' }}>{l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' '}</span>
                <span>{l.text || ' '}</span>
              </div>
            ))}
            {result.lines.length === 0 && (
              <div style={{ padding: 16, color: 'var(--text-muted)' }}>No differences</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── DOCKER IMAGE REFERENCE PARSER ──

interface ParsedImageRef {
  registry: string
  repository: string
  tag: string | null
  digest: string | null
}

function parseImageReference(ref: string): ParsedImageRef | null {
  let rest = ref.trim()
  if (!rest) return null

  let digest: string | null = null
  const atIdx = rest.indexOf('@')
  if (atIdx !== -1) {
    digest = rest.slice(atIdx + 1)
    rest = rest.slice(0, atIdx)
  }

  let tag: string | null = null
  const lastColon = rest.lastIndexOf(':')
  const lastSlash = rest.lastIndexOf('/')
  if (lastColon > lastSlash) {
    tag = rest.slice(lastColon + 1)
    rest = rest.slice(0, lastColon)
  }

  let registry = 'docker.io'
  let repository = rest
  const firstSlash = rest.indexOf('/')
  if (firstSlash !== -1) {
    const firstSegment = rest.slice(0, firstSlash)
    if (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost') {
      registry = firstSegment
      repository = rest.slice(firstSlash + 1)
    }
  }
  if (registry === 'docker.io' && !repository.includes('/')) {
    repository = `library/${repository}`
  }

  if (!tag && !digest) tag = 'latest'
  if (!repository) return null

  return { registry, repository, tag, digest }
}

function DockerImageParserTool() {
  const [input, setInput] = useState('nginx:1.27-alpine')
  const parsed = parseImageReference(input)

  return (
    <div className="devtools-body">
      <div className="card" style={{ background: 'var(--bg-app)', border: '1px solid var(--border)' }}>
        <label className="devtools-pane-label" style={{ display: 'block', marginBottom: 12 }}>Image reference</label>
        <input
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="ghcr.io/org/app:v1.2.3  or  nginx@sha256:..."
          style={{ fontSize: 16, fontFamily: 'var(--font-mono)', height: 48, padding: '0 16px' }}
          spellCheck={false}
        />
      </div>

      {parsed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid-2-col" style={{ gap: 16 }}>
            <ResultBox label="Registry" value={parsed.registry} />
            <ResultBox label="Repository" value={parsed.repository} />
            <ResultBox label="Tag" value={parsed.tag || '(none — pinned by digest)'} />
            <ResultBox label="Digest" value={parsed.digest || '(none)'} />
          </div>
          {parsed.registry === 'docker.io' && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Docker Hub images with no namespace get the implicit "library/" prefix.</span>
          )}
        </div>
      ) : (
        <EmptyState icon={Container} title="Parsed image reference will appear here" />
      )}
    </div>
  )
}
