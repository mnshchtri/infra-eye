/** Shapes returned by the backend storage handlers (`handlers/storage.go`). */

export interface FilesystemInfo {
  device: string
  mountpoint: string
  fstype: string
  options: string
  size_kb: number
  used_kb: number
  avail_kb: number
  use_percent: number
  inodes_total: number
  inodes_used: number
  inodes_percent: number
}

export interface BlockDevice {
  name: string
  size: string
  type: string
  fstype: string
  mountpoint: string
  model: string
}

export interface StorageTotals {
  size_kb: number
  used_kb: number
  avail_kb: number
  use_percent: number
  mounts: number
}

export interface StorageInfo {
  hostname: string
  filesystems: FilesystemInfo[]
  devices: BlockDevice[]
  totals: StorageTotals
  warnings: string[]
}

export interface DirUsage {
  name: string
  path: string
  size_kb: number
  percent: number
  category: string
}

export interface FileUsage {
  name: string
  path: string
  size_kb: number
  percent: number
  modified: string
  owner: string
  category: string
}

export interface CategoryUsage {
  name: string
  size_kb: number
  percent: number
  entries: number
}

export interface StorageAnalysis {
  path: string
  parent: string
  total_kb: number
  accounted_kb: number
  mountpoint: string
  device: string
  mount_size_kb: number
  mount_used_kb: number
  mount_avail_kb: number
  folders: DirUsage[]
  files: FileUsage[]
  categories: CategoryUsage[]
  file_min_size_kb: number
  duration_ms: number
  warnings: string[]
}

// ── Kubernetes ──

export interface K8sStorageClassInfo {
  name: string
  provisioner: string
  reclaim_policy: string
  binding_mode: string
  allow_expansion: boolean
  is_default: boolean
}

export interface K8sPVInfo {
  name: string
  capacity_bytes: number
  access_modes: string
  reclaim_policy: string
  status: string
  claim: string
  storage_class: string
  source_type: string
  node: string
}

export interface K8sPVCInfo {
  name: string
  namespace: string
  status: string
  volume: string
  capacity_bytes: number
  request_bytes: number
  storage_class: string
  access_modes: string
  used_by: string
}

export interface K8sNodeStorageInfo {
  name: string
  ephemeral_total_bytes: number
  ephemeral_allocatable_bytes: number
  disk_pressure: boolean
  ready: boolean
  attached_volumes: number
  container_runtime: string
}

export interface K8sStorageSummary {
  storage_classes: number
  pvs: number
  pvcs: number
  bound_pvcs: number
  pending_pvcs: number
  nodes: number
  provisioned_bytes: number
  unbound_bytes: number
  ephemeral_total_bytes: number
}

export interface K8sCategoryUsage {
  name: string
  size_bytes: number
  percent: number
  entries: number
}

export interface K8sStorageInfo {
  storage_classes: K8sStorageClassInfo[]
  pvs: K8sPVInfo[]
  pvcs: K8sPVCInfo[]
  nodes: K8sNodeStorageInfo[]
  by_class: K8sCategoryUsage[]
  by_namespace: K8sCategoryUsage[]
  summary: K8sStorageSummary
}
