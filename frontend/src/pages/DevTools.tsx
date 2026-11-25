import { useState, useEffect } from 'react'
import yaml from 'js-yaml'
import {
  KeySquare, KeyRound, Clock, ArrowRightLeft, CalendarClock,
  FileJson, Braces, Hash, Copy, Check, AlertCircle, Trash2, Eraser, Route,
  Network, ShieldCheck, Cpu, GitCompare, Fingerprint, Container, FileCode2, Download,
  Split as SplitIcon, Layers, Globe, Radar, ListTree, Fingerprint as FingerprintIcon, type LucideIcon
} from 'lucide-react'
import { cleanManifest, DEFAULT_CLEAN_OPTIONS, type CleanOptions, type CleanResult } from '../utils/k8sManifestCleaner'
import { convertIngressToGateway } from '../utils/ingressToGateway'
import { calculateCidr } from '../utils/cidrCalculator'
import { splitCidr, type SplitMode } from '../utils/subnetSplitter'
import { analyzeCidrs } from '../utils/cidrMatch'
import { analyzeIpv6 } from '../utils/ipv6'
import { lookupDns, DNS_RECORD_TYPES, DOH_RESOLVER, type DnsRecordType, type DnsLookupResult } from '../utils/dnsLookup'
import { decodeCertificate } from '../utils/certDecoder'
import { analyzeCertChain, type ChainResult, type CertRole } from '../utils/certChain'
import { inspectSshKeys, type SshKeyResult } from '../utils/sshKey'
import { parseCron } from '../utils/cronParser'
import { computeDiff } from '../utils/textDiff'
import { evaluateJsonnet } from '../utils/jsonnetEvaluator'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import ButtonBase from '@mui/material/ButtonBase'
import Radio from '@mui/material/Radio'
import Typography from '@mui/material/Typography'
import { useTheme, type Theme } from '@mui/material/styles'
import { SectionHeader, EmptyState, TabSwitcher, PageHeader, Button } from '../components/ui'
import {
  ToolBody, Toolbar, ToolbarSpacer, ErrorBanner, Pane, PaneLabel, PaneLabelRow, SplitPane, ResultGrid, ToolCard,
  ToolTextarea, ToolInput, IconAction, StatBadge, ToolChip, OptionGroup, OptionRow, OptionRowLabel, OptionLabel,
  OptionCheckbox, CopyIcon, ToolSelect, DocCard, DocTitle, NamespaceBar, TableWrap, DevTable,
} from './devtools/parts'
import { errMessage } from '../utils/errors'

type ToolId =
  | 'json' | 'base64' | 'yaml-json' | 'hash'
  | 'epoch' | 'cron'
  | 'jwt' | 'jwt-encode' | 'cert-decode' | 'cert-chain' | 'ssh-key'
  | 'k8s-clean' | 'ingress2gateway' | 'k8s-units' | 'jsonnet'
  | 'cidr' | 'subnet-split' | 'cidr-match' | 'ipv6' | 'dns'
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
  { id: 'cert-chain', label: 'Certificate Chain Inspector', subtitle: 'Check a PEM bundle the way a TLS server loads it — order, missing intermediates, expiry.', icon: ListTree, color: 'var(--danger)', group: 'Security' },
  { id: 'ssh-key', label: 'SSH Key Inspector', subtitle: 'Fingerprints and key strength for a public key or a whole authorized_keys file.', icon: FingerprintIcon, color: 'var(--warning)', group: 'Security' },
  { id: 'k8s-clean', label: 'K8s Manifest Cleaner', subtitle: 'Strip server-generated fields from a live manifest so it can be re-applied to any cluster.', icon: Eraser, color: 'var(--success)', group: 'Kubernetes' },
  { id: 'ingress2gateway', label: 'Ingress → Gateway API', subtitle: 'Convert an Ingress into a Gateway and HTTPRoute (Gateway API). Best-effort — review annotation-driven behavior manually.', icon: Route, color: 'var(--accent-purple)', group: 'Kubernetes' },
  { id: 'k8s-units', label: 'Resource Units', subtitle: 'Convert CPU (millicores/cores) and memory (Ki/Mi/Gi/Ti, decimal/binary) quantities.', icon: Cpu, color: 'var(--success)', group: 'Kubernetes' },
  { id: 'jsonnet', label: 'Jsonnet Evaluator', subtitle: 'Evaluate Jsonnet — the language Tanka (grafana.com/oss/tanka) uses for Kubernetes config — into JSON or YAML.', icon: FileCode2, color: 'var(--accent-cyan)', group: 'Kubernetes' },
  { id: 'cidr', label: 'CIDR Calculator', subtitle: 'Network/broadcast address, usable host range, and netmask for a CIDR block.', icon: Network, color: 'var(--accent-cyan)', group: 'Networking' },
  { id: 'subnet-split', label: 'Subnet Splitter', subtitle: 'Carve an IPv4 block into equal subnets — by target prefix, or by how many subnets you need.', icon: SplitIcon, color: 'var(--accent-cyan)', group: 'Networking' },
  { id: 'cidr-match', label: 'CIDR Overlap & Match', subtitle: 'Test addresses against a list of CIDRs and flag blocks that collide — for debugging security groups, NetworkPolicy, and peering.', icon: Layers, color: 'var(--info)', group: 'Networking' },
  { id: 'ipv6', label: 'IPv6 Toolkit', subtitle: 'Expand/compress an IPv6 address, plus prefix range, address type, and PTR name.', icon: Globe, color: 'var(--accent-purple)', group: 'Networking' },
  { id: 'dns', label: 'DNS Lookup', subtitle: 'Resolve A/AAAA/CNAME/MX/TXT and more over DNS-over-HTTPS. Sends the queried name to an external resolver.', icon: Radar, color: 'var(--warning)', group: 'Networking' },
  { id: 'uuid', label: 'UUID / Secret Generator', subtitle: 'Generate UUIDv4s or cryptographically random secrets.', icon: Fingerprint, color: 'var(--accent-purple)', group: 'Utilities' },
  { id: 'diff', label: 'Diff Checker', subtitle: 'Compare two blocks of text line by line.', icon: GitCompare, color: 'var(--accent-pink)', group: 'Utilities' },
  { id: 'docker-image', label: 'Image Reference Parser', subtitle: 'Break a container image reference into registry, repository, tag, and digest.', icon: Container, color: 'var(--accent-lime)', group: 'Utilities' },
]

export function DevTools() {
  const [activeTab, setActiveTab] = useState<ToolId>('json')
  const activeTool = TOOLS.find(t => t.id === activeTab)!
  const activeGroup = activeTool.group
  const theme = useTheme()

  function selectGroup(g: Category) {
    const first = TOOLS.find(t => t.group === g)
    if (first) setActiveTab(first.id)
  }

  return (
    <div className="page">
      <PageHeader title="Developer Tools" subtitle="Client-side utilities for DevOps, systems configuration, and debugging." />

      <Box sx={{ mb: 1, flexShrink: 0 }}>
        <TabSwitcher
          tabs={CATEGORIES.map(g => ({ id: g, label: g }))}
          active={activeGroup}
          onChange={id => selectGroup(id as Category)}
        />
      </Box>

      <Box sx={{ mb: 2.5, flexShrink: 0 }}>
        <TabSwitcher
          tabs={TOOLS.filter(t => t.group === activeGroup).map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
          active={activeTab}
          onChange={id => setActiveTab(id as ToolId)}
        />
      </Box>

      <Card variant="outlined" sx={{ overflow: 'hidden', flexShrink: 0 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <SectionHeader
            icon={activeTool.icon}
            iconColor={toolColor(activeTool.color, theme)}
            title={activeTool.label}
            subtitle={activeTool.subtitle}
          />
        </Box>
        {activeTab === 'json' && <JsonFormatterTool />}
        {activeTab === 'base64' && <Base64Tool />}
        {activeTab === 'yaml-json' && <YamlJsonTool />}
        {activeTab === 'hash' && <HashGeneratorTool />}
        {activeTab === 'epoch' && <EpochConverterTool />}
        {activeTab === 'cron' && <CronParserTool />}
        {activeTab === 'jwt' && <JwtDecoderTool />}
        {activeTab === 'jwt-encode' && <JwtEncoderTool />}
        {activeTab === 'cert-decode' && <CertDecoderTool />}
        {activeTab === 'cert-chain' && <CertChainTool />}
        {activeTab === 'ssh-key' && <SshKeyTool />}
        {activeTab === 'k8s-clean' && <K8sManifestCleanerTool />}
        {activeTab === 'ingress2gateway' && <Ingress2GatewayTool />}
        {activeTab === 'k8s-units' && <ResourceUnitsTool />}
        {activeTab === 'jsonnet' && <JsonnetEvaluatorTool />}
        {activeTab === 'cidr' && <CidrCalculatorTool />}
        {activeTab === 'subnet-split' && <SubnetSplitterTool />}
        {activeTab === 'cidr-match' && <CidrMatchTool />}
        {activeTab === 'ipv6' && <Ipv6Tool />}
        {activeTab === 'dns' && <DnsLookupTool />}
        {activeTab === 'uuid' && <UuidGeneratorTool />}
        {activeTab === 'diff' && <DiffCheckerTool />}
        {activeTab === 'docker-image' && <DockerImageParserTool />}
      </Card>
    </div>
  )
}

/** Map the legacy CSS-variable tool colours onto theme palette colours. */
function toolColor(v: string, theme: Theme): string {
  const p = theme.palette
  if (v.includes('danger')) return p.error.main
  if (v.includes('warning')) return p.warning.main
  if (v.includes('success')) return p.success.main
  if (v.includes('info') || v.includes('cyan')) return p.info.main
  if (v.includes('purple') || v.includes('pink') || v.includes('lime')) return p.secondary.main
  return p.primary.main
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
    <ToolBody>
      <Toolbar>
        <Button onClick={minify} variant="secondary">Minify</Button>
        <Button onClick={format} variant="primary">Format</Button>
        <ToolbarSpacer>
          {input && <StatBadge>{input.length} chars &middot; {lines} lines</StatBadge>}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {error && (
        <ErrorBanner><AlertCircle size={16} /> {error}</ErrorBanner>
      )}

      <SplitPane>
        <Pane>
          <PaneLabel>Input</PaneLabel>
          <ToolTextarea
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            onKeyDown={onKeyDown}
            placeholder='Paste JSON here... e.g. {"name": "infra-eye"}  ·  Ctrl/Cmd + Enter to format'
            spellCheck={false}
          />
        </Pane>

        <Pane>
          <PaneLabelRow>
            <PaneLabel>Output</PaneLabel>
            {output && (
              <Button onClick={copy} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy'}</Button>
            )}
          </PaneLabelRow>
          {output ? (
            <ToolTextarea
              value={output}
              readOnly
            />
          ) : (
            <EmptyState icon={FileJson} title="Formatted JSON will appear here" />
          )}
        </Pane>
      </SplitPane>
    </ToolBody>
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
    <ToolBody>
      <Toolbar>
        <Button onClick={encode} variant="primary">Encode</Button>
        <Button onClick={decode} variant="secondary">Decode</Button>
        <ToolbarSpacer>
          {input && <StatBadge>{input.length} chars</StatBadge>}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {error && <ErrorBanner><AlertCircle size={14} /> {error}</ErrorBanner>}

      <SplitPane>
        <Pane>
          <PaneLabel>Input</PaneLabel>
          <ToolTextarea
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Enter text or Base64 payload..."
          />
        </Pane>

        <Pane>
          <PaneLabelRow>
            <PaneLabel>Output</PaneLabel>
            {output && (
              <Button onClick={copy} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy'}</Button>
            )}
          </PaneLabelRow>
          {output ? (
            <ToolTextarea
              value={output}
              readOnly
            />
          ) : (
            <EmptyState icon={ArrowRightLeft} title="Encoded or decoded output will appear here" />
          )}
        </Pane>
      </SplitPane>
    </ToolBody>
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
    <ToolBody gap={24}>
      <ToolCard>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <PaneLabel>Enter timestamp</PaneLabel>
          <StatBadge>{isSeconds ? 'seconds' : 'milliseconds'}</StatBadge>
        </Box>
        <Box sx={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <ToolInput big
          aria-label="Timestamp"
            value={timestamp}
            onChange={e => setTimestamp(e.target.value)} />
          <Button onClick={() => setTimestamp(Date.now().toString())} variant="secondary">Now (ms)</Button>
          <Button onClick={() => setTimestamp(Math.floor(Date.now() / 1000).toString())} variant="secondary">Now (s)</Button>
        </Box>
      </ToolCard>

      {isValid ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>Click a result to copy it</Box>
          <ResultGrid gap={20}>
            <ResultBox label="Local Time" value={dateObj.toLocaleString()} />
            <ResultBox label="UTC Time" value={dateObj.toUTCString()} />
            <ResultBox label="ISO 8601" value={dateObj.toISOString()} />
            <ResultBox label="Relative" value={getRelativeTime(dateObj)} />
          </ResultGrid>
        </Box>
      ) : (
        <EmptyState icon={Clock} title="Enter a valid Unix timestamp" />
      )}
    </ToolBody>
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
    <ButtonBase
      onClick={copy}
      aria-label={`Copy ${label}`}
      sx={{
        display: 'block', width: '100%', textAlign: 'left', px: 2, py: 1.5, borderRadius: 1, border: 1, borderColor: 'divider',
        bgcolor: 'action.hover', '&:hover': { borderColor: 'primary.main' },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
        <CopyIcon copied={copied} size={13} />
      </Box>
      <Box sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{value}</Box>
    </ButtonBase>
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
    <ToolBody>
      <Pane>
        <PaneLabelRow>
          <PaneLabel>Token string</PaneLabel>
          {jwt && <IconAction label="Clear" onClick={() => setJwt('')}><Trash2 size={14} /></IconAction>}
        </PaneLabelRow>
        <ToolTextarea breakAll rows={6}
          value={jwt}
          onChange={e => setJwt(e.target.value)}
          placeholder="eyJhbGciOiJIUz... (paste your token here)"
        />
      </Pane>

      {error ? (
        <Box sx={{ padding: '16px', bgcolor: 'action.hover', color: 'error.main', borderRadius: 1, display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{error}</div>
        </Box>
      ) : jwt ? (
        <SplitPane>
          <Pane>
            <PaneLabelRow>
              <PaneLabel color="warning.main">Header</PaneLabel>
              <IconAction label="Copy header" onClick={() => copyBlock(header)}><Copy size={13} /></IconAction>
            </PaneLabelRow>
            <Box component="pre" sx={{ m: 0, p: 1.75, minHeight: 260, bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, color: 'warning.main', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto' }}>
              {header}
            </Box>
          </Pane>
          <Pane>
            <PaneLabelRow>
              <PaneLabel color="primary.main">Payload</PaneLabel>
              <IconAction label="Copy payload" onClick={() => copyBlock(payload)}><Copy size={13} /></IconAction>
            </PaneLabelRow>
            <Box component="pre" sx={{ m: 0, p: 1.75, minHeight: 260, bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, color: 'primary.main', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto' }}>
              {payload}
            </Box>
          </Pane>
        </SplitPane>
      ) : (
        <EmptyState icon={KeySquare} title="Paste a JWT to decode its header and payload" />
      )}
    </ToolBody>
  )
}

// ── CERTIFICATE CHAIN INSPECTOR ──

const CHAIN_ROLE_COLORS: Record<CertRole, string> = {
  leaf: 'success.main',
  intermediate: 'info.main',
  root: 'secondary.main',
}

function CertChainTool() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<ChainResult | null>(null)
  const [loading, setLoading] = useState(false)

  async function inspect() {
    if (!input.trim() || loading) return
    setLoading(true)
    setResult(await analyzeCertChain(input))
    setLoading(false)
  }

  function clearAll() {
    setInput('')
    setResult(null)
  }

  return (
    <ToolBody>
      <ErrorBanner neutral>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        Reads the bundle's structure — issuer/subject linkage, order, validity. It does not verify signatures, so it can show a chain is assembled correctly, not that it is authentic.
      </ErrorBanner>

      <Toolbar>
        <Button onClick={inspect} disabled={loading || !input.trim()} variant="primary">
          {loading ? 'Inspecting…' : 'Inspect Chain'}
        </Button>
        <ToolbarSpacer>
          {result && result.links.length > 0 && (
            <StatBadge>{result.links.length} certificate{result.links.length === 1 ? '' : 's'}</StatBadge>
          )}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {result?.error && <ErrorBanner><AlertCircle size={16} /> {result.error}</ErrorBanner>}

      {result && result.problems.map(p => (
        <ErrorBanner key={p}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} /> {p}
        </ErrorBanner>
      ))}

      {result && result.problems.length === 0 && result.links.length > 0 && (
        <ErrorBanner tone="success">
          <Check size={16} style={{ flexShrink: 0 }} />
          Chain is correctly ordered — every certificate is signed by the one after it.
        </ErrorBanner>
      )}

      {result && result.notes.map(n => (
        <ErrorBanner key={n} tone="warning">
          <AlertCircle size={16} style={{ flexShrink: 0 }} /> {n}
        </ErrorBanner>
      ))}

      <SplitPane>
        <Pane>
          <PaneLabel>PEM bundle</PaneLabel>
          <ToolTextarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={'Paste fullchain.pem / tls.crt — leaf first, then intermediates\n\n-----BEGIN CERTIFICATE-----\n...'}
            spellCheck={false}
          />
        </Pane>

        <Pane>
          <PaneLabel>Chain</PaneLabel>
          {result && result.links.length > 0 ? (
            <Box sx={{ display: 'grid', gap: '8px' }}>
              {result.links.map(link => (
                <DocCard key={link.index}>
                  <DocTitle>
                    <Box component="span" sx={{ color: 'text.secondary' }}>#{link.index + 1}</Box>
                    <Box component="span" sx={{ color: CHAIN_ROLE_COLORS[link.role], fontSize: 11 }}>{link.role}</Box>
                    <Box component="span" sx={{ wordBreak: 'break-all' }}>{link.cert.subject}</Box>
                  </DocTitle>
                  <Box sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'var(--font-mono)', marginTop: '6px', wordBreak: 'break-all' }}>
                    issued by {link.cert.issuer}
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {link.issues.map(i => <ToolChip key={i} tone="warn">! {i}</ToolChip>)}
                    {link.cert.notAfter && link.issues.length === 0 && (
                      <ToolChip tone="ok">valid to {link.cert.notAfter.toISOString().slice(0, 10)}</ToolChip>
                    )}
                    <ToolChip>
                      {link.cert.publicKeyAlgorithm}
                      {link.cert.publicKeyBits ? ` ${link.cert.publicKeyBits}` : ''}
                      {link.cert.publicKeyCurve ? ` ${link.cert.publicKeyCurve}` : ''}
                    </ToolChip>
                    {link.selfSigned && <ToolChip>self-signed</ToolChip>}
                    {link.issuedByNext === true && <ToolChip tone="ok">signed by #{link.index + 2}</ToolChip>}
                    {link.issuedByNext === false && <ToolChip tone="warn">! not signed by #{link.index + 2}</ToolChip>}
                    {link.cert.sans.slice(0, 6).map(s => (
                      <ToolChip key={`${s.type}:${s.value}`}>{s.type}:{s.value}</ToolChip>
                    ))}
                    {link.cert.sans.length > 6 && <ToolChip>+{link.cert.sans.length - 6} more SANs</ToolChip>}
                  </Box>
                </DocCard>
              ))}
            </Box>
          ) : (
            <EmptyState icon={ListTree} title="Paste a certificate bundle to inspect its chain" />
          )}
        </Pane>
      </SplitPane>
    </ToolBody>
  )
}

// ── SSH KEY INSPECTOR ──

function SshKeyTool() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<SshKeyResult | null>(null)

  async function inspect() {
    if (!input.trim()) return
    setResult(await inspectSshKeys(input))
  }

  function clearAll() {
    setInput('')
    setResult(null)
  }

  const good = result?.keys.filter(k => !k.error) ?? []
  const flagged = good.filter(k => k.warnings.length > 0).length
  const advised = good.filter(k => k.warnings.length === 0 && k.advisories.length > 0).length

  return (
    <ToolBody>
      <Toolbar>
        <Button onClick={inspect} disabled={!input.trim()} variant="primary">Inspect Keys</Button>
        <ToolbarSpacer>
          {good.length > 0 && <StatBadge>{good.length} key{good.length === 1 ? '' : 's'}</StatBadge>}
          {flagged > 0 && <StatBadge>{flagged} flagged</StatBadge>}
          {advised > 0 && <StatBadge>{advised} with advice</StatBadge>}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {result?.error && (
        <ErrorBanner>
          <AlertCircle size={16} style={{ flexShrink: 0 }} /> {result.error}
        </ErrorBanner>
      )}

      <Pane>
        <PaneLabel>Public key or authorized_keys file</PaneLabel>
        <ToolTextarea rows={8}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... deploy@bastion"
          spellCheck={false}
        />
      </Pane>

      {result && result.keys.length > 0 && (
        <Box sx={{ display: 'grid', gap: '8px' }}>
          {result.keys.map(key => (
            <DocCard key={key.line} dropped={!!key.error}>
              <DocTitle>
                <Box component="span" sx={{ color: 'text.secondary' }}>line {key.line}</Box>
                <Box component="span" sx={{ color: 'primary.main' }}>{key.type || '(unknown)'}</Box>
                {key.bits !== null && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>{key.bits} bits</Box>}
                {key.comment && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>{key.comment}</Box>}
              </DocTitle>

              {key.error ? (
                <Box sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                  {key.error}
                </Box>
              ) : (
                <>
                  <Box sx={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'text.secondary', marginTop: '8px', display: 'grid', gap: '3px', wordBreak: 'break-all' }}>
                    <div>{key.fingerprintSha256}</div>
                    <Box sx={{ color: 'text.secondary' }}>{key.fingerprintMd5}</Box>
                  </Box>
                  {(key.options || key.warnings.length > 0 || key.advisories.length > 0) && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                      {key.warnings.map(w => <ToolChip key={w} tone="warn">! {w}</ToolChip>)}
                      {key.advisories.map(a => <ToolChip key={a} tone="edit">~ {a}</ToolChip>)}
                      {key.options && <ToolChip>{key.options}</ToolChip>}
                    </Box>
                  )}
                </>
              )}
            </DocCard>
          ))}
        </Box>
      )}

      {!result && <EmptyState icon={KeyRound} title="Paste a public key to see its fingerprints" />}
    </ToolBody>
  )
}

// ── K8S MANIFEST CLEANER ──

const ALWAYS_STRIPPED_FIELDS = [
  'status', 'metadata.uid', 'resourceVersion', 'creationTimestamp', 'generation',
  'managedFields', 'selfLink', 'ownerReferences', 'deletionTimestamp',
  'nested creationTimestamp', 'cluster-managed annotations',
]

function CleanerOption({ checked, onChange, children }: {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return <OptionCheckbox checked={checked} onChange={onChange}>{children}</OptionCheckbox>
}

function K8sManifestCleanerTool() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<CleanResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [options, setOptions] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS)

  function set<K extends keyof CleanOptions>(key: K, value: CleanOptions[K]) {
    setOptions(o => ({ ...o, [key]: value }))
  }

  function clean() {
    if (!input.trim()) return
    const res = cleanManifest(input, options)
    if (res.error) {
      setError(res.error)
      setResult(null)
      return
    }
    setError('')
    setResult(res)
  }

  function copy() {
    if (!result?.output) return
    navigator.clipboard.writeText(result.output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function download() {
    if (!result?.output) return
    const blob = new Blob([result.output], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'clean-manifests.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  function clearAll() {
    setInput('')
    setResult(null)
    setError('')
  }

  const summary: string[] = []
  if (result) {
    summary.push(`${result.documentCount} document${result.documentCount === 1 ? '' : 's'}`)
    if (result.generatedNamespaceCount) summary.push(`${result.generatedNamespaceCount} Namespace manifest${result.generatedNamespaceCount === 1 ? '' : 's'} generated`)
    if (result.scaledCount) summary.push(`${result.scaledCount} workload${result.scaledCount === 1 ? '' : 's'} scaled to 0`)
    if (result.stampedCount) summary.push(`${result.stampedCount} stamped with namespace "${options.defaultNamespace.trim()}"`)
    if (result.droppedCount) summary.push(`${result.droppedCount} object${result.droppedCount === 1 ? '' : 's'} dropped`)
  }

  return (
    <ToolBody>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <PaneLabel>Always stripped</PaneLabel>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {ALWAYS_STRIPPED_FIELDS.map(field => (
            <ToolChip key={field}>{field}</ToolChip>
          ))}
        </Box>
      </Box>

      <OptionGroup>
        <OptionRow>
          <OptionRowLabel>Strip fields</OptionRowLabel>
          <CleanerOption checked={options.stripLastApplied} onChange={v => set('stripLastApplied', v)}>
            <code>last-applied-configuration</code>
          </CleanerOption>
          <CleanerOption checked={options.stripFinalizers} onChange={v => set('stripFinalizers', v)}>
            cluster-managed <code>finalizers</code>
          </CleanerOption>
          <CleanerOption checked={options.stripBindingInfo} onChange={v => set('stripBindingInfo', v)}>
            binding info (Service <code>clusterIP</code>/<code>ipFamilies</code>, PVC <code>volumeName</code>, Pod <code>nodeName</code>)
          </CleanerOption>
          <CleanerOption checked={options.stripNodePorts} onChange={v => set('stripNodePorts', v)}>
            Service <code>nodePort</code>s
          </CleanerOption>
          <CleanerOption checked={options.stripNamespace} onChange={v => set('stripNamespace', v)}>
            <code>metadata.namespace</code> (apply into any namespace)
          </CleanerOption>
        </OptionRow>

        <OptionRow>
          <OptionRowLabel>Drop objects</OptionRowLabel>
          <CleanerOption checked={options.dropPods} onChange={v => set('dropPods', v)}>
            Pods (their controller recreates them)
          </CleanerOption>
          <CleanerOption checked={options.dropGenerated} onChange={v => set('dropGenerated', v)}>
            other generated objects (ReplicaSets, CronJob Jobs, Endpoints, Events, SA-token Secrets)
          </CleanerOption>
          <CleanerOption checked={options.dropSystemNamespaces} onChange={v => set('dropSystemNamespaces', v)}>
            <code>kube-system</code> / <code>kube-public</code> / <code>kube-node-lease</code>
          </CleanerOption>
        </OptionRow>

        <OptionRow>
          <OptionRowLabel>Ingress</OptionRowLabel>
          <CleanerOption checked={options.fixIngress} onChange={v => set('fixIngress', v)}>
            fix for newer ingress-nginx (regex paths → <code>ImplementationSpecific</code>, <code>ingress.class</code> → <code>ingressClassName</code>)
          </CleanerOption>
          <CleanerOption checked={options.stripIngressSnippets} onChange={v => set('stripIngressSnippets', v)}>
            strip <code>*-snippet</code> annotations (changes behavior)
          </CleanerOption>
        </OptionRow>

        <OptionRow>
          <OptionRowLabel>Migration</OptionRowLabel>
          <CleanerOption checked={options.scaleToZero} onChange={v => set('scaleToZero', v)}>
            scale workloads to <code>0</code> replicas
          </CleanerOption>
          <CleanerOption checked={options.emitNamespaces} onChange={v => set('emitNamespaces', v)}>
            generate Namespace manifests first
          </CleanerOption>
          <OptionLabel>
            stamp namespace when missing:
            <ToolInput mono width={180}
          aria-label="Default namespace"
              type="text"
              value={options.defaultNamespace}
              onChange={e => set('defaultNamespace', e.target.value)}
              placeholder="e.g. payments-prod"
              spellCheck={false} />
          </OptionLabel>
        </OptionRow>
      </OptionGroup>

      <Toolbar>
        <Button onClick={clean} variant="primary">Clean Manifest</Button>
        <ToolbarSpacer>
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          {result?.output && (
            <Button onClick={download} title="Download .yaml" size="sm" variant="secondary" icon={<Download size={14} />}>Download</Button>
          )}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {error && (
        <ErrorBanner><AlertCircle size={16} /> {error}</ErrorBanner>
      )}

      {result && summary.length > 0 && (
        <Box sx={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'text.secondary' }}>
          {summary.join(' · ')}
        </Box>
      )}

      {result && result.missingNamespaceCount > 0 && (
        <ErrorBanner>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          {result.missingNamespaceCount} namespaced resource{result.missingNamespaceCount === 1 ? '' : 's'} carr
          {result.missingNamespaceCount === 1 ? 'ies' : 'y'} no namespace — <code>kubectl apply</code> will send
          {result.missingNamespaceCount === 1 ? ' it' : ' them'} to whatever namespace your current context points at.
          Fill in “stamp namespace when missing” and clean again.
        </ErrorBanner>
      )}

      {result && result.namespaces.length > 0 && (
        <NamespaceBar>
          <PaneLabel>Namespaces referenced</PaneLabel>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0' }}>
            {result.namespaces.map(ns => <ToolChip key={ns}>{ns}</ToolChip>)}
          </Box>
          <Box sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'var(--font-mono)' }}>
            {result.generatedNamespaceCount > 0
              ? 'Namespace manifests are prepended to the output, so a single kubectl apply -f works.'
              : `Create them first: ${result.namespaces.map(ns => `kubectl create namespace ${ns}`).join(' && ')}`}
          </Box>
        </NamespaceBar>
      )}

      <SplitPane>
        <Pane>
          <PaneLabel>Input manifest</PaneLabel>
          <ToolTextarea
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Paste kubectl get -o yaml output here — multi-document (---) and kind: List both work..."
            spellCheck={false}
          />
        </Pane>

        <Pane>
          <PaneLabelRow>
            <PaneLabel>
              Cleaned output {result?.output && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>&nbsp;({result.documentCount} document{result.documentCount === 1 ? '' : 's'})</Box>}
            </PaneLabel>
            {result?.output && (
              <Button onClick={copy} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy Output'}</Button>
            )}
          </PaneLabelRow>
          {result?.output ? (
            <ToolTextarea
              value={result.output}
              readOnly
            />
          ) : (
            <EmptyState icon={Eraser} title="Cleaned manifest will appear here" />
          )}
        </Pane>
      </SplitPane>

      {result && result.documents.length > 0 && (
        <div>
          <PaneLabel block>
            Per-document ledger
          </PaneLabel>
          <Box sx={{ display: 'grid', gap: '8px' }}>
            {result.documents.map((doc, i) => (
              <DocCard key={`${doc.kind}/${doc.namespace}/${doc.name}/${i}`} dropped={!!doc.dropped}>
                <DocTitle>
                  <Box component="span" sx={{ color: 'primary.main' }}>{doc.kind}</Box>
                  <Box component="span" sx={{ color: 'text.secondary' }}>/</Box>
                  <span>{doc.name}</span>
                  {doc.namespace && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>· ns: {doc.namespace}</Box>}
                </DocTitle>
                {doc.dropped ? (
                  <Box sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                    dropped — {doc.dropped}
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {doc.warnings.map(w => <ToolChip key={w} tone="warn">! {w}</ToolChip>)}
                    {doc.edited.map(e => <ToolChip key={e} tone="edit">~ {e}</ToolChip>)}
                    {doc.removed.map(r => <ToolChip key={r}>− {r}</ToolChip>)}
                    {doc.warnings.length === 0 && doc.edited.length === 0 && doc.removed.length === 0 && (
                      <ToolChip tone="ok">already clean</ToolChip>
                    )}
                  </Box>
                )}
              </DocCard>
            ))}
          </Box>
        </div>
      )}
    </ToolBody>
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
    <ToolBody>
      <ErrorBanner neutral>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        Best-effort mapping (hosts, paths, backends, TLS) — annotation-driven behavior like nginx rewrite-target or canary weighting has no Gateway API equivalent and is called out below instead of guessed at.
      </ErrorBanner>

      <Toolbar>
        <Button onClick={convert} variant="primary">Convert</Button>
        <ToolbarSpacer>
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {error && (
        <ErrorBanner><AlertCircle size={16} /> {error}</ErrorBanner>
      )}

      <SplitPane>
        <Pane>
          <PaneLabel>Input ingress</PaneLabel>
          <ToolTextarea
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Paste kubectl get ingress -o yaml output here..."
            spellCheck={false}
          />
        </Pane>

        <Pane>
          <PaneLabelRow>
            <PaneLabel>
              Gateway + HTTPRoute {output && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>&nbsp;({ingressCount} ingress{ingressCount === 1 ? '' : 'es'} converted)</Box>}
            </PaneLabel>
            {output && (
              <Button onClick={copy} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy Output'}</Button>
            )}
          </PaneLabelRow>
          {output ? (
            <ToolTextarea
              value={output}
              readOnly
            />
          ) : (
            <EmptyState icon={Route} title="Converted Gateway + HTTPRoute will appear here" />
          )}
        </Pane>
      </SplitPane>

      {warnings.length > 0 && (
        <div>
          <PaneLabel block>
            Needs manual review
          </PaneLabel>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {warnings.map((w, i) => (
              <Box
                key={i}
                sx={{
                  fontSize: 13, padding: '8px 12px', borderRadius: 1,
                  background: 'rgba(240, 171, 0, 0.1)', border: '1px solid rgba(240, 171, 0, 0.3)', color: 'text.secondary',
                  display: 'flex', gap: '8px', alignItems: 'flex-start'
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{w}</span>
              </Box>
            ))}
          </Box>
        </div>
      )}
    </ToolBody>
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
    <ToolBody>
      <ErrorBanner neutral>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        Standalone snippet only — no <code>import</code> of external files or Tanka's <code>lib/</code>/<code>vendor/</code>. First run downloads a ~2MB WASM evaluator.
      </ErrorBanner>

      <Toolbar>
        <Button onClick={evaluate} disabled={busy || !input.trim()} variant="primary">
          {busy ? 'Evaluating…' : 'Evaluate'}
        </Button>
        <Box sx={{ display: 'flex', gap: '6px' }}>
          <Button size="sm" variant={outputFormat === 'yaml' ? 'primary' : 'secondary'} onClick={() => setOutputFormat('yaml')}>YAML</Button>
          <Button size="sm" variant={outputFormat === 'json' ? 'primary' : 'secondary'} onClick={() => setOutputFormat('json')}>JSON</Button>
        </Box>
        <ToolbarSpacer>
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {error && (
        <ErrorBanner><AlertCircle size={16} /> <Box component="pre" sx={{ margin: '0px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>{error}</Box></ErrorBanner>
      )}

      <SplitPane>
        <Pane>
          <PaneLabel>Jsonnet Input</PaneLabel>
          <ToolTextarea
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            onKeyDown={onKeyDown}
            placeholder="Paste Jsonnet here... Ctrl/Cmd + Enter to evaluate"
            spellCheck={false}
          />
        </Pane>

        <Pane>
          <PaneLabelRow>
            <PaneLabel>Output ({outputFormat.toUpperCase()})</PaneLabel>
            {output && (
              <Button onClick={copy} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy'}</Button>
            )}
          </PaneLabelRow>
          {output ? (
            <ToolTextarea value={output} readOnly />
          ) : (
            <EmptyState icon={FileCode2} title="Evaluated manifest will appear here" />
          )}
        </Pane>
      </SplitPane>
    </ToolBody>
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
    <ToolBody>
      <Toolbar>
        <Button onClick={toJson} variant="primary">YAML → JSON</Button>
        <Button onClick={toYaml} variant="secondary">JSON → YAML</Button>
        <ToolbarSpacer>
          {input && <StatBadge>{input.split('\n').length} lines</StatBadge>}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      {error && <ErrorBanner><AlertCircle size={14} /> {error}</ErrorBanner>}

      <SplitPane>
        <Pane>
          <PaneLabel>Input</PaneLabel>
          <ToolTextarea
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            placeholder="Paste YAML or JSON here..."
            spellCheck={false}
          />
        </Pane>

        <Pane>
          <PaneLabelRow>
            <PaneLabel>Output</PaneLabel>
            {output && (
              <Button onClick={copy} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy'}</Button>
            )}
          </PaneLabelRow>
          {output ? (
            <ToolTextarea value={output} readOnly />
          ) : (
            <EmptyState icon={Braces} title="Converted output will appear here" />
          )}
        </Pane>
      </SplitPane>
    </ToolBody>
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
    <ToolBody>
      <Pane>
        <PaneLabelRow>
          <PaneLabel>Input</PaneLabel>
          {input && <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>}
        </PaneLabelRow>
        <ToolTextarea rows={7}
          value={input}
          onChange={e => { setInput(e.target.value); setHashes(null) }}
          placeholder="Enter text to hash..."
        />
      </Pane>

      <Button onClick={compute} disabled={busy || !input} style={{ alignSelf: 'flex-start' }} variant="primary">
        {busy ? 'Computing…' : 'Compute Hashes'}
      </Button>

      {hashes ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {HASH_ALGOS.map(algo => (
            <ResultBox key={algo} label={algo} value={hashes[algo]} />
          ))}
        </Box>
      ) : (
        <EmptyState icon={Hash} title="Digests will appear here" />
      )}
    </ToolBody>
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
    <ToolBody gap={24}>
      <ToolCard>
        <PaneLabel block>Cron expression (minute hour day-of-month month day-of-week)</PaneLabel>
        <ToolInput big
          aria-label="Cron expression"
          value={expr}
          onChange={e => parse(e.target.value)}
          placeholder="*/15 * * * *"
          spellCheck={false} />
      </ToolCard>

      {result.error ? (
        <ErrorBanner><AlertCircle size={16} /> {result.error}</ErrorBanner>
      ) : (
        <>
          <Box sx={{ padding: '16px 20px', bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 1, fontSize: 15, fontWeight: 700, color: 'text.primary' }}>
            {result.description}
          </Box>

          <div>
            <PaneLabel block>Next {result.nextRuns.length} runs (UTC)</PaneLabel>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {result.nextRuns.map((d, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', bgcolor: 'action.hover', border: 1, borderColor: 'divider', borderRadius: 1, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  <span>{d.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</span>
                  <Box component="span" sx={{ color: 'text.secondary' }}>{d.toLocaleString()}</Box>
                </Box>
              ))}
              {result.nextRuns.length === 0 && (
                <Box component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>No matching run found in the next 4 years — check the expression (e.g. Feb 30 never occurs).</Box>
              )}
            </Box>
          </div>
        </>
      )}
    </ToolBody>
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
    <ToolBody>
      <ErrorBanner neutral>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        HS256 only, signed entirely in the browser — for generating local test tokens, not for issuing production credentials.
      </ErrorBanner>

      <Pane>
        <PaneLabel>Payload (JSON)</PaneLabel>
        <ToolTextarea rows={9}
          value={payload}
          onChange={e => { setPayload(e.target.value); setError('') }}
          spellCheck={false}
        />
      </Pane>

      <Toolbar>
        <ToolInput mono width={320}
          aria-label="Signing secret"
          value={secret}
          onChange={e => setSecret(e.target.value)}
          placeholder="Signing secret"
          type="password" />
        <Button onClick={sign} disabled={!payload.trim() || !secret} variant="primary">Sign Token</Button>
      </Toolbar>

      {error && <ErrorBanner><AlertCircle size={14} /> {error}</ErrorBanner>}

      {token ? (
        <Pane>
          <PaneLabelRow>
            <PaneLabel>Token</PaneLabel>
            <Button onClick={copy} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy'}</Button>
          </PaneLabelRow>
          <ToolTextarea breakAll rows={5} value={token} readOnly />
        </Pane>
      ) : (
        <EmptyState icon={KeyRound} title="Signed token will appear here" />
      )}
    </ToolBody>
  )
}

// ── TLS CERTIFICATE DECODER ──

function CertField({ label, value, mono = true }: { label: string, value: string, mono?: boolean }) {
  return (
    <ToolCard sx={{ py: 1.25, px: 1.75, bgcolor: 'action.hover' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>{label}</Typography>
      <Box sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary', fontFamily: mono ? 'var(--font-mono)' : 'inherit', wordBreak: 'break-all' }}>{value}</Box>
    </ToolCard>
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
    <ToolBody>
      <Pane>
        <PaneLabelRow>
          <PaneLabel>PEM certificate</PaneLabel>
          {input && <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>}
        </PaneLabelRow>
        <ToolTextarea rows={10}
          value={input}
          onChange={e => { setInput(e.target.value); setError('') }}
          placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
          spellCheck={false}
        />
      </Pane>

      <Button onClick={decode} disabled={busy || !input.trim()} style={{ alignSelf: 'flex-start' }} variant="primary">
        {busy ? 'Decoding…' : 'Decode Certificate'}
      </Button>

      {error && <ErrorBanner><AlertCircle size={16} /> {error}</ErrorBanner>}

      {result && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {result.otherCertsInInput > 0 && (
            <ErrorBanner neutral>
              <AlertCircle size={14} /> Input contains {result.otherCertsInInput + 1} certificates — showing the first one only.
            </ErrorBanner>
          )}

          <ErrorBanner tone={result.isExpired ? undefined : 'success'}>
            <ShieldCheck size={16} />
            {result.isExpired
              ? `Expired ${Math.abs(result.daysRemaining ?? 0)} days ago`
              : `Valid — expires in ${result.daysRemaining} days`}
          </ErrorBanner>

          <ResultGrid gap={12}>
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
          </ResultGrid>

          <div>
            <PaneLabel block>Subject Alternative Names</PaneLabel>
            {result.sans.length > 0 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {result.sans.map((s, i) => (
                  <ToolChip key={i}>
                    {s.type}:{s.value}
                  </ToolChip>
                ))}
              </Box>
            ) : (
              <Box component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>None</Box>
            )}
          </div>

          <ResultGrid gap={12}>
            <CertField label="SHA-256 Fingerprint" value={result.fingerprintSha256} />
            <CertField label="SHA-1 Fingerprint" value={result.fingerprintSha1} />
          </ResultGrid>
        </Box>
      )}

      {!result && !error && <EmptyState icon={ShieldCheck} title="Certificate details will appear here" />}
    </ToolBody>
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
    <ToolBody gap={28}>
      <div>
        <PaneLabel block>CPU (bare cores or millicores, e.g. 0.5 or 500m)</PaneLabel>
        <ToolInput big width={320}
          aria-label="CPU quantity"
          value={cpuInput}
          onChange={e => setCpuInput(e.target.value)}
          spellCheck={false} />
        {cores !== null ? (
          <ResultGrid gap={16}>
            <ResultBox label="Cores" value={formatNumber(cores)} />
            <ResultBox label="Millicores" value={`${formatNumber(cores * 1000)}m`} />
            <ResultBox label="Microcores" value={`${formatNumber(cores * 1e6)}u`} />
            <ResultBox label="Nanocores" value={`${formatNumber(cores * 1e9)}n`} />
          </ResultGrid>
        ) : (
          <Box component="span" sx={{ fontSize: 13, color: 'error.main' }}>Enter a bare number (cores) or a number with an "m" suffix (millicores).</Box>
        )}
      </div>

      <div>
        <PaneLabel block>Memory (Ki/Mi/Gi/Ti binary or k/M/G/T decimal, e.g. 256Mi)</PaneLabel>
        <ToolInput big width={320}
          aria-label="Memory quantity"
          value={memInput}
          onChange={e => setMemInput(e.target.value)}
          spellCheck={false} />
        {bytes !== null ? (
          <ResultGrid gap={16}>
            <ResultBox label="Bytes" value={formatNumber(bytes)} />
            <ResultBox label="Ki / Mi / Gi / Ti" value={`${formatNumber(bytes / 2 ** 10)}Ki  ·  ${formatNumber(bytes / 2 ** 20)}Mi  ·  ${formatNumber(bytes / 2 ** 30)}Gi  ·  ${formatNumber(bytes / 2 ** 40)}Ti`} />
            <ResultBox label="k / M / G / T (decimal)" value={`${formatNumber(bytes / 1e3)}k  ·  ${formatNumber(bytes / 1e6)}M  ·  ${formatNumber(bytes / 1e9)}G  ·  ${formatNumber(bytes / 1e12)}T`} />
          </ResultGrid>
        ) : (
          <Box component="span" sx={{ fontSize: 13, color: 'error.main' }}>Enter a bare number (bytes) or a number with a valid k8s memory suffix.</Box>
        )}
      </div>
    </ToolBody>
  )
}

// ── CIDR CALCULATOR ──

function CidrCalculatorTool() {
  const [input, setInput] = useState('10.0.0.0/24')
  const calc = calculateCidr(input)

  return (
    <ToolBody>
      <ToolCard>
        <PaneLabel block>IPv4 CIDR block</PaneLabel>
        <ToolInput big
          aria-label="IPv4 CIDR block"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="10.0.0.0/24"
          spellCheck={false} />
      </ToolCard>

      {calc.ok ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>Click a result to copy it</Box>
          <ResultGrid gap={16}>
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
          </ResultGrid>
        </Box>
      ) : (
        <ErrorBanner><AlertCircle size={16} /> {calc.error}</ErrorBanner>
      )}
    </ToolBody>
  )
}

// ── SUBNET SPLITTER ──

function SubnetSplitterTool() {
  const [block, setBlock] = useState('10.0.0.0/16')
  const [mode, setMode] = useState<SplitMode>('prefix')
  const [targetPrefix, setTargetPrefix] = useState(20)
  const [subnetCount, setSubnetCount] = useState(6)
  const [copied, setCopied] = useState(false)

  const split = splitCidr(block, mode, mode === 'prefix' ? targetPrefix : subnetCount)

  function copyAll() {
    if (!split.ok) return
    navigator.clipboard.writeText(split.result.subnets.map(s => s.cidr).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <ToolBody>
      <ToolCard>
        <PaneLabel block>Block to split</PaneLabel>
        <ToolInput big
          aria-label="Block to split"
          value={block}
          onChange={e => setBlock(e.target.value)}
          placeholder="10.0.0.0/16"
          spellCheck={false} />
      </ToolCard>

      <OptionGroup>
        <OptionRow>
          <OptionRowLabel>Split by</OptionRowLabel>
          <OptionLabel>
            <Radio size="small" checked={mode === 'prefix'} onChange={() => setMode('prefix')} />
            target prefix
            <ToolInput mono width={72}
          aria-label="Target prefix"
               type="number" min={0} max={32} value={targetPrefix}
              onChange={e => { setMode('prefix'); setTargetPrefix(Number(e.target.value)) }} />
          </OptionLabel>
          <OptionLabel>
            <Radio size="small" checked={mode === 'count'} onChange={() => setMode('count')} />
            how many subnets
            <ToolInput mono width={72}
          aria-label="Number of subnets"
               type="number" min={1} value={subnetCount}
              onChange={e => { setMode('count'); setSubnetCount(Number(e.target.value)) }} />
          </OptionLabel>
        </OptionRow>
      </OptionGroup>

      {!split.ok ? (
        <ErrorBanner><AlertCircle size={16} /> {split.error}</ErrorBanner>
      ) : (
        <>
          {split.result.normalizedFrom && (
            <ErrorBanner tone="warning">
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <code>{split.result.normalizedFrom}</code> has host bits set — split on its enclosing network <code>{split.result.block}</code>.
            </ErrorBanner>
          )}

          <ResultGrid gap={16}>
            <ResultBox label="Subnets Produced" value={split.result.totalSubnets.toLocaleString()} />
            <ResultBox label="Subnet Size" value={`/${split.result.newPrefix}`} />
            <ResultBox label="Usable Hosts Each" value={split.result.hostsPerSubnet.toLocaleString()} />
            <ResultBox
              label="Spare Subnets"
              value={split.result.requestedSubnets !== undefined
                ? `${(split.result.totalSubnets - split.result.requestedSubnets).toLocaleString()} of ${split.result.totalSubnets.toLocaleString()}`
                : '—'}
            />
          </ResultGrid>

          {split.result.requestedSubnets !== undefined && split.result.totalSubnets !== split.result.requestedSubnets && (
            <Box sx={{ fontSize: 12.5, color: 'text.secondary', fontFamily: 'var(--font-mono)' }}>
              Subnets divide on power-of-two boundaries, so {split.result.requestedSubnets} subnets means borrowing{' '}
              {split.result.newPrefix - split.result.blockPrefix} bits and getting {split.result.totalSubnets}.
            </Box>
          )}

          <div>
            <Toolbar sx={{ mb: 1.5 }}>
              <PaneLabel>
                Subnets
                {split.result.listTruncated && (
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    &nbsp;(first {split.result.subnets.length.toLocaleString()} of {split.result.totalSubnets.toLocaleString()})
                  </Box>
                )}
              </PaneLabel>
              <ToolbarSpacer>
                <Button onClick={copyAll} size="sm" variant="secondary" icon=<CopyIcon copied={copied} size={14} />>{copied ? 'Copied' : 'Copy CIDRs'}</Button>
              </ToolbarSpacer>
            </Toolbar>
            <TableWrap>
              <DevTable>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>#</th>
                    <th>Subnet</th>
                    <th>Usable range</th>
                    <th>Broadcast</th>
                    <th style={{ textAlign: 'right' }}>Hosts</th>
                  </tr>
                </thead>
                <tbody>
                  {split.result.subnets.map(s => (
                    <tr key={s.cidr}>
                      <Box component="td" sx={{ color: 'text.disabled' }}>{s.index}</Box>
                      <Box component="td" sx={{ color: 'primary.main', fontWeight: 700 }}>{s.cidr}</Box>
                      <td>{s.firstUsable} – {s.lastUsable}</td>
                      <Box component="td" sx={{ color: 'text.disabled' }}>{s.broadcast}</Box>
                      <td style={{ textAlign: 'right' }}>{s.usableHosts.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </DevTable>
            </TableWrap>
          </div>
        </>
      )}
    </ToolBody>
  )
}

// ── CIDR OVERLAP & MATCH ──

function CidrMatchTool() {
  const [cidrText, setCidrText] = useState('10.0.0.0/16\n10.1.0.0/16\n10.0.128.0/17')
  const [testText, setTestText] = useState('10.0.5.20\n10.0.130.9\n10.2.0.0/24')

  const analysis = analyzeCidrs(cidrText, testText)
  const invalidCidrs = analysis.cidrs.filter(c => c.error)

  return (
    <ToolBody>
      <SplitPane>
        <Pane>
          <PaneLabel>CIDR blocks</PaneLabel>
          <ToolTextarea rows={9}
            value={cidrText}
            onChange={e => setCidrText(e.target.value)}
            placeholder={'10.0.0.0/16\n192.168.0.0/24\n# comments and commas are fine'}
            spellCheck={false}
          />
        </Pane>
        <Pane>
          <PaneLabel>Addresses / blocks to test</PaneLabel>
          <ToolTextarea rows={9}
            value={testText}
            onChange={e => setTestText(e.target.value)}
            placeholder={'10.0.5.20\n10.2.0.0/24'}
            spellCheck={false}
          />
        </Pane>
      </SplitPane>

      {invalidCidrs.length > 0 && (
        <ErrorBanner>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          {invalidCidrs.map(c => `"${c.input}" — ${c.error}`).join('; ')}
        </ErrorBanner>
      )}

      {analysis.unnormalized.length > 0 && (
        <ErrorBanner tone="warning">
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          Host bits set — the kernel and every cloud provider will silently normalize{' '}
          {analysis.unnormalized.map(c => `${c.input} → ${c.cidr}`).join(', ')}.
        </ErrorBanner>
      )}

      {analysis.overlaps.length > 0 && (
        <div>
          <PaneLabel block>Overlapping blocks</PaneLabel>
          <Box sx={{ display: 'grid', gap: '6px' }}>
            {analysis.overlaps.map(o => (
              <ErrorBanner key={`${o.a}-${o.b}`} tone="warning" mono>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                {o.relation === 'identical'
                  ? <span><strong>{o.a}</strong> and <strong>{o.b}</strong> are the same block</span>
                  : o.relation === 'contains'
                    ? <span><strong>{o.a}</strong> fully contains <strong>{o.b}</strong></span>
                    : <span><strong>{o.b}</strong> fully contains <strong>{o.a}</strong></span>}
              </ErrorBanner>
            ))}
          </Box>
        </div>
      )}

      {analysis.rows.length > 0 && (
        <div>
          <PaneLabel block>Match results</PaneLabel>
          <TableWrap>
            <DevTable>
              <thead>
                <tr>
                  <th>Tested</th>
                  <th>Range</th>
                  <th>Matched by (longest prefix first)</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.map((row, i) => (
                  <tr key={`${row.input}-${i}`}>
                    <td style={{ fontWeight: 700 }}>{row.input}</td>
                    <Box component="td" sx={{ color: 'text.disabled' }}>{row.range ?? '—'}</Box>
                    <td>
                      {row.error
                        ? <ToolChip tone="warn">! {row.error}</ToolChip>
                        : row.matchedBy.length === 0
                          ? <Box component="span" sx={{ color: 'text.secondary' }}>no match</Box>
                          : (
                            <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {row.matchedBy.map((m, mi) => (
                                <ToolChip key={m} tone={mi === 0 ? 'ok' : undefined}>{m}</ToolChip>
                              ))}
                            </Box>
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DevTable>
          </TableWrap>
        </div>
      )}
    </ToolBody>
  )
}

// ── IPV6 TOOLKIT ──

function Ipv6Tool() {
  const [input, setInput] = useState('2001:db8::1/64')
  const analysis = analyzeIpv6(input)

  return (
    <ToolBody>
      <ToolCard>
        <PaneLabel block>IPv6 address or prefix</PaneLabel>
        <ToolInput big
          aria-label="IPv6 address or prefix"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="2001:db8::1/64"
          spellCheck={false} />
      </ToolCard>

      {!analysis.ok ? (
        <ErrorBanner><AlertCircle size={16} /> {analysis.error}</ErrorBanner>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {analysis.result.hasPrefix && analysis.result.hasHostBits && (
            <ErrorBanner tone="warning">
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              The address has bits set below its /{analysis.result.prefix} prefix — it is a host inside{' '}
              <code>{analysis.result.network}</code>, not the network address.
            </ErrorBanner>
          )}
          <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>Click a result to copy it</Box>
          <ResultGrid gap={16}>
            <ResultBox label="Compressed (RFC 5952)" value={analysis.result.compressed} />
            <ResultBox label="Expanded" value={analysis.result.expanded} />
            <ResultBox label="Address Type" value={analysis.result.type} />
            <ResultBox label="Network" value={analysis.result.network} />
            <ResultBox label="First Address" value={analysis.result.firstAddress} />
            <ResultBox label="Last Address" value={analysis.result.lastAddress} />
            <ResultBox
              label="Total Addresses"
              value={analysis.result.totalAddressesExact
                ? `${analysis.result.totalAddresses} (${analysis.result.totalAddressesExact})`
                : analysis.result.totalAddresses}
            />
            {analysis.result.embeddedIpv4 && <ResultBox label="Embedded IPv4" value={analysis.result.embeddedIpv4} />}
            <ResultBox label="Reverse DNS (PTR)" value={analysis.result.ptrName} />
          </ResultGrid>
        </Box>
      )}
    </ToolBody>
  )
}

// ── DNS LOOKUP ──

function DnsLookupTool() {
  const [name, setName] = useState('')
  const [type, setType] = useState<DnsRecordType>('A')
  const [result, setResult] = useState<DnsLookupResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function lookup() {
    if (!name.trim() || loading) return
    setLoading(true)
    setError('')
    const res = await lookupDns(name, type)
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      setResult(null)
      return
    }
    setResult(res.result)
  }

  const records = result ? (result.answers.length > 0 ? result.answers : result.authority) : []
  const showingAuthority = !!result && result.answers.length === 0 && result.authority.length > 0

  return (
    <ToolBody>
      <ErrorBanner neutral>
        <AlertCircle size={16} style={{ flexShrink: 0 }} />
        Unlike the other tools here, this one leaves your browser — the name you query is sent to {DOH_RESOLVER} over DNS-over-HTTPS.
      </ErrorBanner>

      <Toolbar>
        <ToolInput mono
          aria-label="Hostname"
          value={name}
          onChange={e => { setName(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') lookup() }}
          placeholder="api.example.com"
          spellCheck={false} />
        <ToolSelect
          aria-label="Record type"
          value={type}
          onChange={e => setType(e.target.value as DnsRecordType)}
        >
          {DNS_RECORD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </ToolSelect>
        <Button onClick={lookup} disabled={loading || !name.trim()} variant="primary">
          {loading ? 'Looking up…' : 'Look Up'}
        </Button>
      </Toolbar>

      {error && <ErrorBanner><AlertCircle size={16} /> {error}</ErrorBanner>}

      {result?.status && (
        <ErrorBanner tone="warning">
          <AlertCircle size={16} style={{ flexShrink: 0 }} /> {result.status}
        </ErrorBanner>
      )}

      {result && (
        <div>
          <Toolbar sx={{ mb: 1.5 }}>
            <PaneLabel>
              {showingAuthority ? 'Authority section' : 'Answers'}
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                &nbsp;— {result.type} {result.name}
              </Box>
            </PaneLabel>
            <ToolbarSpacer>
              {result.authenticated && <ToolChip tone="ok">DNSSEC validated</ToolChip>}
              <StatBadge>{DOH_RESOLVER}</StatBadge>
            </ToolbarSpacer>
          </Toolbar>

          {showingAuthority && (
            <Box sx={{ fontSize: 12.5, color: 'text.secondary', fontFamily: 'var(--font-mono)', marginBottom: '10px' }}>
              The name resolves but holds no {result.type} record — this is what the zone returned instead.
            </Box>
          )}

          {records.length === 0 ? (
            <EmptyState icon={Radar} title={`No ${result.type} records for ${result.name}`} />
          ) : (
            <TableWrap>
              <DevTable>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th style={{ width: 80 }}>TTL</th>
                    <th style={{ width: 80 }}>Type</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={`${r.name}-${r.type}-${r.data}-${i}`}>
                      <Box component="td" sx={{ color: 'text.disabled' }}>{r.name}</Box>
                      <td>{r.ttl}</td>
                      <Box component="td" sx={{ color: 'primary.main', fontWeight: 700 }}>{r.type}</Box>
                      <td style={{ wordBreak: 'break-all' }}>{r.data}</td>
                    </tr>
                  ))}
                </tbody>
              </DevTable>
            </TableWrap>
          )}
        </div>
      )}

      {!result && !error && <EmptyState icon={Radar} title="Enter a hostname to resolve it" />}
    </ToolBody>
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
    <ToolBody gap={28}>
      <div>
        <Toolbar sx={{ mb: 1.5 }}>
          <PaneLabel>UUIDv4</PaneLabel>
          <ToolbarSpacer>
            <ToolInput width={70}
          aria-label="UUID count"
               type="number" min={1} max={50} value={count}
              onChange={e => setCount(Number(e.target.value))} />
            <Button onClick={regenUuids} size="sm" variant="secondary">Generate</Button>
            <Button onClick={copyAll} size="sm" variant="secondary" icon={<CopyIcon copied={copiedAll} />}>
              {copiedAll ? 'Copied' : 'Copy All'}
            </Button>
          </ToolbarSpacer>
        </Toolbar>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {uuids.map((u, i) => <ResultBox key={i} label={`#${i + 1}`} value={u} />)}
        </Box>
      </div>

      <div>
        <Toolbar sx={{ mb: 1.5 }}>
          <PaneLabel>Random Secret</PaneLabel>
          <ToolbarSpacer>
            <ToolInput width={70}
          aria-label="Secret length"
               type="number" min={4} max={256} value={secretLength}
              onChange={e => setSecretLength(Number(e.target.value))} />
            <ToolSelect
          aria-label="Secret charset"
              value={charsetKey}
              onChange={e => setCharsetKey(e.target.value as keyof typeof SECRET_CHARSETS)}
            >
              <option value="alphanumeric">Alphanumeric</option>
              <option value="alphanumeric+symbols">Alphanumeric + symbols</option>
              <option value="hex">Hex</option>
            </ToolSelect>
            <Button onClick={regenSecret} size="sm" variant="secondary">Generate</Button>
          </ToolbarSpacer>
        </Toolbar>
        <ResultBox label={`${secret.length} characters — click to copy`} value={secret} />
      </div>
    </ToolBody>
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
    <ToolBody>
      <Toolbar>
        <Button onClick={compare} disabled={!original && !modified} variant="primary">Compare</Button>
        <ToolbarSpacer>
          {result && !result.error && <StatBadge>+{result.additions} / -{result.removals}</StatBadge>}
          <IconAction label="Clear" onClick={clearAll}><Trash2 size={14} /></IconAction>
        </ToolbarSpacer>
      </Toolbar>

      <SplitPane>
        <Pane>
          <PaneLabel>Original</PaneLabel>
          <ToolTextarea rows={13} value={original} onChange={e => setOriginal(e.target.value)} placeholder="Paste the original text..." spellCheck={false} />
        </Pane>
        <Pane>
          <PaneLabel>Modified</PaneLabel>
          <ToolTextarea rows={13} value={modified} onChange={e => setModified(e.target.value)} placeholder="Paste the modified text..." spellCheck={false} />
        </Pane>
      </SplitPane>

      {result?.error && <ErrorBanner><AlertCircle size={16} /> {result.error}</ErrorBanner>}

      {result && !result.error && (
        <div>
          <PaneLabel block>Diff</PaneLabel>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'auto', maxHeight: 480, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {result.lines.map((l, i) => (
              <Box
                key={i}
                sx={{
                  display: 'flex', gap: '12px', padding: '2px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  background: l.type === 'add' ? 'rgba(62, 134, 53, 0.12)' : l.type === 'remove' ? 'rgba(201, 25, 11, 0.12)' : 'transparent',
                  color: l.type === 'add' ? 'success.main' : l.type === 'remove' ? 'error.main' : 'text.secondary',
                }}
              >
                <Box component="span" sx={{ color: 'text.secondary', userSelect: 'none', flexShrink: 0, width: 60 }}>
                  {l.oldLine ?? ''}{l.oldLine && l.newLine ? '·' : ''}{l.newLine ?? ''}
                </Box>
                <Box component="span" sx={{ flexShrink: 0, userSelect: 'none' }}>{l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' '}</Box>
                <span>{l.text || ' '}</span>
              </Box>
            ))}
            {result.lines.length === 0 && (
              <Box sx={{ padding: '16px', color: 'text.secondary' }}>No differences</Box>
            )}
          </Box>
        </div>
      )}
    </ToolBody>
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
    <ToolBody>
      <ToolCard>
        <PaneLabel block>Image reference</PaneLabel>
        <ToolInput big
          aria-label="Image reference"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="ghcr.io/org/app:v1.2.3  or  nginx@sha256:..."
          spellCheck={false} />
      </ToolCard>

      {parsed ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <ResultGrid gap={16}>
            <ResultBox label="Registry" value={parsed.registry} />
            <ResultBox label="Repository" value={parsed.repository} />
            <ResultBox label="Tag" value={parsed.tag || '(none — pinned by digest)'} />
            <ResultBox label="Digest" value={parsed.digest || '(none)'} />
          </ResultGrid>
          {parsed.registry === 'docker.io' && (
            <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>Docker Hub images with no namespace get the implicit "library/" prefix.</Box>
          )}
        </Box>
      ) : (
        <EmptyState icon={Container} title="Parsed image reference will appear here" />
      )}
    </ToolBody>
  )
}
