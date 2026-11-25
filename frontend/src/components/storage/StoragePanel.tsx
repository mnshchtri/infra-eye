import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, ButtonBase, IconButton, MenuItem, TableCell, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import {
  HardDrive, Database, FolderTree, FileText, Layers, Gauge,
  ChevronRight, RefreshCw, Search, AlertTriangle, CornerLeftUp, Hash,
} from 'lucide-react'
import { api } from '../../api/client'
import { errMessage } from '../../utils/errors'
import { useToastStore } from '../../store/toastStore'
import { Button } from '../ui'
import {
  CenteredSpinner, DataTable, Dot, LoadFailed, MonoCell, SectionCard, Tile, TileGrid, UsageBar,
} from '../server/ServerParts'
import { MONO } from '../server/tokens'
import { fmtKB, usageTone, categoryColor, pathCrumbs } from './format'
import type { StorageInfo, StorageAnalysis, FilesystemInfo } from './types'

function CategoryBadge({ name }: { name: string }) {
  const c = categoryColor(name)
  return (
    <Box
      component="span"
      sx={{
        px: 0.875, py: 0.125, fontSize: '0.6875rem', fontWeight: 600, borderRadius: 1, whiteSpace: 'nowrap',
        bgcolor: `${c}22`, color: 'text.primary', border: 1, borderColor: `${c}66`,
      }}
    >
      {name}
    </Box>
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
    <Box sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="subtitle2">Consumption by category</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>{fmtKB(totalKB)} total</Typography>
      </Box>
      <Box sx={{ display: 'flex', height: 14, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        {shown.map((cat, i) => (
          <Tooltip key={cat.name} title={`${cat.name} - ${fmtKB(cat.size_kb)} (${cat.percent.toFixed(1)}%)`}>
            <Box sx={{ width: `${Math.max(cat.percent, 0.4)}%`, bgcolor: categoryColor(cat.name, i), transition: 'width 0.3s' }} />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.75, mt: 1.5 }}>
        {shown.map((cat, i) => (
          <Box key={cat.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.875 }}>
            <Dot color={categoryColor(cat.name, i)} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{cat.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>
              {fmtKB(cat.size_kb)} · {cat.percent.toFixed(1)}%
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
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

  if (loading && !info) return <CenteredSpinner />

  if (!info || loadFailed) {
    return <LoadFailed icon={HardDrive} message="Unable to load storage data" onRetry={reloadInventory} />
  }

  const { totals } = info
  const busiest = info.filesystems.reduce<FilesystemInfo | null>(
    (worst, fs) => (!worst || fs.use_percent > worst.use_percent ? fs : worst), null,
  )
  const crumbs = pathCrumbs(analysis?.path || pathInput)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Summary */}
      <TileGrid>
        <Tile label="Total capacity" value={fmtKB(totals.size_kb)} sub={`${totals.mounts} mount${totals.mounts === 1 ? '' : 's'}`} icon={HardDrive} />
        <Tile label="Used" value={`${totals.use_percent.toFixed(1)}%`} sub={fmtKB(totals.used_kb)} icon={Gauge} accent={`${usageTone(totals.use_percent)}.main`} />
        <Tile label="Free" value={fmtKB(totals.avail_kb)} icon={Database} accent="success.main" />
        <Tile
          label="Fullest mount"
          value={busiest ? `${busiest.use_percent.toFixed(0)}%` : '—'}
          sub={busiest?.mountpoint}
          icon={AlertTriangle}
          accent={busiest ? `${usageTone(busiest.use_percent)}.main` : undefined}
        />
      </TileGrid>

      {info.warnings.length > 0 && (
        <Alert severity="warning" variant="outlined" icon={<AlertTriangle size={16} />}>
          {info.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </Alert>
      )}

      {/* Filesystems: the per-mount answer to "what is consuming this disk" */}
      <SectionCard
        icon={HardDrive}
        title="Filesystems"
        count={info.filesystems.length}
        action={
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={reloadInventory} disabled={loading} aria-label="Refresh filesystems"><RefreshCw size={14} /></IconButton>
            </span>
          </Tooltip>
        }
      >
        {info.filesystems.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No filesystems reported</Box>
        ) : (
          <DataTable label="Filesystems" headers={['Mount', 'Device', 'Type', 'Usage', 'Used', 'Free', 'Size', 'Inodes', '']}>
            {info.filesystems.map((fs, i) => {
              const tone = usageTone(fs.use_percent)
              return (
                <TableRow key={`${fs.device}-${fs.mountpoint}-${i}`} hover>
                  <MonoCell bold>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Dot tone={tone} />
                      <span>{fs.mountpoint}</span>
                    </Box>
                    {fs.options && (
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25, maxWidth: 240 }}>
                        {fs.options}
                      </Typography>
                    )}
                  </MonoCell>
                  <MonoCell muted sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fs.device}</MonoCell>
                  <MonoCell muted>{fs.fstype || '—'}</MonoCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box sx={{ flex: 1 }}><UsageBar percent={fs.use_percent} tone={tone} /></Box>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: `${tone}.main`, fontFamily: MONO }}>{fs.use_percent.toFixed(0)}%</Typography>
                    </Box>
                  </TableCell>
                  <MonoCell>{fmtKB(fs.used_kb)}</MonoCell>
                  <MonoCell muted>{fmtKB(fs.avail_kb)}</MonoCell>
                  <MonoCell muted>{fmtKB(fs.size_kb)}</MonoCell>
                  <MonoCell>
                    {fs.inodes_total > 0 ? (
                      <Box component="span" sx={{ color: fs.inodes_percent >= 90 ? 'error.main' : 'text.secondary' }}>
                        {fs.inodes_percent.toFixed(0)}%
                        <Box component="span" sx={{ color: 'text.secondary' }}> of {fs.inodes_total.toLocaleString()}</Box>
                      </Box>
                    ) : '—'}
                  </MonoCell>
                  <TableCell align="right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => runScan(fs.mountpoint)}
                      disabled={scanning}
                      icon={<Search size={13} />}
                      title={`Analyze what is consuming ${fs.mountpoint}`}
                    >
                      Analyze
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </DataTable>
        )}
      </SectionCard>

      {/* Path explorer */}
      <SectionCard icon={FolderTree} title="Path analyzer">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !scanning) runScan(pathInput) }}
            placeholder={rootPath}
            spellCheck={false}
            sx={{ flex: 1, minWidth: 220 }}
            slotProps={{ htmlInput: { 'aria-label': 'Path to analyze', style: { fontFamily: MONO } } }}
          />
          <TextField
            select
            value={minFileKB}
            onChange={e => setMinFileKB(Number(e.target.value))}
            sx={{ width: 160 }}
            slotProps={{ htmlInput: { 'aria-label': 'Minimum file size' } }}
            title="Ignore files smaller than this"
          >
            <MenuItem value={1024}>Files ≥ 1 MB</MenuItem>
            <MenuItem value={10240}>Files ≥ 10 MB</MenuItem>
            <MenuItem value={102400}>Files ≥ 100 MB</MenuItem>
            <MenuItem value={1048576}>Files ≥ 1 GB</MenuItem>
          </TextField>
          <TextField
            select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            sx={{ width: 120 }}
            slotProps={{ htmlInput: { 'aria-label': 'Row limit' } }}
            title="How many rows to return"
          >
            <MenuItem value={20}>Top 20</MenuItem>
            <MenuItem value={50}>Top 50</MenuItem>
            <MenuItem value={100}>Top 100</MenuItem>
          </TextField>
          <Button onClick={() => runScan(pathInput)} loading={scanning} icon={<Search size={14} />}>
            {scanning ? `Scanning… ${elapsed}s` : 'Analyze'}
          </Button>
        </Box>

        {/* Breadcrumbs: drilling down is just another scan of a deeper path */}
        {(analysis || scanning) && (
          <Box sx={{ px: 2.5, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {analysis?.parent && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => runScan(analysis.parent)}
                disabled={scanning}
                icon={<CornerLeftUp size={13} />}
                title="Analyze the parent directory"
                style={{ marginRight: 8 }}
              >
                Up
              </Button>
            )}
            {crumbs.map((crumb, i) => (
              <Box key={crumb.path} component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {i > 0 && <ChevronRight size={12} />}
                <ButtonBase
                  onClick={() => runScan(crumb.path)}
                  disabled={scanning}
                  sx={{
                    fontFamily: MONO, fontSize: 12, px: 0.5, py: 0.25, borderRadius: 0.5,
                    fontWeight: i === crumbs.length - 1 ? 700 : 500,
                    color: i === crumbs.length - 1 ? 'primary.main' : 'text.secondary',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {crumb.label}
                </ButtonBase>
              </Box>
            ))}
          </Box>
        )}

        {scanning && !analysis && (
          <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
            <CenteredSpinner size={28} py={1} />
            <Typography variant="body1" sx={{ fontFamily: MONO }}>Walking {pathInput} - {elapsed}s</Typography>
            <Typography variant="body2" sx={{ mt: 0.75 }}>Directory sizes come from a live du/find walk, so a large tree takes a while.</Typography>
          </Box>
        )}

        {!scanning && !analysis && (
          <Box sx={{ py: 6, px: 2, textAlign: 'center', color: 'text.secondary' }}>
            <FolderTree size={30} />
            <Typography variant="body1" sx={{ mt: 1 }}>
              Pick a path (or hit <strong>Analyze</strong> on a mount above) to see which folders, files and data categories are consuming it.
            </Typography>
          </Box>
        )}

        {analysis && (
          <>
            {/* Where this path physically lives */}
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider', display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', bgcolor: 'action.hover' }}>
              {[
                { label: 'Scanned', value: fmtKB(analysis.total_kb) },
                { label: 'On mount', value: analysis.mountpoint || '—' },
                { label: 'Device', value: analysis.device || '—' },
                { label: 'Mount used', value: analysis.mount_size_kb > 0 ? `${fmtKB(analysis.mount_used_kb)} / ${fmtKB(analysis.mount_size_kb)}` : '—' },
                { label: 'Share of mount', value: analysis.mount_used_kb > 0 ? `${((analysis.total_kb / analysis.mount_used_kb) * 100).toFixed(1)}%` : '—' },
                { label: 'Scan time', value: `${(analysis.duration_ms / 1000).toFixed(1)}s` },
              ].map(item => (
                <Box key={item.label}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{item.label}</Typography>
                  <Typography variant="body1" sx={{ fontFamily: MONO, fontWeight: 600, maxWidth: 260 }} noWrap>{item.value}</Typography>
                </Box>
              ))}
            </Box>

            <CategoryBreakdown categories={analysis.categories} totalKB={analysis.total_kb} />

            {analysis.warnings.length > 0 && (
              <Alert severity="warning" variant="outlined" icon={<AlertTriangle size={14} />} sx={{ m: 2 }}>
                {analysis.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}

            {/* Folders */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ display: 'inline-flex', color: 'primary.main' }}><FolderTree size={14} /></Box>
                <Typography variant="subtitle2">Largest folders</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>({analysis.folders.length})</Typography>
              </Box>
              {analysis.folders.length === 0 ? (
                <Typography variant="body1" color="text.secondary" sx={{ px: 2.5, pb: 2.5 }}>No subdirectories under this path.</Typography>
              ) : (
                <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
                  {analysis.folders.map(folder => (
                    <ButtonBase
                      key={folder.path}
                      onClick={() => runScan(folder.path)}
                      disabled={scanning}
                      title={`Drill into ${folder.path}`}
                      sx={{
                        width: '100%', textAlign: 'left', borderTop: 1, borderColor: 'divider', px: 2.5, py: 1.25,
                        display: 'flex', alignItems: 'center', gap: 1.75, justifyContent: 'flex-start',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Box sx={{ flex: '1 1 40%', minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Dot color={categoryColor(folder.category)} />
                        <Typography noWrap sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{folder.name}</Typography>
                        <CategoryBadge name={folder.category} />
                      </Box>
                      <Box sx={{ flex: '1 1 30%', minWidth: 80 }}>
                        <UsageBar percent={folder.percent} color={categoryColor(folder.category)} />
                      </Box>
                      <Typography sx={{ width: 90, textAlign: 'right', fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{fmtKB(folder.size_kb)}</Typography>
                      <Typography color="text.secondary" sx={{ width: 56, textAlign: 'right', fontFamily: MONO, fontSize: 12 }}>{folder.percent.toFixed(1)}%</Typography>
                      <ChevronRight size={14} style={{ flexShrink: 0 }} />
                    </ButtonBase>
                  ))}
                </Box>
              )}
            </Box>

            {/* Files */}
            <Box>
              <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'inline-flex', color: 'primary.main' }}><FileText size={14} /></Box>
                <Typography variant="subtitle2">Largest files</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>({analysis.files.length})</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                  only files ≥ {fmtKB(analysis.file_min_size_kb)}
                </Typography>
              </Box>
              {analysis.files.length === 0 ? (
                <Typography variant="body1" color="text.secondary" sx={{ px: 2.5, pb: 2.5 }}>
                  No files at or above {fmtKB(analysis.file_min_size_kb)} under this path.
                </Typography>
              ) : (
                <DataTable label="Largest files" headers={['File', 'Category', 'Size', 'Share', 'Modified', 'Owner']} maxHeight={420}>
                  {analysis.files.map(file => (
                    <TableRow key={file.path} hover>
                      <MonoCell sx={{ maxWidth: 420 }}>
                        <Typography noWrap sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{file.name}</Typography>
                        <Typography noWrap variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: MONO }}>{file.path}</Typography>
                      </MonoCell>
                      <TableCell><CategoryBadge name={file.category} /></TableCell>
                      <MonoCell bold>{fmtKB(file.size_kb)}</MonoCell>
                      <MonoCell muted>{file.percent.toFixed(1)}%</MonoCell>
                      <MonoCell muted>{file.modified || '—'}</MonoCell>
                      <MonoCell muted>{file.owner || '—'}</MonoCell>
                    </TableRow>
                  ))}
                </DataTable>
              )}
            </Box>
          </>
        )}
      </SectionCard>

      {/* Block devices */}
      {info.devices.length > 0 && (
        <SectionCard icon={Layers} title="Block devices" count={info.devices.length}>
          <DataTable label="Block devices" headers={['Name', 'Type', 'Size', 'Filesystem', 'Mountpoint', 'Model']}>
            {info.devices.map((dev, i) => (
              <TableRow key={`${dev.name}-${i}`} hover>
                <MonoCell bold>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Hash size={12} />
                    {dev.name}
                  </Box>
                </MonoCell>
                <MonoCell muted>{dev.type || '—'}</MonoCell>
                <MonoCell>{dev.size || '—'}</MonoCell>
                <MonoCell muted>{dev.fstype || '—'}</MonoCell>
                <MonoCell muted>{dev.mountpoint || '—'}</MonoCell>
                <MonoCell muted sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dev.model || '—'}</MonoCell>
              </TableRow>
            ))}
          </DataTable>
        </SectionCard>
      )}
    </Box>
  )
}
