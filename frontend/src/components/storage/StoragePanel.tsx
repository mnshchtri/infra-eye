import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HardDrive, Database, FolderTree, FileText, Layers, Gauge,
  ChevronRight, RefreshCw, Search, Loader2, AlertTriangle, CornerLeftUp, Hash,
} from 'lucide-react'
import { api } from '../../api/client'
import { errMessage } from '../../utils/errors'
import { useToastStore } from '../../store/toastStore'
import { fmtKB, usageColor, categoryColor, pathCrumbs } from './format'
import type { StorageInfo, StorageAnalysis, FilesystemInfo } from './types'

const MONO = 'var(--font-mono)'

/** Same visual language as the Overview tab's stat cards. */
function Tile({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: typeof HardDrive; accent?: string
}) {
  return (
    <div className="card" style={{ padding: '20px 24px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 36, height: 36, border: '1px solid var(--border-bright)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon size={16} color={accent || 'var(--brand-primary)'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', fontFamily: MONO, lineHeight: 1.1 }}>{value}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.1em', fontFamily: MONO, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </div>
          {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, marginTop: 4 }}>{sub}</div>}
        </div>
      </div>
    </div>
  )
}

function SectionCard({ icon: Icon, title, count, action, children }: {
  icon: typeof HardDrive; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon size={16} color="var(--brand-primary)" />
        <span style={{ fontWeight: 800, fontSize: 14 }}>{title}</span>
        {count !== undefined && <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', fontFamily: MONO }}>({count})</span>}
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      {children}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '10px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: MONO,
  textAlign: 'left', background: 'var(--bg-elevated)',
}
const tdStyle: React.CSSProperties = { padding: '10px 16px', fontFamily: MONO, fontSize: 13 }

function THead({ headers, sticky }: { headers: string[]; sticky?: boolean }) {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--border)' }}>
        {headers.map(h => (
          <th key={h} style={sticky ? { ...thStyle, position: 'sticky', top: 0 } : thStyle}>{h}</th>
        ))}
      </tr>
    </thead>
  )
}

function UsageBar({ percent, color }: { percent: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, percent || 0))
  return (
    <div style={{ height: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', overflow: 'hidden', minWidth: 90 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color || usageColor(pct) }} />
    </div>
  )
}

function CategoryBadge({ name }: { name: string }) {
  const c = categoryColor(name)
  return (
    <span style={{
      padding: '2px 7px', fontSize: 10, fontWeight: 900, fontFamily: MONO, textTransform: 'uppercase',
      background: `${c}18`, color: c, border: `1px solid ${c}40`, whiteSpace: 'nowrap',
    }}>{name}</span>
  )
}

/**
 * The category rollup: one stacked bar showing what *kind* of data fills the
 * scanned path, so "48% used" becomes "half of it is container images".
 */
function CategoryBreakdown({ categories, totalKB }: { categories: StorageAnalysis['categories']; totalKB: number }) {
  if (categories.length === 0) return null
  const shown = categories.slice(0, 10)
  return (
    <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: MONO }}>
          Consumption by category
        </span>
        <span style={{ fontSize: 12, fontFamily: MONO, color: 'var(--text-secondary)' }}>{fmtKB(totalKB)} total</span>
      </div>
      <div style={{ display: 'flex', height: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {shown.map((cat, i) => (
          <div
            key={cat.name}
            title={`${cat.name} — ${fmtKB(cat.size_kb)} (${cat.percent.toFixed(1)}%)`}
            style={{ width: `${Math.max(cat.percent, 0.4)}%`, background: categoryColor(cat.name, i), transition: 'width 0.3s' }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
        {shown.map((cat, i) => (
          <div key={cat.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 8, height: 8, background: categoryColor(cat.name, i), flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{cat.name}</span>
            <span style={{ fontSize: 12, fontFamily: MONO, color: 'var(--text-muted)' }}>
              {fmtKB(cat.size_kb)} · {cat.percent.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface StoragePanelProps {
  serverId: string
  os?: string
}

/**
 * Storage for an SSH-managed host. Two passes, deliberately separate: the
 * inventory (df/lsblk) loads with the tab because it's cheap, while the path
 * analysis shells out to du/find over a whole subtree and only runs when the
 * operator asks for a specific path — a scan of / on a busy box is minutes of
 * disk I/O, not something to fire on a tab click.
 */
export function StoragePanel({ serverId, os }: StoragePanelProps) {
  const toast = useToastStore()
  const isWindows = os === 'windows'
  const rootPath = isWindows ? 'C:\\' : '/'

  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const [pathInput, setPathInput] = useState(rootPath)
  const [analysis, setAnalysis] = useState<StorageAnalysis | null>(null)
  const [scanning, setScanning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [minFileKB, setMinFileKB] = useState(1024)
  const [limit, setLimit] = useState(20)
  const scanSeq = useRef(0)

  const fetchInventory = useCallback(async (): Promise<StorageInfo> => {
    const res = await api.get(`/api/servers/${serverId}/storage`)
    return {
      ...res.data,
      filesystems: res.data?.filesystems || [],
      devices: res.data?.devices || [],
      totals: res.data?.totals || { size_kb: 0, used_kb: 0, avail_kb: 0, use_percent: 0, mounts: 0 },
      warnings: res.data?.warnings || [],
    }
  }, [serverId])

  // First load. `alive` guards the state writes so switching servers mid-flight
  // can't have the old request land on the new server's panel.
  useEffect(() => {
    let alive = true
    fetchInventory()
      .then(data => { if (alive) { setInfo(data); setLoadFailed(false) } })
      .catch((err: unknown) => {
        if (!alive) return
        setInfo(null)
        setLoadFailed(true)
        toast.error('Failed to load storage data', errMessage(err))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [fetchInventory, toast])

  const reloadInventory = useCallback(async () => {
    setLoading(true)
    try {
      setInfo(await fetchInventory())
      setLoadFailed(false)
    } catch (err: unknown) {
      setInfo(null)
      setLoadFailed(true)
      toast.error('Failed to load storage data', errMessage(err))
    } finally {
      setLoading(false)
    }
  }, [fetchInventory, toast])

  // A running counter while du/find walks the tree — a scan that takes two
  // minutes needs to look like progress, not like a hung request. The counter
  // is zeroed by runScan, so this effect only owns the interval.
  useEffect(() => {
    if (!scanning) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [scanning])

  const runScan = useCallback(async (target: string) => {
    const seq = ++scanSeq.current
    setScanning(true)
    setElapsed(0)
    setPathInput(target)
    try {
      const res = await api.get(`/api/servers/${serverId}/storage/analyze`, {
        params: { path: target, limit, min_file_kb: minFileKB },
      })
      if (seq !== scanSeq.current) return   // a newer scan already superseded this one
      setAnalysis({
        ...res.data,
        folders: res.data?.folders || [],
        files: res.data?.files || [],
        categories: res.data?.categories || [],
        warnings: res.data?.warnings || [],
      })
    } catch (err: unknown) {
      if (seq !== scanSeq.current) return
      toast.error('Scan failed', errMessage(err))
    } finally {
      if (seq === scanSeq.current) setScanning(false)
    }
  }, [serverId, limit, minFileKB, toast])

  if (loading && !info) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!info || loadFailed) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <HardDrive size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
        <div style={{ fontSize: 13 }}>Unable to load storage data</div>
        <button className="btn btn-secondary" onClick={reloadInventory} style={{ marginTop: 16 }}>Retry</button>
      </div>
    )
  }

  const { totals } = info
  const busiest = info.filesystems.reduce<FilesystemInfo | null>(
    (worst, fs) => (!worst || fs.use_percent > worst.use_percent ? fs : worst), null,
  )
  const crumbs = pathCrumbs(analysis?.path || pathInput)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary */}
      <div className="grid-stats-4">
        <Tile label="Total Capacity" value={fmtKB(totals.size_kb)} sub={`${totals.mounts} mount${totals.mounts === 1 ? '' : 's'}`} icon={HardDrive} />
        <Tile label="Used" value={`${totals.use_percent.toFixed(1)}%`} sub={fmtKB(totals.used_kb)} icon={Gauge} accent={usageColor(totals.use_percent)} />
        <Tile label="Free" value={fmtKB(totals.avail_kb)} icon={Database} accent="var(--success)" />
        <Tile
          label="Fullest Mount"
          value={busiest ? `${busiest.use_percent.toFixed(0)}%` : '—'}
          sub={busiest?.mountpoint}
          icon={AlertTriangle}
          accent={busiest ? usageColor(busiest.use_percent) : undefined}
        />
      </div>

      {info.warnings.length > 0 && (
        <div className="card" style={{ padding: '12px 16px', border: '1px solid var(--warning)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: MONO }}>
            {info.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        </div>
      )}

      {/* Filesystems — the per-mount answer to "what is consuming this disk" */}
      <SectionCard
        icon={HardDrive}
        title="Filesystems"
        count={info.filesystems.length}
        action={
          <button className="btn btn-secondary btn-sm" onClick={reloadInventory} disabled={loading} title="Refresh">
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
        }
      >
        {info.filesystems.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No filesystems reported</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <THead headers={['Mount', 'Device', 'Type', 'Usage', 'Used', 'Free', 'Size', 'Inodes', '']} />
              <tbody>
                {info.filesystems.map((fs, i) => {
                  const color = usageColor(fs.use_percent)
                  return (
                    <tr key={`${fs.device}-${fs.mountpoint}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 6, height: 6, background: color, flexShrink: 0 }} />
                          <span>{fs.mountpoint}</span>
                        </div>
                        {fs.options && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {fs.options}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fs.device}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{fs.fstype || '—'}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <UsageBar percent={fs.use_percent} />
                          <span style={{ fontSize: 12, fontWeight: 800, color }}>{fs.use_percent.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={tdStyle}>{fmtKB(fs.used_kb)}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{fmtKB(fs.avail_kb)}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{fmtKB(fs.size_kb)}</td>
                      <td style={{ ...tdStyle, fontSize: 12 }}>
                        {fs.inodes_total > 0 ? (
                          <span style={{ color: fs.inodes_percent >= 90 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                            {fs.inodes_percent.toFixed(0)}%
                            <span style={{ color: 'var(--text-muted)' }}> of {fs.inodes_total.toLocaleString()}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => runScan(fs.mountpoint)}
                          disabled={scanning}
                          style={{ gap: 6, whiteSpace: 'nowrap' }}
                          title={`Analyze what is consuming ${fs.mountpoint}`}
                        >
                          <Search size={13} /> Analyze
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Path explorer */}
      <SectionCard icon={FolderTree} title="Path Analyzer">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !scanning) runScan(pathInput) }}
            placeholder={rootPath}
            spellCheck={false}
            style={{ flex: 1, minWidth: 220, fontFamily: MONO, fontSize: 13 }}
          />
          <select className="input" value={minFileKB} onChange={e => setMinFileKB(Number(e.target.value))} style={{ width: 150, fontFamily: MONO, fontSize: 12 }} title="Ignore files smaller than this">
            <option value={1024}>Files ≥ 1 MB</option>
            <option value={10240}>Files ≥ 10 MB</option>
            <option value={102400}>Files ≥ 100 MB</option>
            <option value={1048576}>Files ≥ 1 GB</option>
          </select>
          <select className="input" value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ width: 110, fontFamily: MONO, fontSize: 12 }} title="How many rows to return">
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
          <button className="btn btn-primary" onClick={() => runScan(pathInput)} disabled={scanning} style={{ gap: 8 }}>
            {scanning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />}
            {scanning ? `Scanning… ${elapsed}s` : 'Analyze'}
          </button>
        </div>

        {/* Breadcrumbs — drilling down is just another scan of a deeper path */}
        {(analysis || scanning) && (
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {analysis?.parent && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => runScan(analysis.parent)}
                disabled={scanning}
                style={{ gap: 6, marginRight: 8 }}
                title="Analyze the parent directory"
              >
                <CornerLeftUp size={13} /> Up
              </button>
            )}
            {crumbs.map((crumb, i) => (
              <span key={crumb.path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <ChevronRight size={12} color="var(--text-muted)" />}
                <button
                  onClick={() => runScan(crumb.path)}
                  disabled={scanning}
                  style={{
                    background: 'transparent', border: 'none', cursor: scanning ? 'default' : 'pointer',
                    fontFamily: MONO, fontSize: 12, fontWeight: i === crumbs.length - 1 ? 800 : 600,
                    color: i === crumbs.length - 1 ? 'var(--brand-primary)' : 'var(--text-secondary)', padding: '2px 4px',
                  }}
                >{crumb.label}</button>
              </span>
            ))}
          </div>
        )}

        {scanning && !analysis && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontFamily: MONO }}>Walking {pathInput} — {elapsed}s</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Directory sizes come from a live du/find walk, so a large tree takes a while.</div>
          </div>
        )}

        {!scanning && !analysis && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <FolderTree size={30} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>Pick a path (or hit <strong>Analyze</strong> on a mount above) to see which folders, files and data categories are consuming it.</div>
          </div>
        )}

        {analysis && (
          <>
            {/* Where this path physically lives */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', background: 'var(--bg-elevated)' }}>
              {[
                { label: 'Scanned', value: fmtKB(analysis.total_kb) },
                { label: 'On mount', value: analysis.mountpoint || '—' },
                { label: 'Device', value: analysis.device || '—' },
                { label: 'Mount used', value: analysis.mount_size_kb > 0 ? `${fmtKB(analysis.mount_used_kb)} / ${fmtKB(analysis.mount_size_kb)}` : '—' },
                { label: 'Share of mount', value: analysis.mount_used_kb > 0 ? `${((analysis.total_kb / analysis.mount_used_kb) * 100).toFixed(1)}%` : '—' },
                { label: 'Scan time', value: `${(analysis.duration_ms / 1000).toFixed(1)}s` },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: MONO }}>{item.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, marginTop: 3, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.value}</div>
                </div>
              ))}
            </div>

            <CategoryBreakdown categories={analysis.categories} totalKB={analysis.total_kb} />

            {analysis.warnings.length > 0 && (
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <AlertTriangle size={14} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {analysis.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              </div>
            )}

            {/* Folders */}
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FolderTree size={14} color="var(--brand-primary)" />
                <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: MONO }}>Largest folders</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO }}>({analysis.folders.length})</span>
              </div>
              {analysis.folders.length === 0 ? (
                <div style={{ padding: '0 20px 20px', color: 'var(--text-muted)', fontSize: 13 }}>No subdirectories under this path.</div>
              ) : (
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {analysis.folders.map(folder => (
                    <button
                      key={folder.path}
                      onClick={() => runScan(folder.path)}
                      disabled={scanning}
                      style={{
                        width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                        borderTop: '1px solid var(--border)', padding: '10px 20px',
                        cursor: scanning ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 14,
                      }}
                      title={`Drill into ${folder.path}`}
                    >
                      <div style={{ flex: '1 1 40%', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 6, height: 6, background: categoryColor(folder.category), flexShrink: 0 }} />
                          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
                          <CategoryBadge name={folder.category} />
                        </div>
                      </div>
                      <div style={{ flex: '1 1 30%', minWidth: 80 }}>
                        <UsageBar percent={folder.percent} color={categoryColor(folder.category)} />
                      </div>
                      <div style={{ width: 90, textAlign: 'right', fontFamily: MONO, fontSize: 13, fontWeight: 800 }}>{fmtKB(folder.size_kb)}</div>
                      <div style={{ width: 56, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: 'var(--text-muted)' }}>{folder.percent.toFixed(1)}%</div>
                      <ChevronRight size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Files */}
            <div>
              <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <FileText size={14} color="var(--brand-primary)" />
                <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: MONO }}>Largest files</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO }}>({analysis.files.length})</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  only files ≥ {fmtKB(analysis.file_min_size_kb)}
                </span>
              </div>
              {analysis.files.length === 0 ? (
                <div style={{ padding: '0 20px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
                  No files at or above {fmtKB(analysis.file_min_size_kb)} under this path.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <THead headers={['File', 'Category', 'Size', 'Share', 'Modified', 'Owner']} sticky />
                    <tbody>
                      {analysis.files.map(file => (
                        <tr key={file.path} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ ...tdStyle, maxWidth: 420 }}>
                            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.path}</div>
                          </td>
                          <td style={tdStyle}><CategoryBadge name={file.category} /></td>
                          <td style={{ ...tdStyle, fontWeight: 800 }}>{fmtKB(file.size_kb)}</td>
                          <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{file.percent.toFixed(1)}%</td>
                          <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{file.modified || '—'}</td>
                          <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{file.owner || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </SectionCard>

      {/* Block devices */}
      {info.devices.length > 0 && (
        <SectionCard icon={Layers} title="Block Devices" count={info.devices.length}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <THead headers={['Name', 'Type', 'Size', 'Filesystem', 'Mountpoint', 'Model']} />
              <tbody>
                {info.devices.map((dev, i) => (
                  <tr key={`${dev.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Hash size={12} color="var(--text-muted)" />
                        {dev.name}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{dev.type || '—'}</td>
                    <td style={tdStyle}>{dev.size || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{dev.fstype || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{dev.mountpoint || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dev.model || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
