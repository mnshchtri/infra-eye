import yaml from 'js-yaml'

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

export interface CleanOptions {
  // Strip the kubectl.kubernetes.io/last-applied-configuration annotation.
  stripLastApplied: boolean
  // Strip metadata.namespace so the manifest can be applied into any namespace.
  stripNamespace: boolean
  // Strip known cluster-managed finalizers (e.g. pvc/pv-protection).
  stripFinalizers: boolean
  // Strip binding info that only makes sense for an already-provisioned
  // resource: Service spec.clusterIP(s), PVC spec.volumeName, Pod spec.nodeName.
  stripBindingInfo: boolean
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  stripLastApplied: true,
  stripNamespace: false,
  stripFinalizers: true,
  stripBindingInfo: true,
}

export interface CleanResult {
  output: string
  documentCount: number
  removedFields: string[]
  error?: string
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Removes metadata.creationTimestamp from a pod template (or jobTemplate)
// object without mutating the input, returning the (possibly cloned) value.
function stripTemplateCreationTimestamp<T>(template: T, pathLabel: string, removed: Set<string>): T {
  if (!isPlainObject(template) || !isPlainObject(template.metadata) || !('creationTimestamp' in template.metadata)) {
    return template
  }
  const metadata = { ...template.metadata }
  delete metadata.creationTimestamp
  removed.add(`${pathLabel}.metadata.creationTimestamp`)
  return { ...template, metadata }
}

function cleanDocument(doc: Record<string, any>, options: CleanOptions, removed: Set<string>): Record<string, any> {
  const cleaned: Record<string, any> = { ...doc }
  const kind = typeof cleaned.kind === 'string' ? cleaned.kind : ''

  if ('status' in cleaned) {
    delete cleaned.status
    removed.add('status')
  }

  if (isPlainObject(cleaned.metadata)) {
    const metadata = { ...cleaned.metadata }

    for (const field of METADATA_FIELDS_TO_STRIP) {
      if (field in metadata) {
        delete metadata[field]
        removed.add(`metadata.${field}`)
      }
    }

    if (options.stripNamespace && 'namespace' in metadata) {
      delete metadata.namespace
      removed.add('metadata.namespace')
    }

    if (options.stripFinalizers && Array.isArray(metadata.finalizers)) {
      const remaining = metadata.finalizers.filter((f: string) => !CLUSTER_MANAGED_FINALIZERS.includes(f))
      if (remaining.length !== metadata.finalizers.length) {
        removed.add('metadata.finalizers (cluster-managed)')
        if (remaining.length === 0) delete metadata.finalizers
        else metadata.finalizers = remaining
      }
    }

    if (isPlainObject(metadata.annotations)) {
      const annotations = { ...metadata.annotations }

      if (options.stripLastApplied && LAST_APPLIED_ANNOTATION in annotations) {
        delete annotations[LAST_APPLIED_ANNOTATION]
        removed.add(`metadata.annotations["${LAST_APPLIED_ANNOTATION}"]`)
      }

      for (const key of ALWAYS_STRIP_ANNOTATIONS) {
        if (key in annotations) {
          delete annotations[key]
          removed.add(`metadata.annotations["${key}"]`)
        }
      }

      if (Object.keys(annotations).length === 0) {
        delete metadata.annotations
      } else {
        metadata.annotations = annotations
      }
    }

    cleaned.metadata = metadata
  }

  if (isPlainObject(cleaned.spec)) {
    const spec = { ...cleaned.spec }

    if (options.stripBindingInfo) {
      if (kind === 'Service') {
        if ('clusterIP' in spec && spec.clusterIP !== 'None') {
          delete spec.clusterIP
          removed.add('spec.clusterIP')
        }
        if ('clusterIPs' in spec && !(Array.isArray(spec.clusterIPs) && spec.clusterIPs[0] === 'None')) {
          delete spec.clusterIPs
          removed.add('spec.clusterIPs')
        }
      }

      if (kind === 'PersistentVolumeClaim' && 'volumeName' in spec) {
        delete spec.volumeName
        removed.add('spec.volumeName')
      }

      if (kind === 'Pod' && 'nodeName' in spec) {
        delete spec.nodeName
        removed.add('spec.nodeName')
      }
    }

    // Pod-template creationTimestamp: kubectl always stamps a `null` value
    // here for Deployment/StatefulSet/DaemonSet/ReplicaSet/Job/CronJob.
    if (isPlainObject(spec.template)) {
      spec.template = stripTemplateCreationTimestamp(spec.template, 'spec.template', removed)
    }
    if (isPlainObject(spec.jobTemplate)) {
      let jobTemplate = stripTemplateCreationTimestamp(spec.jobTemplate, 'spec.jobTemplate', removed)
      if (isPlainObject(jobTemplate.spec) && isPlainObject(jobTemplate.spec.template)) {
        jobTemplate = {
          ...jobTemplate,
          spec: {
            ...jobTemplate.spec,
            template: stripTemplateCreationTimestamp(jobTemplate.spec.template, 'spec.jobTemplate.spec.template', removed),
          },
        }
      }
      spec.jobTemplate = jobTemplate
    }

    cleaned.spec = spec
  }

  return cleaned
}

// Strips server-generated / kubectl-generated fields from a Kubernetes
// manifest so it can be applied fresh to a new (or the same) cluster.
// Accepts single- or multi-document YAML (separated by "---").
export function cleanManifest(input: string, options: CleanOptions = DEFAULT_CLEAN_OPTIONS): CleanResult {
  if (!input.trim()) {
    return { output: '', documentCount: 0, removedFields: [] }
  }

  let docs: unknown[]
  try {
    docs = yaml.loadAll(input).filter(d => d !== null && d !== undefined)
  } catch (e: any) {
    return { output: '', documentCount: 0, removedFields: [], error: e.message || 'Invalid YAML' }
  }

  if (docs.length === 0) {
    return { output: '', documentCount: 0, removedFields: [] }
  }

  const removed = new Set<string>()
  const cleanedDocs = docs.map(doc => {
    if (!isPlainObject(doc)) return doc
    return cleanDocument(doc, options, removed)
  })

  const output = cleanedDocs
    .map(doc => yaml.dump(doc, { lineWidth: -1, noRefs: true }).trimEnd())
    .join('\n---\n')

  return {
    output,
    documentCount: cleanedDocs.length,
    removedFields: Array.from(removed).sort(),
  }
}
