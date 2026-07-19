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

export interface CleanOptions {
  // Strip the kubectl.kubernetes.io/last-applied-configuration annotation.
  stripLastApplied: boolean
  // Strip metadata.namespace so the manifest can be applied into any namespace.
  stripNamespace: boolean
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  stripLastApplied: true,
  stripNamespace: false,
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

function cleanDocument(doc: Record<string, any>, options: CleanOptions, removed: Set<string>): Record<string, any> {
  const cleaned: Record<string, any> = { ...doc }

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

    if (isPlainObject(metadata.annotations)) {
      const annotations = { ...metadata.annotations }

      if (options.stripLastApplied && LAST_APPLIED_ANNOTATION in annotations) {
        delete annotations[LAST_APPLIED_ANNOTATION]
        removed.add(`metadata.annotations["${LAST_APPLIED_ANNOTATION}"]`)
      }

      if (Object.keys(annotations).length === 0) {
        delete metadata.annotations
      } else {
        metadata.annotations = annotations
      }
    }

    cleaned.metadata = metadata
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
