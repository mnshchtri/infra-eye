import yaml from 'js-yaml'
import { errMessage } from '../utils/errors'

// Fields Kubernetes (or kubectl) populates server-side / locally on apply.
// Re-applying a manifest that still carries these causes immutable-field
// errors, spurious diffs, or stale-resourceVersion conflicts.
const METADATA_FIELDS_TO_STRIP = [
  'uid',
  'resourceVersion',
  'creationTimestamp',
  'generation',
  'managedFields',
  'selfLink',
  'ownerReferences',
  'deletionTimestamp',
  'deletionGracePeriodSeconds',
]

const LAST_APPLIED_ANNOTATION = 'kubectl.kubernetes.io/last-applied-configuration'

// Annotations controllers/kubectl stamp onto live objects that have no
// meaning on a fresh apply — always stripped, no option needed.
const ALWAYS_STRIP_ANNOTATIONS = [
  'deployment.kubernetes.io/revision',
  'autoscaling.alpha.kubernetes.io/conditions',
  'autoscaling.alpha.kubernetes.io/current-metrics',
  'control-plane.alpha.kubernetes.io/leader',
  'pv.kubernetes.io/bind-completed',
  'pv.kubernetes.io/bound-by-controller',
  'volume.beta.kubernetes.io/storage-provisioner',
  'volume.kubernetes.io/storage-provisioner',
  'volume.kubernetes.io/selected-node',
  'endpoints.kubernetes.io/last-change-trigger-time',
  'kubernetes.io/service-account.uid',
  'batch.kubernetes.io/job-tracking',
]

// Finalizers a controller re-adds on its own; safe to drop from a manifest
// meant for a fresh apply. Custom/operator finalizers are left untouched.
const CLUSTER_MANAGED_FINALIZERS = [
  'kubernetes.io/pvc-protection',
  'kubernetes.io/pv-protection',
]

// Namespaces every cluster provisions for itself. Copying their contents onto
// a target cluster at best no-ops and at worst overwrites its control plane.
const SYSTEM_NAMESPACES = ['kube-system', 'kube-public', 'kube-node-lease']

// Kinds a controller recreates from its parent object — re-applying them
// either fails (immutable controller-uid selectors) or duplicates state.
const CONTROLLER_GENERATED_KINDS = ['Event', 'Endpoints', 'EndpointSlice', 'ControllerRevision', 'ReplicaSet']

// Workload kinds carrying spec.replicas, for the scale-to-zero migration flow.
const SCALABLE_KINDS = ['Deployment', 'StatefulSet', 'ReplicaSet', 'ReplicationController']

// Cluster-scoped kinds — these legitimately have no metadata.namespace, so
// they must not be flagged (or stamped) as "missing a namespace".
const CLUSTER_SCOPED_KINDS = [
  'Namespace', 'Node', 'PersistentVolume', 'ClusterRole', 'ClusterRoleBinding', 'StorageClass',
  'CustomResourceDefinition', 'IngressClass', 'PriorityClass', 'ValidatingWebhookConfiguration',
  'MutatingWebhookConfiguration', 'APIService', 'RuntimeClass', 'CSIDriver', 'CSINode', 'GatewayClass',
  'VolumeSnapshotClass', 'ClusterIssuer', 'PodSecurityPolicy', 'FlowSchema', 'PriorityLevelConfiguration',
  'ComponentStatus',
]

const INGRESS_CLASS_ANNOTATION = 'kubernetes.io/ingress.class'
const USE_REGEX_ANNOTATION = 'nginx.ingress.kubernetes.io/use-regex'

// Characters that make an ingress path a regex rather than a literal prefix.
// ingress-nginx >= 1.x rejects pathType: Prefix/Exact on a regex path.
const REGEX_PATH_CHARS = ['(', ')', '*', '+', '?', '$', '|', '[', ']', '\\']

export interface CleanOptions {
  // Strip the kubectl.kubernetes.io/last-applied-configuration annotation.
  stripLastApplied: boolean
  // Strip metadata.namespace so the manifest can be applied into any namespace.
  stripNamespace: boolean
  // Strip known cluster-managed finalizers (e.g. pvc/pv-protection).
  stripFinalizers: boolean
  // Strip binding info that only makes sense for an already-provisioned
  // resource: Service spec.clusterIP(s)/ipFamilies, PVC spec.volumeName,
  // Pod spec.nodeName.
  stripBindingInfo: boolean
  // Strip Service spec.ports[].nodePort — off by default, since a pinned
  // nodePort is often load-balancer or firewall config the target must match.
  stripNodePorts: boolean
  // Drop live Pods; their controller recreates them after apply.
  dropPods: boolean
  // Drop other controller-generated objects (ReplicaSets, CronJob-spawned
  // Jobs, Endpoints, Events, service-account token Secrets).
  dropGenerated: boolean
  // Drop anything living in kube-system / kube-public / kube-node-lease.
  dropSystemNamespaces: boolean
  // Rewrite Ingresses for newer ingress-nginx: deprecated ingress.class
  // annotation → spec.ingressClassName, regex paths → ImplementationSpecific.
  fixIngress: boolean
  // Strip nginx *-snippet annotations (many controllers now reject them).
  // Behavior-changing, so off by default — flagged as a warning instead.
  stripIngressSnippets: boolean
  // Set spec.replicas: 0 on workloads, for a staged cutover where the target
  // cluster is populated before traffic is moved.
  scaleToZero: boolean
  // Prepend a Namespace manifest for every namespace the output references,
  // so a single `kubectl apply -f` works against an empty cluster.
  emitNamespaces: boolean
  // Namespace to stamp onto namespaced resources that carry none. Without it
  // they silently land in whatever namespace kubectl's context points at.
  defaultNamespace: string
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  stripLastApplied: true,
  stripNamespace: false,
  stripFinalizers: true,
  stripBindingInfo: true,
  stripNodePorts: false,
  dropPods: true,
  dropGenerated: true,
  dropSystemNamespaces: true,
  fixIngress: true,
  stripIngressSnippets: false,
  scaleToZero: false,
  emitNamespaces: true,
  defaultNamespace: '',
}

// Per-document ledger entry: what happened to one object, and why. A dropped
// object carries `dropped` (the reason) and nothing else.
export interface DocumentReport {
  kind: string
  name: string
  namespace: string
  dropped?: string
  removed: string[]
  edited: string[]
  warnings: string[]
}

export interface CleanResult {
  output: string
  // Documents in the output, including any generated Namespace manifests.
  documentCount: number
  documents: DocumentReport[]
  // Every namespace the output references, for the "create these first" list.
  namespaces: string[]
  generatedNamespaceCount: number
  droppedCount: number
  scaledCount: number
  stampedCount: number
  // Namespaced resources left with no namespace and no stamp to fall back on.
  missingNamespaceCount: number
  error?: string
}

const EMPTY_RESULT: CleanResult = {
  output: '',
  documentCount: 0,
  documents: [],
  namespaces: [],
  generatedNamespaceCount: 0,
  droppedCount: 0,
  scaledCount: 0,
  stampedCount: 0,
  missingNamespaceCount: 0,
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Deep clone so cleaning never mutates the caller's parsed documents. Dates
// are preserved because js-yaml's default schema parses unquoted timestamps
// (creationTimestamp, lastTransitionTime) into Date objects.
function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(deepClone) as unknown as T
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = deepClone(v)
    return out as T
  }
  return value
}

// `kubectl get all -o yaml` wraps everything in a single `kind: List`, and
// nested Lists show up when several `get` outputs are concatenated.
function flattenLists(docs: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const doc of docs) {
    if (isPlainObject(doc) && typeof doc.kind === 'string' && doc.kind.endsWith('List') && Array.isArray(doc.items)) {
      out.push(...flattenLists(doc.items))
    } else {
      out.push(doc)
    }
  }
  return out
}

function docKind(doc: unknown): string {
  return isPlainObject(doc) && typeof doc.kind === 'string' ? doc.kind : ''
}

function docMetaString(doc: unknown, field: 'name' | 'namespace'): string {
  if (!isPlainObject(doc) || !isPlainObject(doc.metadata)) return ''
  const v = doc.metadata[field]
  return typeof v === 'string' ? v : ''
}

// Returns why this object should be left out of the output, or null to keep
// it. Reasons are shown verbatim in the ledger, so they explain the "why".
function dropReason(doc: unknown, options: CleanOptions): string | null {
  if (!isPlainObject(doc) || !docKind(doc)) return 'empty document or no kind field'

  const kind = docKind(doc)
  const namespace = docMetaString(doc, 'namespace')
  const name = docMetaString(doc, 'name')

  if (options.dropSystemNamespaces) {
    if (namespace && SYSTEM_NAMESPACES.includes(namespace)) {
      return `lives in the system namespace ${namespace} — the target cluster provisions its own`
    }
    if (kind === 'Namespace' && SYSTEM_NAMESPACES.includes(name)) {
      return `system namespace ${name} — the target cluster provisions its own`
    }
  }

  if (options.dropPods && kind === 'Pod') {
    return 'live Pod — its controller recreates it after apply'
  }

  if (options.dropGenerated) {
    if (CONTROLLER_GENERATED_KINDS.includes(kind)) {
      return `controller-generated ${kind} — recreated from its parent object`
    }
    if (kind === 'Job') {
      const metadata = isPlainObject(doc.metadata) ? doc.metadata : {}
      const labels = isPlainObject(metadata.labels) ? metadata.labels : {}
      const owners = Array.isArray(metadata.ownerReferences) ? metadata.ownerReferences : []
      const ownedByCronJob = owners.some(o => isPlainObject(o) && o.kind === 'CronJob')
      const hasControllerUid = 'controller-uid' in labels || 'batch.kubernetes.io/controller-uid' in labels
      if (ownedByCronJob || hasControllerUid) {
        return 'CronJob-spawned Job — its controller-uid selector is immutable and un-appliable; the CronJob recreates it on schedule'
      }
    }
    if (kind === 'Secret' && doc.type === 'kubernetes.io/service-account-token') {
      return 'service-account token Secret — the target cluster issues its own'
    }
  }

  return null
}

// kubectl stamps `creationTimestamp: null` into every nested template
// (pod templates, CronJob job templates, CRD-embedded templates). Walk the
// whole tree rather than special-casing the handful of known paths.
function scrubNullCreationTimestamps(node: unknown, path: string, found: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => scrubNullCreationTimestamps(item, `${path}[${i}]`, found))
    return
  }
  if (isPlainObject(node)) {
    if ('creationTimestamp' in node && node.creationTimestamp === null) {
      delete node.creationTimestamp
      found.push(path ? `${path}.creationTimestamp` : 'creationTimestamp')
    }
    for (const [key, value] of Object.entries(node)) {
      scrubNullCreationTimestamps(value, path ? `${path}.${key}` : key, found)
    }
  }
}

function cleanMetadata(metadata: Record<string, unknown>, options: CleanOptions, removed: string[]): void {
  for (const field of METADATA_FIELDS_TO_STRIP) {
    if (field in metadata) {
      delete metadata[field]
      removed.push(`metadata.${field}`)
    }
  }

  if (options.stripNamespace && 'namespace' in metadata) {
    delete metadata.namespace
    removed.push('metadata.namespace')
  }

  if (options.stripFinalizers && Array.isArray(metadata.finalizers)) {
    const remaining = metadata.finalizers.filter((f: string) => !CLUSTER_MANAGED_FINALIZERS.includes(f))
    if (remaining.length !== metadata.finalizers.length) {
      removed.push('metadata.finalizers (cluster-managed)')
      if (remaining.length === 0) delete metadata.finalizers
      else metadata.finalizers = remaining
    }
  }

  if (isPlainObject(metadata.annotations)) {
    const annotations = metadata.annotations

    if (options.stripLastApplied && LAST_APPLIED_ANNOTATION in annotations) {
      delete annotations[LAST_APPLIED_ANNOTATION]
      removed.push(`metadata.annotations["${LAST_APPLIED_ANNOTATION}"]`)
    }

    for (const key of ALWAYS_STRIP_ANNOTATIONS) {
      if (key in annotations) {
        delete annotations[key]
        removed.push(`metadata.annotations["${key}"]`)
      }
    }
  }
}

function cleanServiceSpec(spec: Record<string, unknown>, options: CleanOptions, removed: string[]): void {
  if (options.stripBindingInfo) {
    // A headless Service declares clusterIP: None on purpose — that is spec,
    // not a cluster-assigned address, so it survives.
    if ('clusterIP' in spec && spec.clusterIP !== 'None') {
      delete spec.clusterIP
      removed.push('spec.clusterIP')
    }
    if ('clusterIPs' in spec && !(Array.isArray(spec.clusterIPs) && spec.clusterIPs[0] === 'None')) {
      delete spec.clusterIPs
      removed.push('spec.clusterIPs')
    }
    for (const field of ['healthCheckNodePort', 'ipFamilies', 'ipFamilyPolicy']) {
      if (field in spec) {
        delete spec[field]
        removed.push(`spec.${field}`)
      }
    }
  }

  if (options.stripNodePorts && Array.isArray(spec.ports)) {
    spec.ports.forEach((port: unknown, i: number) => {
      if (isPlainObject(port) && 'nodePort' in port) {
        delete port.nodePort
        removed.push(`spec.ports[${i}].nodePort`)
      }
    })
  }
}

function cleanIngress(
  doc: Record<string, unknown>,
  options: CleanOptions,
  removed: string[],
  edited: string[],
  warnings: string[],
): void {
  const metadata = isPlainObject(doc.metadata) ? doc.metadata : undefined
  const annotations = metadata && isPlainObject(metadata.annotations) ? metadata.annotations : undefined
  const spec = isPlainObject(doc.spec) ? doc.spec : undefined

  if (options.fixIngress) {
    // networking.k8s.io/v1 replaced the annotation with a real spec field, and
    // ingress-nginx >= 1.0 ignores the annotation unless explicitly re-enabled.
    if (annotations && typeof annotations[INGRESS_CLASS_ANNOTATION] === 'string') {
      const className = annotations[INGRESS_CLASS_ANNOTATION]
      if (spec && !spec.ingressClassName) {
        spec.ingressClassName = className
        edited.push(`spec.ingressClassName: ${className} (from annotation)`)
      }
      delete annotations[INGRESS_CLASS_ANNOTATION]
      removed.push(`metadata.annotations["${INGRESS_CLASS_ANNOTATION}"] (deprecated)`)
    }

    // A regex path with pathType Prefix/Exact is rejected by newer
    // ingress-nginx; ImplementationSpecific + use-regex is the equivalent.
    let rewroteRegexPath = false
    const rules = spec && Array.isArray(spec.rules) ? spec.rules : []
    for (const rule of rules) {
      if (!isPlainObject(rule) || !isPlainObject(rule.http) || !Array.isArray(rule.http.paths)) continue
      for (const p of rule.http.paths) {
        if (!isPlainObject(p)) continue
        const path = typeof p.path === 'string' ? p.path : ''
        const isLiteralType = p.pathType === 'Prefix' || p.pathType === 'Exact'
        if (isLiteralType && REGEX_PATH_CHARS.some(c => path.includes(c))) {
          edited.push(`pathType ${p.pathType} → ImplementationSpecific (${path} is a regex)`)
          p.pathType = 'ImplementationSpecific'
          rewroteRegexPath = true
        }
      }
    }

    if (rewroteRegexPath && metadata) {
      if (!isPlainObject(metadata.annotations)) metadata.annotations = {}
      const anns = metadata.annotations as Record<string, unknown>
      if (anns[USE_REGEX_ANNOTATION] !== 'true') {
        anns[USE_REGEX_ANNOTATION] = 'true'
        edited.push(`metadata.annotations["${USE_REGEX_ANNOTATION}"]: "true"`)
      }
    }
  }

  // Snippet annotations inject raw nginx config. Since ingress-nginx 1.9 they
  // are refused unless allow-snippet-annotations is turned back on, so the
  // manifest either fails to apply or silently loses behavior.
  const finalAnnotations = metadata && isPlainObject(metadata.annotations) ? metadata.annotations : undefined
  if (finalAnnotations) {
    const snippets = Object.keys(finalAnnotations)
      .filter(k => k.startsWith('nginx.ingress.kubernetes.io/') && k.endsWith('-snippet'))
    if (snippets.length > 0) {
      const shortNames = snippets.map(k => k.split('/').pop()).join(', ')
      if (options.stripIngressSnippets) {
        for (const key of snippets) {
          delete finalAnnotations[key]
          removed.push(`metadata.annotations["${key}"]`)
        }
        warnings.push(`removed ${shortNames} — the nginx config it injected is gone; re-verify routing, auth, and rewrites`)
      } else {
        warnings.push(`uses ${shortNames} — ingress-nginx ≥ 1.9 rejects snippets unless allow-snippet-annotations=true on the target controller`)
      }
    }
  }
}

interface DocumentChanges {
  removed: string[]
  edited: string[]
  warnings: string[]
}

// Cleans one document in place (the caller passes a clone).
function cleanDocument(doc: Record<string, unknown>, options: CleanOptions): DocumentChanges {
  const removed: string[] = []
  const edited: string[] = []
  const warnings: string[] = []
  const kind = docKind(doc)

  if ('status' in doc) {
    delete doc.status
    removed.push('status')
  }

  if (isPlainObject(doc.metadata)) {
    cleanMetadata(doc.metadata, options, removed)
  }

  if (isPlainObject(doc.spec)) {
    const spec = doc.spec

    if (kind === 'Service') {
      cleanServiceSpec(spec, options, removed)
    }

    if (options.stripBindingInfo) {
      if (kind === 'PersistentVolumeClaim' && 'volumeName' in spec) {
        delete spec.volumeName
        removed.push('spec.volumeName')
      }
      if (kind === 'Pod' && 'nodeName' in spec) {
        delete spec.nodeName
        removed.push('spec.nodeName')
      }
    }

    if (options.scaleToZero && SCALABLE_KINDS.includes(kind) && typeof spec.replicas === 'number' && spec.replicas !== 0) {
      edited.push(`spec.replicas: ${spec.replicas} → 0`)
      spec.replicas = 0
    }
  }

  if (kind === 'Ingress') {
    cleanIngress(doc, options, removed, edited, warnings)
  }

  const nestedTimestamps: string[] = []
  scrubNullCreationTimestamps(doc, '', nestedTimestamps)
  removed.push(...nestedTimestamps)

  // Drop metadata containers the strips emptied out, so the YAML stays tidy.
  if (isPlainObject(doc.metadata)) {
    const metadata = doc.metadata
    if (isPlainObject(metadata.annotations) && Object.keys(metadata.annotations).length === 0) {
      delete metadata.annotations
    }
  }

  return { removed, edited, warnings }
}

// Strips server-generated / kubectl-generated fields from a Kubernetes
// manifest so it can be applied fresh to a new (or the same) cluster, drops
// objects the target recreates on its own, and reports what it did per
// document. Accepts single- or multi-document YAML ("---") and `kind: List`.
export function cleanManifest(input: string, options: CleanOptions = DEFAULT_CLEAN_OPTIONS): CleanResult {
  if (!input.trim()) return { ...EMPTY_RESULT }

  let docs: unknown[]
  try {
    docs = flattenLists(yaml.loadAll(input)).filter(d => d !== null && d !== undefined)
  } catch (e: unknown) {
    return { ...EMPTY_RESULT, error: errMessage(e) || 'Invalid YAML' }
  }

  if (docs.length === 0) return { ...EMPTY_RESULT }

  const stamp = options.defaultNamespace.trim()
  const reports: DocumentReport[] = []
  const kept: Record<string, unknown>[] = []
  const namespaces = new Set<string>()
  const namespaceDocNames = new Set<string>()
  let droppedCount = 0
  let scaledCount = 0
  let stampedCount = 0
  let missingNamespaceCount = 0

  for (const original of docs) {
    const kind = docKind(original) || '(no kind)'
    const name = docMetaString(original, 'name') || '(unnamed)'

    const reason = dropReason(original, options)
    if (reason) {
      droppedCount++
      reports.push({
        kind, name,
        namespace: docMetaString(original, 'namespace'),
        dropped: reason,
        removed: [], edited: [], warnings: [],
      })
      continue
    }

    const doc = deepClone(original as Record<string, unknown>)
    const changes = cleanDocument(doc, options)
    if (changes.edited.some(e => e.startsWith('spec.replicas'))) scaledCount++

    // A namespaced resource with no metadata.namespace applies into whatever
    // namespace the kubectl context happens to point at — usually `default`.
    // That is rarely what a migration wants, so stamp it or say so loudly.
    if (!CLUSTER_SCOPED_KINDS.includes(kind) && !options.stripNamespace) {
      if (!isPlainObject(doc.metadata)) doc.metadata = {}
      const metadata = doc.metadata as Record<string, unknown>
      if (!metadata.namespace) {
        if (stamp) {
          metadata.namespace = stamp
          changes.edited.push(`metadata.namespace → ${stamp}`)
          stampedCount++
        } else {
          changes.warnings.push('no namespace — this applies into the current kubectl context namespace (usually default)')
          missingNamespaceCount++
        }
      }
    }

    const finalNamespace = docMetaString(doc, 'namespace')
    if (finalNamespace && !SYSTEM_NAMESPACES.includes(finalNamespace)) namespaces.add(finalNamespace)
    if (kind === 'Namespace') {
      namespaces.add(name)
      namespaceDocNames.add(name)
    }

    kept.push(doc)
    reports.push({ kind, name, namespace: finalNamespace, ...changes })
  }

  // Generate a Namespace manifest for every namespace the output references
  // that the input didn't already carry one for, so a single apply works
  // against an empty cluster. Namespaces the input did define keep their own
  // labels/annotations (istio-injection, pod-security, quota bindings).
  const generatedNamespaceDocs =
    options.emitNamespaces && !options.stripNamespace
      ? [...namespaces]
          .filter(n => !namespaceDocNames.has(n))
          .sort()
          .map(n => ({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: n } }))
      : []

  // Namespaces must exist before the objects inside them, so hoist every
  // Namespace manifest to the front of a single-file apply.
  const keptNamespaceDocs = kept.filter(d => docKind(d) === 'Namespace')
  const keptOtherDocs = kept.filter(d => docKind(d) !== 'Namespace')
  const ordered = [...generatedNamespaceDocs, ...keptNamespaceDocs, ...keptOtherDocs]

  const output = ordered
    .map(doc => yaml.dump(doc, { lineWidth: -1, noRefs: true }).trimEnd())
    .join('\n---\n')

  return {
    output,
    documentCount: ordered.length,
    documents: reports,
    namespaces: [...namespaces].sort(),
    generatedNamespaceCount: generatedNamespaceDocs.length,
    droppedCount,
    scaledCount,
    stampedCount,
    missingNamespaceCount,
  }
}
