import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Minimal shapes for the Kubernetes objects the explorer renders.
 *
 * These are deliberately loose. The explorer is generic over ~30 resource kinds
 * and, per docs/DESIGN_PRINCIPLES.md, passes whatever the cluster returns
 * straight through rather than modelling each kind — so the index signature is
 * the point, not an oversight. It buys back the fields every kind really does
 * have (`metadata.name`, namespace, timestamps) without pretending to know the
 * rest, which is what `any` was silently doing before.
 */

export interface K8sMetadata {
  name: string
  namespace?: string
  uid?: string
  creationTimestamp?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  [key: string]: unknown
}

/**
 * A `spec` or `status` block, whose shape depends entirely on the resource kind.
 *
 * This is the one place the codebase keeps `any` on purpose. The explorer's
 * table renders ~30 kinds through a single generic accessor that reaches for
 * `spec.clusterIP`, `status.containerStatuses[0].restartCount`,
 * `spec.rules[0].host` and dozens more — fields with no common shape. Modelling
 * that as a union would be a large, brittle artifact re-derived on every
 * Kubernetes release, and narrowing at all ~40 access sites would bury the
 * accessor in type guards for no runtime benefit.
 *
 * Confining the escape hatch to this alias means the surrounding code — every
 * component, prop, and callback — is properly typed, and the deliberately
 * schema-less boundary is named and explained in exactly one spot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type K8sFields = any

export interface K8sObject {
  apiVersion?: string
  kind?: string
  metadata: K8sMetadata
  // Events keep these at the top level rather than under spec/status.
  involvedObject?: { kind?: string; name?: string; namespace?: string }
  lastTimestamp?: string
  creationTimestamp?: string
  spec?: K8sFields
  status?: K8sFields
  [key: string]: unknown
}

/** A row in the resource table: a K8sObject, or a projection the page built. */
export type K8sRow = K8sObject

/**
 * Recharts hands its formatters loosely-typed values, and the exact union
 * differs between chart kinds. This covers what the callbacks actually receive.
 */
export type ChartValue = number | string

/**
 * An icon component. Most are lucide's, but the OS/distro glyphs in
 * components/OSIcons are hand-written components with the same call shape, so
 * props that accept either need this union.
 */
export type IconComponent = LucideIcon | ComponentType<{ size?: number; color?: string }>
