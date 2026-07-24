export interface KernelFinding {
  cve: string
  name: string
  description: string
  poc_url: string
  vulnerable: boolean
  detail: string
}

export interface KernelAuditResult {
  kernel_version: string
  distro: string
  scanned_at: string
  findings: KernelFinding[]
  vulnerable_count: number
}

export interface HardeningCheck {
  id: string
  title: string
  severity: string
  passed: boolean
  detail: string
}

export interface HardeningAuditResult {
  scanned_at: string
  checks: HardeningCheck[]
  fail_count: number
}

export interface ClusterFinding {
  category: string
  severity: string
  resource: string
  detail: string
}

export interface ClusterAuditResult {
  server_version: string
  scanned_at: string
  findings: ClusterFinding[]
  finding_count: number
  high_count: number
}

export interface ResourceFinding {
  check: string
  severity: string
  passed: boolean
  detail: string
}

export interface ResourceAuditResult {
  scanned_at: string
  findings: ResourceFinding[]
  fail_count: number
}
