/** Formatting + colour helpers shared by the storage panels. */

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB']

/** Human-readable size from a kilobyte count (what df/du report). */
export function fmtKB(kb: number): string {
  if (!kb || kb <= 0) return '0 KB'
  let value = kb
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${UNITS[unit]}`
}

/** Human-readable size from a byte count (what the Kubernetes API reports). */
export function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  return fmtKB(bytes / 1024)
}

/** Green below 70%, amber to 90%, red above — the usual disk-pressure bands. */
export function usageColor(percent: number): string {
  if (percent >= 90) return 'var(--danger)'
  if (percent >= 70) return 'var(--warning)'
  return 'var(--success)'
}

// A fixed palette so a category keeps the same colour between the stacked bar,
// the legend and the per-row badges — and between one scan and the next.
const CATEGORY_COLORS: Record<string, string> = {
  Logs: '#f59e0b',
  Containers: '#38bdf8',
  Databases: '#a78bfa',
  'VM images': '#c084fc',
  'Disk images': '#c084fc',
  Cache: '#fb7185',
  Temporary: '#fbbf24',
  'User data': '#34d399',
  'App data': '#22d3ee',
  System: '#94a3b8',
  Config: '#64748b',
  Applications: '#60a5fa',
  Dependencies: '#f472b6',
  Archives: '#fdba74',
  Backups: '#facc15',
  Media: '#4ade80',
  Downloads: '#2dd4bf',
  'Served data': '#818cf8',
  'Mounted volumes': '#7dd3fc',
  Metrics: '#f0abfc',
  Spool: '#cbd5e1',
  VCS: '#fda4af',
  'Crash dumps': '#ef4444',
  Other: '#475569',
}

const FALLBACK_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#facc15', '#2dd4bf', '#f472b6']

/** Stable colour for a category (or any label, e.g. a StorageClass name). */
export function categoryColor(name: string, index = 0): string {
  return CATEGORY_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/** Breadcrumb segments for a posix or Windows absolute path. */
export function pathCrumbs(p: string): { label: string; path: string }[] {
  if (!p) return []
  if (/^[A-Za-z]:\\/.test(p)) {
    const parts = p.split('\\').filter(Boolean)
    const crumbs: { label: string; path: string }[] = []
    let acc = ''
    parts.forEach((part, i) => {
      acc = i === 0 ? `${part}\\` : `${acc}${i === 1 ? '' : '\\'}${part}`
      crumbs.push({ label: part, path: acc })
    })
    return crumbs
  }
  const parts = p.split('/').filter(Boolean)
  const crumbs = [{ label: '/', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}
