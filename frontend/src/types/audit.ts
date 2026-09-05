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

// ── Code security (SAST / secrets / SCA / CodeQL) ──

export interface CodeFinding {
  tool: 'gitleaks' | 'semgrep' | 'trivy' | 'codeql'
  category: 'secret' | 'sast' | 'dependency' | 'iac'
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  rule_id: string
  title: string
  description?: string
  file?: string
  line?: number
  package?: string
  fixed_in?: string
  reference?: string
}

export interface CodeScanResult {
  scanned_at: string
  tools_run: string[]
  tool_errors?: Record<string, string>
  findings: CodeFinding[]
  finding_count: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
}

export interface CodeRepo {
  id: number
  name: string
  repo_url: string
  branch: string
  pat_set: boolean
  created_at: string
  updated_at: string
  last_result?: CodeScanResult // most recent persisted scan, if this repo has ever been scanned
}

// ── DAST (dynamic application security testing) ──

export interface DastFinding {
  plugin_id: string
  name: string
  risk: 'critical' | 'high' | 'medium' | 'low' | 'info'
  confidence: string
  description?: string
  solution?: string
  url?: string
  evidence?: string
  cwe_id?: string
}

export interface DastScanResult {
  scanned_at: string
  target_url: string
  mode: 'baseline' | 'full'
  findings: DastFinding[]
  finding_count: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
}

export interface DastTarget {
  id: number
  name: string
  target_url: string
  notes: string
  created_at: string
  updated_at: string
  last_result?: DastScanResult // most recent persisted scan, if this target has ever been scanned
}

// ── Tool availability ──

export interface ScanTool {
  id: string
  name: string
  purpose: string
  install_hint: string
  available: boolean
  path?: string
  custom_path?: string
  using_override: boolean
}

export interface DastEnvironment {
  zap_api_configured: boolean
  zap_api_url?: string
  docker: ScanTool
  ready: boolean
}
