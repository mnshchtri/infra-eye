import yaml from 'js-yaml'

// Best-effort client-side port of github.com/kubernetes-sigs/ingress2gateway's
// core mapping: one Gateway (with a listener per unique host) plus one
// HTTPRoute per Ingress. Annotation-driven behavior (nginx rewrite-target,
// canary, etc.) has no Gateway API equivalent and is flagged as a warning
// rather than guessed at.

const PATH_TYPE_MAP: Record<string, string> = {
  Exact: 'Exact',
  Prefix: 'PathPrefix',
  ImplementationSpecific: 'PathPrefix',
}

interface IngressBackendService {
  name?: string
  port?: { number?: number; name?: string }
}

interface IngressPath {
  path?: string
  pathType?: string
  backend?: { service?: IngressBackendService }
}

interface IngressRule {
  host?: string
  http?: { paths?: IngressPath[] }
}

interface IngressTLS {
  hosts?: string[]
  secretName?: string
}

interface IngressDoc {
  kind?: string
  metadata?: { name?: string; namespace?: string; annotations?: Record<string, unknown> }
  spec?: {
    ingressClassName?: string
    rules?: IngressRule[]
    tls?: IngressTLS[]
    defaultBackend?: unknown
  }
}

interface GatewayListener {
  name: string
  protocol: 'HTTP' | 'HTTPS'
  port: number
  hostname?: string
  tls?: { mode: string; certificateRefs: { name: string }[] }
}

export interface ConvertResult {
  output: string
  warnings: string[]
  ingressCount: number
  error?: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isIngress(v: unknown): v is IngressDoc {
  return isPlainObject(v) && v.kind === 'Ingress'
}

function convertIngress(doc: IngressDoc, warnings: string[]): Record<string, unknown>[] {
  const meta = doc.metadata || {}
  const name = meta.name || 'ingress'
  const namespace = meta.namespace
  const spec = doc.spec || {}
  const rules = spec.rules || []
  const tls = spec.tls || []

  const tlsHosts = new Set<string>()
  const hostToSecret: Record<string, string> = {}
  for (const t of tls) {
    for (const h of t.hosts || []) {
      tlsHosts.add(h)
      if (t.secretName) hostToSecret[h] = t.secretName
    }
  }

  const hosts: string[] = []
  for (const r of rules) {
    const h = r.host || '*'
    if (!hosts.includes(h)) hosts.push(h)
  }
  if (hosts.length === 0) hosts.push('*')

  const listeners: GatewayListener[] = hosts.map((h, i) => {
    const isTls = tlsHosts.has(h)
    const listener: GatewayListener = {
      name: (isTls ? 'https' : 'http') + '-' + i,
      protocol: isTls ? 'HTTPS' : 'HTTP',
      port: isTls ? 443 : 80,
    }
    if (h !== '*') listener.hostname = h
    if (isTls) {
      const secretName = hostToSecret[h]
      listener.tls = {
        mode: 'Terminate',
        certificateRefs: [{ name: secretName || 'CHANGEME-tls-secret' }],
      }
      if (!secretName) warnings.push(`"${name}": host "${h}" is TLS but has no matching spec.tls[].secretName — using a placeholder certificateRef.`)
    }
    return listener
  })

  const gatewayName = `${name}-gateway`
  const gateway = {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'Gateway',
    metadata: { name: gatewayName, ...(namespace ? { namespace } : {}) },
    spec: {
      gatewayClassName: spec.ingressClassName || 'CHANGEME-gateway-class',
      listeners,
    },
  }
  if (!spec.ingressClassName) {
    warnings.push(`"${name}" has no spec.ingressClassName — set gatewayClassName on the generated Gateway manually.`)
  }

  const httpRouteRules: Record<string, unknown>[] = []
  for (const r of rules) {
    const paths = r.http?.paths || []
    for (const p of paths) {
      const pathType = PATH_TYPE_MAP[p.pathType || ''] || 'PathPrefix'
      if (p.pathType === 'ImplementationSpecific') {
        warnings.push(`"${name}": path "${p.path}" uses pathType ImplementationSpecific (often nginx regex) — mapped to PathPrefix, verify the match still behaves the same.`)
      }
      const svc = p.backend?.service || {}
      const backendRef: Record<string, unknown> = { name: svc.name || 'CHANGEME-service' }
      if (typeof svc.port?.number === 'number') {
        backendRef.port = svc.port.number
      } else {
        warnings.push(`"${name}": backend "${svc.name || '?'}" references port by name ("${svc.port?.name}") — Gateway API backendRefs need a numeric port, add it manually.`)
      }
      httpRouteRules.push({
        matches: [{ path: { type: pathType, value: p.path || '/' } }],
        backendRefs: [backendRef],
      })
    }
  }

  if (spec.defaultBackend) {
    warnings.push(`"${name}" has a spec.defaultBackend — Gateway API has no direct equivalent; add a catch-all HTTPRoute rule manually if needed.`)
  }
  if (Object.keys(meta.annotations || {}).length > 0) {
    warnings.push(`"${name}" has annotations that were not converted (rewrite-target, canary, auth, etc.) — port any that matter to Gateway API policies manually.`)
  }

  const httpRoute = {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    metadata: { name, ...(namespace ? { namespace } : {}) },
    spec: {
      parentRefs: [{ name: gatewayName }],
      ...(hosts.some(h => h !== '*') ? { hostnames: hosts.filter(h => h !== '*') } : {}),
      rules: httpRouteRules,
    },
  }

  return [gateway, httpRoute]
}

export function convertIngressToGateway(input: string): ConvertResult {
  if (!input.trim()) return { output: '', warnings: [], ingressCount: 0 }

  let docs: unknown[]
  try {
    docs = yaml.loadAll(input).filter(d => d !== null && d !== undefined)
  } catch (e) {
    return { output: '', warnings: [], ingressCount: 0, error: e instanceof Error ? e.message : 'Invalid YAML' }
  }

  const warnings: string[] = []
  const outputs: Record<string, unknown>[] = []
  let ingressCount = 0

  for (const doc of docs) {
    if (isIngress(doc)) {
      ingressCount++
      outputs.push(...convertIngress(doc, warnings))
    }
  }

  if (ingressCount === 0) {
    return { output: '', warnings: [], ingressCount: 0, error: 'No Ingress resources found in input (looking for kind: Ingress).' }
  }

  const output = outputs
    .map(doc => yaml.dump(doc, { lineWidth: -1, noRefs: true }).trimEnd())
    .join('\n---\n')

  return { output, warnings, ingressCount }
}
