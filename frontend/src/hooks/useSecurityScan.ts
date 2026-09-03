import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useToastStore } from '../store/toastStore'
import { apiError } from '../utils/errors'

interface SecurityScanSummary {
  target_type: string
  target_id: number
  scan_type: string
  finding_count: number
  high_count: number
  scanned_at: string
}

export interface ScanState<TResult> {
  result: TResult | null // null until a live scan runs in this session — summary doesn't carry full findings
  findingCount: number
  highCount: number
  scannedAt: string | null
  cached: boolean // true when only backed by the persisted summary, not a fresh scan
}

interface UseSecurityScanOptions<TTarget> {
  targetType: 'server' | 'resource'
  scanType: string
  loadTargets: () => Promise<TTarget[]>
  scanUrl: (id: number) => string
  scanErrorMessage: string
}

/**
 * The fields this hook probes to summarise a scan. Each audit endpoint returns
 * its own result shape (kernel CVEs, hardening checks, cluster posture,
 * resource exposure), and they disagree on what the count is called — so the
 * hook reads whichever of these is present rather than modelling each payload.
 */
interface ScanResultShape {
  scanned_at?: string
  findings?: unknown[]
  checks?: unknown[]
  finding_count?: number
  high_count?: number
  vulnerable_count?: number
  fail_count?: number
}

export function useSecurityScan<TTarget, TResult = unknown>({
  targetType, scanType, loadTargets, scanUrl, scanErrorMessage,
}: UseSecurityScanOptions<TTarget>) {
  const toast = useToastStore()
  const [targets, setTargets] = useState<TTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState<Record<number, boolean>>({})
  const [results, setResults] = useState<Record<number, ScanState<TResult>>>({})
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await loadTargets()
      setTargets(list)

      const summaryRes = await api.get<SecurityScanSummary[]>('/api/audit/summary')
      const initial: Record<number, ScanState<TResult>> = {}
      for (const s of summaryRes.data) {
        if (s.target_type !== targetType || s.scan_type !== scanType) continue
        initial[s.target_id] = {
          result: null, findingCount: s.finding_count, highCount: s.high_count,
          scannedAt: s.scanned_at, cached: true,
        }
      }
      setResults(initial)
    } catch {
      setTargets([])
    } finally {
      setLoading(false)
    }
  }, [loadTargets, targetType, scanType])

  useEffect(() => { load() }, [load])

  async function scan(id: number) {
    setScanning(prev => ({ ...prev, [id]: true }))
    try {
      const res = await api.get<{ result: TResult & ScanResultShape }>(scanUrl(id))
      const result: ScanResultShape = res.data.result
      const findings = result.findings ?? result.checks ?? []
      const findingCount = typeof result.finding_count === 'number' ? result.finding_count : findings.length
      const highCount = typeof result.high_count === 'number' ? result.high_count
        : typeof result.vulnerable_count === 'number' ? result.vulnerable_count
        : typeof result.fail_count === 'number' ? result.fail_count : 0
      setResults(prev => ({
        ...prev,
        [id]: { result: res.data.result, findingCount, highCount, scannedAt: result.scanned_at ?? new Date().toISOString(), cached: false },
      }))
      setExpanded(prev => ({ ...prev, [id]: true }))
    } catch (err: unknown) {
      toast.error('Scan failed', apiError(err) || scanErrorMessage)
    } finally {
      setScanning(prev => ({ ...prev, [id]: false }))
    }
  }

  function toggleExpand(id: number) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return {
    targets, loading, scanning, results, expanded,
    scan, toggleExpand,
    scannedCount: Object.keys(results).length,
  }
}
