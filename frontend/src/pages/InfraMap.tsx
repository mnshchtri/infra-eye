import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, Boxes, Database, Zap, Layers, HardDrive, Globe, Cpu, Eye,
  Download, RefreshCw, Radar, ZoomIn, ZoomOut, Maximize, Loader2, AlertTriangle,
  Network, Folder, ScanSearch, Wifi, Search, X,
} from 'lucide-react'
import { api } from '../api/client'
import { useUIStore } from '../store/uiStore'
import { useToastStore } from '../store/toastStore'
import { Button } from '../components/ui'
import { saveFile } from '../utils/saveFile'

// ── Topology API shapes (mirror backend handlers/topology.go) ──

interface TNode {
  id: string
  kind: 'core' | 'server' | 'cluster' | 'resource' | 'k8s_node' | 'discovered'
  ref_id?: number
  name: string
  host?: string
  port?: number
  status?: string
  os?: string
  resource_type?: string
  protocol?: string
  folder_id?: number | null
  tags?: string[]
  detail?: string
  networks?: string[]
}

interface TEdge {
  source: string
  target: string
  kind: 'manage' | 'hosted_on' | 'network' | 'member' | 'discovered'
  label?: string
}

interface TFolder { id: number; name: string; color?: string }

interface TNetwork {
  id: string
  cidr: string
  label: string
  kind: 'private' | 'vpn' | 'public' | 'loopback'
  source?: string
}

interface Topology {
  generated_at: string
  live: boolean
  folders: TFolder[]
  networks: TNetwork[]
  nodes: TNode[]
  edges: TEdge[]
  notes?: string[]
}

type GroupMode = 'network' | 'folder'

// ── Layout geometry ──

interface Box { x: number; y: number; w: number; h: number }
interface GroupBox extends Box { label: string; color: string; key: string; count: number; collapsed: boolean }
interface ChipBox { box: Box; key: string; label: string; color: string; count: number }

const SIZE: Record<TNode['kind'], { w: number; h: number }> = {
  core: { w: 230, h: 76 },
  server: { w: 230, h: 66 },
  cluster: { w: 230, h: 66 },
  resource: { w: 210, h: 60 },
  k8s_node: { w: 200, h: 50 },
  discovered: { w: 210, h: 50 },
}

const NODE_GAP = 16
const GROUP_PAD = 14
const GROUP_HEADER = 26
const GROUP_GAP = 34
const COL_X = [56, 470, 900]
const TOP_MARGIN = 96 // leaves room for the title block
const BOTTOM_MARGIN = 48
const COLLAPSED_GROUP_H = 40
// Zones bigger than this default to collapsed when "Compact" is clicked —
// past ~6 stacked nodes a zone stops reading as a shape and starts reading
// as a wall of boxes, which is exactly the "too many servers" complaint.
const AUTO_COLLAPSE_THRESHOLD = 6

function resourceIcon(type?: string) {
  switch (type) {
    case 'database': return Database
    case 'cache': return Zap
    case 'queue': return Layers
    case 'storage': return HardDrive
    case 'service': return Globe
    default: return Cpu
  }
}

function nodeIcon(n: TNode) {
  switch (n.kind) {
    case 'core': return Eye
    case 'server': return Server
    case 'cluster': return Boxes
    case 'k8s_node': return Cpu
    case 'discovered': return Wifi
    case 'resource': return resourceIcon(n.resource_type)
  }
}

// The map is drawn with literal colors (not var() references) so the SVG can
// be exported as a standalone file. Colors are resolved from the CSS variables
// on the root element.
function readPalette() {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fb: string) => (cs.getPropertyValue(name) || '').trim() || fb
  return {
    bg: v('--bg-app', '#f0f0f0'),
    card: v('--bg-card', '#ffffff'),
    elevated: v('--bg-elevated', '#f5f5f5'),
    border: v('--border', '#d2d2d2'),
    borderLight: v('--border-light', '#ededed'),
    text: v('--text-primary', '#151515'),
    textSec: v('--text-secondary', '#6a6e73'),
    textMuted: v('--text-muted', '#a2a3a4'),
    brand: v('--brand-primary', '#0066cc'),
    success: v('--success', '#3e8635'),
    warning: v('--warning', '#f0ab00'),
    danger: v('--danger', '#c9190b'),
    info: v('--info', '#2b9af3'),
    purple: v('--accent-purple', '#8b5cf6'),
    cyan: v('--accent-cyan', '#06b6d4'),
  }
}

function useCssPalette() {
  const { darkMode } = useUIStore()
  const [palette, setPalette] = useState(readPalette)
  // useThemeSync flips the `dark` class on <html> in the parent Layout's
  // effect, which runs AFTER this component's effects — so re-read the
  // variables one frame later, once the class change has landed.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPalette(readPalette()))
    return () => cancelAnimationFrame(raf)
  }, [darkMode])
  return palette
}

function statusColor(status: string | undefined, p: ReturnType<typeof useCssPalette>) {
  switch (status) {
    case 'online': return p.success
    case 'degraded': return p.warning
    case 'offline': return p.danger
    default: return p.textMuted
  }
}

function edgeStyle(kind: TEdge['kind'], p: ReturnType<typeof useCssPalette>) {
  switch (kind) {
    case 'manage': return { stroke: p.brand, dash: undefined }
    case 'hosted_on': return { stroke: p.purple, dash: undefined }
    case 'network': return { stroke: p.cyan, dash: '6 4' }
    case 'member': return { stroke: p.info, dash: '2 3' }
    case 'discovered': return { stroke: p.textMuted, dash: '1 4' }
  }
}

// Column layout: InfraEye core on the left, servers/clusters in the middle,
// cluster nodes + resources on the right — a left-to-right "who manages /
// hosts what" blueprint. Columns are grouped into zones either by folder or
// by network segment; in network mode the same segment gets the same color
// in both columns, so "these machines share a network" reads at a glance.
function computeLayout(
  topo: Topology,
  mode: GroupMode,
  netColors: Record<string, string>,
  collapsedKeys: Set<string>,
) {
  const pos: Record<string, Box> = {}
  const groups: GroupBox[] = []
  const chips: ChipBox[] = []
  const hidden = new Set<string>()
  const nodeGroupKey: Record<string, string> = {}

  const folderName = (id?: number | null) =>
    topo.folders.find(f => f.id === id)?.name ?? 'Ungrouped'
  const folderColor = (id?: number | null, fb = '') =>
    topo.folders.find(f => f.id === id)?.color || fb

  const byFolder = (nodes: TNode[]) => {
    const order: (number | null)[] = [
      ...topo.folders.filter(f => nodes.some(n => n.folder_id === f.id)).map(f => f.id),
      ...(nodes.some(n => !n.folder_id) ? [null] : []),
    ]
    return order.map(fid => ({
      label: folderName(fid),
      color: folderColor(fid),
      nodes: nodes.filter(n => (n.folder_id ?? null) === (fid ?? null)),
    }))
  }

  // Placement uses the node's primary (first) network; multi-homed machines
  // list every segment in their tooltip.
  const primaryNet = (n: TNode) => n.networks?.[0] ?? null
  const byNetwork = (nodes: TNode[]) => {
    const order: (string | null)[] = [
      ...topo.networks.filter(nw => nodes.some(n => primaryNet(n) === nw.id)).map(nw => nw.id),
      ...(nodes.some(n => !primaryNet(n)) ? [null] : []),
    ]
    return order.map(nid => {
      const nw = topo.networks.find(x => x.id === nid)
      return {
        label: nw ? nw.label : 'no address / unresolved',
        color: nid ? netColors[nid] ?? '' : '',
        nodes: nodes.filter(n => primaryNet(n) === nid),
      }
    })
  }

  const groupBy = mode === 'network' ? byNetwork : byFolder

  const layoutColumn = (
    colX: number,
    colKey: string,
    groupDefs: { label: string; color: string; nodes: TNode[] }[],
  ) => {
    let y = TOP_MARGIN
    for (const g of groupDefs) {
      if (g.nodes.length === 0) continue
      const key = `${colKey}:${g.label}`
      const isCollapsed = collapsedKeys.has(key)
      const w = Math.max(...g.nodes.map(n => SIZE[n.kind].w))
      const startY = y
      y += GROUP_HEADER + GROUP_PAD
      if (isCollapsed) {
        const box: Box = { x: colX, y, w, h: COLLAPSED_GROUP_H }
        for (const n of g.nodes) {
          pos[n.id] = box
          nodeGroupKey[n.id] = key
          hidden.add(n.id)
        }
        chips.push({ box, key, label: g.label, color: g.color, count: g.nodes.length })
        y += COLLAPSED_GROUP_H
      } else {
        for (const n of g.nodes) {
          pos[n.id] = { x: colX, y, w: SIZE[n.kind].w, h: SIZE[n.kind].h }
          nodeGroupKey[n.id] = key
          y += SIZE[n.kind].h + NODE_GAP
        }
        y -= NODE_GAP
      }
      y += GROUP_PAD
      groups.push({
        x: colX - GROUP_PAD, y: startY, w: w + GROUP_PAD * 2, h: y - startY,
        label: g.label, color: g.color, key, count: g.nodes.length, collapsed: isCollapsed,
      })
      y += GROUP_GAP
    }
    return y - GROUP_GAP
  }

  const servers = topo.nodes.filter(n => n.kind === 'server' || n.kind === 'cluster')
  const resources = topo.nodes.filter(n => n.kind === 'resource')
  const k8sNodes = topo.nodes.filter(n => n.kind === 'k8s_node')
  const discovered = topo.nodes.filter(n => n.kind === 'discovered')

  const col1Bottom = layoutColumn(COL_X[1], 'servers', groupBy(servers))

  // Right column. Folder mode: each cluster's member nodes first, then
  // resources (and any nmap-discovered peers) grouped by folder. Network
  // mode: cluster nodes, resources and discovered peers are all zoned
  // together by segment — a K8s node or an undiscovered device sharing a
  // subnet with a database shows up in the same zone.
  let col2Groups
  if (mode === 'network') {
    col2Groups = byNetwork([...k8sNodes, ...resources, ...discovered])
  } else {
    const clusterGroups = servers
      .filter(s => s.kind === 'cluster')
      .map(cl => ({
        label: `${cl.name} · nodes`,
        color: '',
        nodes: k8sNodes.filter(n => n.ref_id === cl.ref_id),
      }))
      .filter(g => g.nodes.length > 0)
    const discoveredGroup = discovered.length > 0
      ? [{ label: 'discovered · unmanaged', color: '', nodes: discovered }]
      : []
    col2Groups = [...clusterGroups, ...byFolder(resources), ...discoveredGroup]
  }
  const col2Bottom = layoutColumn(COL_X[2], 'right', col2Groups)

  const contentH = Math.max(col1Bottom, col2Bottom, TOP_MARGIN + 200) + BOTTOM_MARGIN

  // Core node vertically centered on the server column.
  const core = topo.nodes.find(n => n.kind === 'core')
  if (core) {
    const mid = Math.max(col1Bottom, TOP_MARGIN + 200) / 2 + TOP_MARGIN / 2
    pos[core.id] = { x: COL_X[0], y: mid - SIZE.core.h / 2, w: SIZE.core.w, h: SIZE.core.h }
  }

  const contentW = COL_X[2] + Math.max(SIZE.resource.w, SIZE.k8s_node.w) + GROUP_PAD + 60
  return { pos, groups, chips, hidden, nodeGroupKey, contentW, contentH }
}

function edgePath(s: Box, t: Box): { d: string; mid: [number, number] } {
  const sr: [number, number] = [s.x + s.w, s.y + s.h / 2]
  const sl: [number, number] = [s.x, s.y + s.h / 2]
  const tr: [number, number] = [t.x + t.w, t.y + t.h / 2]
  const tl: [number, number] = [t.x, t.y + t.h / 2]

  if (t.x >= s.x + s.w) {
    const dx = (tl[0] - sr[0]) / 2
    return {
      d: `M ${sr[0]} ${sr[1]} C ${sr[0] + dx} ${sr[1]}, ${tl[0] - dx} ${tl[1]}, ${tl[0]} ${tl[1]}`,
      mid: [(sr[0] + tl[0]) / 2, (sr[1] + tl[1]) / 2 - 6],
    }
  }
  if (s.x >= t.x + t.w) {
    const dx = (sl[0] - tr[0]) / 2
    return {
      d: `M ${sl[0]} ${sl[1]} C ${sl[0] - dx} ${sl[1]}, ${tr[0] + dx} ${tr[1]}, ${tr[0]} ${tr[1]}`,
      mid: [(sl[0] + tr[0]) / 2, (sl[1] + tr[1]) / 2 - 6],
    }
  }
  // Same column (e.g. observed server↔server traffic): bulge out to the right.
  const bulge = 70 + Math.abs(tr[1] - sr[1]) * 0.08
  return {
    d: `M ${sr[0]} ${sr[1]} C ${sr[0] + bulge} ${sr[1]}, ${tr[0] + bulge} ${tr[1]}, ${tr[0]} ${tr[1]}`,
    mid: [sr[0] + bulge * 0.75, (sr[1] + tr[1]) / 2],
  }
}

export function InfraMap() {
  const navigate = useNavigate()
  const toast = useToastStore()
  const p = useCssPalette()

  const [topo, setTopo] = useState<Topology | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [liveMode, setLiveMode] = useState(false)
  const [discoverMode, setDiscoverMode] = useState(false)
  const [error, setError] = useState('')
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [groupMode, setGroupMode] = useState<GroupMode>('network')
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null)

  // One stable color per network segment, cycled from the accent palette.
  const netColors = useMemo(() => {
    const cycle = [p.brand, p.purple, p.cyan, p.success, p.warning, p.info, p.danger]
    const map: Record<string, string> = {}
    topo?.networks?.forEach((nw, i) => { map[nw.id] = cycle[i % cycle.length] })
    return map
  }, [topo, p])

  // Switching how zones are grouped invalidates old collapse keys outright
  // (a folder-mode key means nothing in network mode) — reset them as a
  // render-time state adjustment rather than an effect, per React's guidance
  // for state that depends on a prop/state change (avoids the extra commit
  // an effect-based reset would cost).
  const [collapseResetFor, setCollapseResetFor] = useState(groupMode)
  if (collapseResetFor !== groupMode) {
    setCollapseResetFor(groupMode)
    setCollapsedGroups(new Set())
  }

  const baseLayout = useMemo(
    () => (topo ? computeLayout(topo, groupMode, netColors, collapsedGroups) : null),
    [topo, groupMode, netColors, collapsedGroups],
  )

  const neighbors = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const e of topo?.edges ?? []) {
      ;(map[e.source] ??= new Set()).add(e.target)
      ;(map[e.target] ??= new Set()).add(e.source)
    }
    return map
  }, [topo])

  // Matches are pinned (unlike hover) so tracing a specific server's
  // correlations doesn't require holding the mouse still over a tiny box.
  const matchIds = useMemo(() => {
    const q = search.trim().toLowerCase()
    const set = new Set<string>()
    if (!q || !topo) return set
    for (const n of topo.nodes) {
      if (
        n.name.toLowerCase().includes(q) ||
        n.host?.toLowerCase().includes(q) ||
        n.tags?.some(t => t.toLowerCase().includes(q))
      ) {
        set.add(n.id)
      }
    }
    return set
  }, [topo, search])

  const searchNeighborIds = useMemo(() => {
    const set = new Set<string>()
    matchIds.forEach(id => neighbors[id]?.forEach(nb => set.add(nb)))
    return set
  }, [matchIds, neighbors])

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const compactView = useCallback(() => {
    if (!baseLayout) return
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      baseLayout.groups.forEach(g => { if (g.count > AUTO_COLLAPSE_THRESHOLD) next.add(g.key) })
      return next
    })
  }, [baseLayout])

  // A search match hidden inside a collapsed zone is worse than no search at
  // all — derive a layout with those zones force-expanded rather than
  // mutating collapsedGroups itself, so the user's manual collapses survive
  // once the search is cleared.
  const layout = useMemo(() => {
    if (!baseLayout || !topo || matchIds.size === 0) return baseLayout
    const forceExpand = new Set<string>()
    matchIds.forEach(id => {
      if (baseLayout.hidden.has(id)) {
        const key = baseLayout.nodeGroupKey[id]
        if (key) forceExpand.add(key)
      }
    })
    if (forceExpand.size === 0) return baseLayout
    const effectiveCollapsed = new Set(collapsedGroups)
    forceExpand.forEach(k => effectiveCollapsed.delete(k))
    return computeLayout(topo, groupMode, netColors, effectiveCollapsed)
  }, [baseLayout, topo, groupMode, netColors, collapsedGroups, matchIds])

  const fetchTopology = useCallback(async (live: boolean, discover: boolean) => {
    if (live) setScanning(true)
    else setLoading(true)
    setError('')
    try {
      const params = live ? `?live=true${discover ? '&discover=true' : ''}` : ''
      const res = await api.get(`/api/topology${params}`)
      setTopo(res.data)
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setError(err.response?.data?.error || err.message || 'Failed to load topology')
    } finally {
      setLoading(false)
      setScanning(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, matches every other page
  useEffect(() => { fetchTopology(false, false) }, [fetchTopology])

  const fitView = useCallback(() => {
    if (!layout || !containerRef.current) return
    const { clientWidth: cw, clientHeight: ch } = containerRef.current
    const k = Math.min(cw / layout.contentW, ch / layout.contentH, 1.15)
    setView({
      x: (cw - layout.contentW * k) / 2,
      y: Math.max((ch - layout.contentH * k) / 2, 8),
      k,
    })
  }, [layout])

  // Fit whenever the graph's shape changes (first load, live scan adds nodes).
  useEffect(() => { fitView() }, [fitView])

  // Native wheel listener: React's onWheel is passive, so preventDefault (to
  // stop the page scrolling while zooming the map) needs a manual binding.
  // Depends on loading/error because the canvas div only exists once the
  // topology has loaded — binding on mount would grab nothing.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = ev.clientX - rect.left
      const my = ev.clientY - rect.top
      // Trackpad pinch arrives as ctrl+wheel with fine deltas; plain
      // two-finger scroll and mouse wheels zoom too, maps-style, always
      // centered on the pointer.
      const factor = Math.exp(-ev.deltaY * (ev.ctrlKey || ev.metaKey ? 0.012 : 0.0022))
      setView(v => {
        const k = Math.min(3, Math.max(0.15, v.k * factor))
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loading, error])

  const [dragging, setDragging] = useState(false)
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y }
    setDragging(true)
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    setView(v => ({ ...v, x: d.viewX + (e.clientX - d.startX), y: d.viewY + (e.clientY - d.startY) }))
  }
  const onMouseUp = () => { dragRef.current = null; setDragging(false) }

  const zoomBy = (factor: number) => {
    const el = containerRef.current
    if (!el) return
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    setView(v => {
      const k = Math.min(3, Math.max(0.15, v.k * factor))
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k }
    })
  }

  const openNode = (n: TNode) => {
    switch (n.kind) {
      case 'server': navigate(`/servers/${n.ref_id}`); break
      case 'cluster': case 'k8s_node': navigate('/kubernetes'); break
      case 'resource': navigate(`/resources/${n.ref_id}`); break
    }
  }

  // ── Export ──

  const buildSvgString = () => {
    if (!svgRef.current || !layout) return ''
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(layout.contentW))
    clone.setAttribute('height', String(layout.contentH))
    clone.setAttribute('viewBox', `0 0 ${layout.contentW} ${layout.contentH}`)
    const vp = clone.querySelector('#inframap-viewport')
    vp?.setAttribute('transform', '')
    return new XMLSerializer().serializeToString(clone)
  }

  const stamp = () => new Date().toISOString().slice(0, 10)

  const exportBlob = async (blob: Blob, filename: string) => {
    try {
      const result = await saveFile(blob, filename)
      if (result === 'saved') toast.success('Blueprint saved', filename)
    } catch {
      toast.error('Export failed', `Could not save ${filename}.`)
    }
  }

  const downloadSvg = () => {
    const s = buildSvgString()
    if (!s) return
    void exportBlob(new Blob([s], { type: 'image/svg+xml;charset=utf-8' }), `infraeye-blueprint-${stamp()}.svg`)
  }

  const downloadPng = () => {
    const s = buildSvgString()
    if (!s || !layout) return
    const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml;charset=utf-8' }))
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = layout.contentW * scale
      canvas.height = layout.contentH * scale
      const ctx = canvas.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(b => b && void exportBlob(b, `infraeye-blueprint-${stamp()}.png`), 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      toast.error('Export failed', 'Could not rasterize the blueprint — try the SVG export instead.')
    }
    img.src = url
  }

  const downloadJson = () => {
    if (!topo) return
    void exportBlob(
      new Blob([JSON.stringify(topo, null, 2)], { type: 'application/json' }),
      `infraeye-blueprint-${stamp()}.json`,
    )
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={28} className="spinner" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="empty-state">
          <AlertTriangle size={28} />
          <p>{error}</p>
          <Button variant="secondary" onClick={() => fetchTopology(liveMode, discoverMode)}>Retry</Button>
        </div>
      </div>
    )
  }

  const nodes = topo?.nodes ?? []
  const edges = topo?.edges ?? []
  const netLabel = (id: string) => topo?.networks.find(nw => nw.id === id)?.label ?? id
  const hasInfra = nodes.some(n => n.kind !== 'core')
  const connectedTo = (id: string) => hoverId === id || (hoverId != null && (neighbors[hoverId]?.has(id) ?? false))
  const searchActive = matchIds.size > 0
  // Hover wins when present (precise, momentary); otherwise a pinned search
  // takes over so tracing correlations doesn't need a steady mouse.
  const isRelevant = (id: string) => {
    if (hoverId != null) return connectedTo(id)
    if (searchActive) return matchIds.has(id) || searchNeighborIds.has(id)
    return true
  }
  const serverCount = nodes.filter(n => n.kind === 'server').length
  const clusterCount = nodes.filter(n => n.kind === 'cluster').length
  const resourceCount = nodes.filter(n => n.kind === 'resource').length
  const discoveredCount = nodes.filter(n => n.kind === 'discovered').length

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', paddingBottom: 0 }}>
      {/* Header — kept to a single compact row so the canvas gets the page */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
          <h1 className="page-title" style={{ fontSize: 22, margin: 0 }}>Infra Map</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            servers, clusters, resources & the networks that join them
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a server…"
              title="Highlight a node and its direct connections — matches also auto-expand a collapsed zone"
              style={{
                padding: '5px 26px 5px 27px', fontSize: 12, borderRadius: 7, width: 150,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                title="Clear search"
                style={{
                  position: 'absolute', right: 6, display: 'flex', background: 'none', border: 'none',
                  color: 'var(--text-muted)', cursor: 'pointer', padding: 2,
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <Button
              variant={groupMode === 'network' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setGroupMode('network')}
              title="Zone machines by the network segment they sit on"
            >
              <Network size={14} /> Networks
            </Button>
            <Button
              variant={groupMode === 'folder' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setGroupMode('folder')}
              title="Zone machines by their InfraEye folder"
            >
              <Folder size={14} /> Folders
            </Button>
          </div>
          <Button
            variant={collapsedGroups.size > 0 ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => (collapsedGroups.size > 0 ? setCollapsedGroups(new Set()) : compactView())}
            title={
              collapsedGroups.size > 0
                ? 'Expand every collapsed zone'
                : `Collapse zones with more than ${AUTO_COLLAPSE_THRESHOLD} nodes into summary chips`
            }
          >
            <Layers size={14} /> {collapsedGroups.size > 0 ? 'Expand all' : 'Compact'}
          </Button>
          <Button
            variant={liveMode ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              const next = !liveMode
              setLiveMode(next)
              if (!next) setDiscoverMode(false)
              fetchTopology(next, next && discoverMode)
            }}
            disabled={scanning}
            title="SSH into each server to map live TCP connections and enumerate cluster nodes"
          >
            {scanning ? <Loader2 size={14} className="spinner" /> : <Radar size={14} />}
            {scanning ? 'Scanning…' : liveMode ? 'Live scan: on' : 'Live scan'}
          </Button>
          <Button
            variant={discoverMode ? 'primary' : 'secondary'}
            size="sm"
            disabled={scanning || !liveMode}
            onClick={() => {
              const next = !discoverMode
              setDiscoverMode(next)
              if (next) toast.info('Discovering network…', 'Running an nmap ping sweep on each real segment — this actively probes your network.')
              fetchTopology(true, next)
            }}
            title={liveMode ? 'Ping-sweep each real network segment with nmap to find devices InfraEye doesn\'t manage' : 'Turn on Live scan first'}
          >
            <ScanSearch size={14} /> {discoverMode ? 'Discover: on' : 'Discover'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fetchTopology(liveMode, discoverMode)} disabled={scanning} title="Refresh">
            <RefreshCw size={14} />
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadPng} title="Download blueprint as PNG image">
            <Download size={14} /> PNG
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadSvg} title="Download blueprint as SVG vector">
            <Download size={14} /> SVG
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadJson} title="Download raw topology as JSON">
            <Download size={14} /> JSON
          </Button>
          {(topo?.notes?.length ?? 0) > 0 && (
            <Button
              variant="secondary" size="sm"
              onClick={() => setNotesOpen(o => !o)}
              style={{ borderColor: 'var(--warning)', color: 'var(--warning-dark)', position: 'relative' }}
              title="Scan issues"
            >
              <AlertTriangle size={14} /> {topo!.notes!.length} issue{topo!.notes!.length > 1 ? 's' : ''}
            </Button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          position: 'relative', flex: 1, minHeight: 0, borderRadius: 10, overflow: 'hidden',
          border: '1px solid var(--border)', background: 'var(--bg-app)',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {!hasInfra ? (
          <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Server size={28} />
            <p>No infrastructure yet — add servers, clusters or resources to see the blueprint.</p>
          </div>
        ) : layout && (
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            style={{ display: 'block', fontFamily: "'Inter Variable', Inter, sans-serif", userSelect: 'none' }}
          >
            <defs>
              <pattern id="inframap-grid" width={40} height={40} patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke={p.borderLight} strokeWidth={1} opacity={0.6} />
              </pattern>
            </defs>
            {/* Full-bleed grid: fixed to the viewport, not the content, so
                panning/zooming never runs out of grid at the edges. */}
            <rect width="100%" height="100%" fill={p.bg} />
            <rect width="100%" height="100%" fill="url(#inframap-grid)" />
            <g id="inframap-viewport" transform={`translate(${view.x},${view.y}) scale(${view.k})`}>

              {/* Title block */}
              <g>
                <text x={COL_X[0]} y={34} fill={p.text} fontSize={17} fontWeight={800} letterSpacing={0.5}>
                  INFRAEYE · INFRASTRUCTURE BLUEPRINT
                </text>
                <text x={COL_X[0]} y={54} fill={p.textSec} fontSize={11} fontFamily="'JetBrains Mono Variable', monospace">
                  {serverCount} servers · {clusterCount} clusters · {resourceCount} resources
                  {(topo?.networks?.length ?? 0) > 0 && ` · ${topo!.networks.length} network segments`}
                  {discoveredCount > 0 && ` · ${discoveredCount} discovered`}
                  {` · zoned by ${groupMode === 'network' ? 'network segment' : 'folder'}`}
                  {topo && ` · generated ${new Date(topo.generated_at).toLocaleString()}`}
                  {topo?.live ? ' · live network scan' : ''}
                  {topo?.live && discoverMode ? ' + nmap discovery' : ''}
                </text>
                <line x1={COL_X[0]} y1={64} x2={layout.contentW - 60} y2={64} stroke={p.border} strokeWidth={1} />
              </g>

              {/* Folder / cluster group frames — click the header to collapse a
                  zone into a summary chip, which is the main lever for
                  taming a blueprint with a lot of servers in it */}
              {layout.groups.map(g => (
                <g key={g.key} opacity={(hoverId != null || searchActive) ? 0.55 : 1}>
                  <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10}
                    fill={g.color || 'none'} fillOpacity={0.05}
                    stroke={g.color || p.border} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.8} />
                  <g
                    onClick={ev => { ev.stopPropagation(); toggleGroup(g.key) }}
                    onMouseDown={ev => ev.stopPropagation()}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect x={g.x} y={g.y} width={g.w} height={GROUP_HEADER} fill="transparent" />
                    <text x={g.x + 10} y={g.y + 17} fill={g.color || p.textSec} fontSize={10.5} fontWeight={700}>
                      {g.collapsed ? '▸' : '▾'}
                    </text>
                    <text x={g.x + 24} y={g.y + 17} fill={g.color || p.textSec} fontSize={10.5} fontWeight={700} letterSpacing={0.8}>
                      {g.label.toUpperCase()} · {g.count}
                    </text>
                  </g>
                </g>
              ))}

              {/* Collapsed zone summaries — every hidden member node still
                  shares this box's position, so edges to/from it bundle into
                  one line instead of vanishing */}
              {layout.chips.map(c => (
                <g
                  key={c.key}
                  opacity={(hoverId != null || searchActive) ? 0.35 : 1}
                  style={{ cursor: 'pointer', transition: 'opacity 120ms' }}
                  onClick={ev => { ev.stopPropagation(); toggleGroup(c.key) }}
                  onMouseDown={ev => ev.stopPropagation()}
                >
                  <rect x={c.box.x} y={c.box.y} width={c.box.w} height={c.box.h} rx={9}
                    fill={p.elevated} stroke={c.color || p.border} strokeWidth={1.2} strokeDasharray="3 3" />
                  <Boxes x={c.box.x + 12} y={c.box.y + c.box.h / 2 - 9} size={18} color={c.color || p.textSec} strokeWidth={2} />
                  <text x={c.box.x + 38} y={c.box.y + c.box.h / 2 + 4} fill={p.text} fontSize={12} fontWeight={700}>
                    {c.count} node{c.count > 1 ? 's' : ''} collapsed
                  </text>
                  <title>Click to expand</title>
                </g>
              ))}

              {/* Edges */}
              {edges.map((e, i) => {
                const s = layout.pos[e.source]
                const t = layout.pos[e.target]
                if (!s || !t) return null
                const st = edgeStyle(e.kind, p)
                const { d, mid } = edgePath(s, t)
                const active = hoverId != null
                  ? (e.source === hoverId || e.target === hoverId)
                  : searchActive
                    ? (matchIds.has(e.source) || matchIds.has(e.target))
                    : false
                const dim = (hoverId != null || searchActive) && !active
                return (
                  <g key={i} opacity={dim ? 0.12 : active ? 1 : 0.6}>
                    <path d={d} fill="none" stroke={st.stroke} strokeWidth={active ? 2.2 : 1.4} strokeDasharray={st.dash}>
                      <title>{`${e.kind}${e.label ? ` — ${e.label}` : ''}`}</title>
                    </path>
                    {e.label && active && (
                      <text x={mid[0]} y={mid[1]} fill={st.stroke} fontSize={10} textAnchor="middle"
                        fontFamily="'JetBrains Mono Variable', monospace" fontWeight={600}>
                        {e.label}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Nodes */}
              {nodes.map(n => {
                if (layout.hidden.has(n.id)) return null
                const b = layout.pos[n.id]
                if (!b) return null
                const Icon = nodeIcon(n)
                const sc = statusColor(n.status, p)
                const isCore = n.kind === 'core'
                const isDiscovered = n.kind === 'discovered'
                const dim = !isRelevant(n.id)
                const sub = isCore
                  ? 'control plane'
                  : isDiscovered
                    ? 'not managed by InfraEye'
                    : n.kind === 'resource'
                      ? `${n.protocol ?? n.resource_type ?? ''}${n.host ? ` · ${n.host}${n.port ? ':' + n.port : ''}` : ''}`
                      : n.detail || (n.host ? `${n.host}${n.port ? ':' + n.port : ''}` : n.kind === 'cluster' ? 'kubernetes cluster' : '')
                return (
                  <g
                    key={n.id}
                    opacity={(dim ? 0.3 : 1) * (isDiscovered ? 0.85 : 1)}
                    style={{ cursor: isCore || isDiscovered ? 'default' : 'pointer', transition: 'opacity 120ms' }}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={ev => { ev.stopPropagation(); openNode(n) }}
                    onMouseDown={ev => ev.stopPropagation()}
                  >
                    <title>
                      {[
                        n.name,
                        n.host && `${n.host}${n.port ? ':' + n.port : ''}`,
                        isDiscovered && 'found by nmap discovery scan — not a managed InfraEye node',
                        n.networks?.length ? `networks: ${n.networks.map(netLabel).join(', ')}` : null,
                      ].filter(Boolean).join('\n')}
                    </title>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={9}
                      fill={isCore ? p.brand : p.card}
                      stroke={hoverId === n.id ? p.brand : isCore ? p.brand : p.border}
                      strokeWidth={hoverId === n.id ? 1.8 : 1.2}
                      strokeDasharray={isDiscovered ? '4 3' : undefined} />
                    {!isCore && (
                      <rect x={b.x} y={b.y + 9} width={3.5} height={b.h - 18} rx={1.75} fill={isDiscovered ? p.textMuted : sc} />
                    )}
                    <Icon x={b.x + 14} y={b.y + b.h / 2 - 10} size={20} color={isCore ? '#ffffff' : isDiscovered ? p.textMuted : p.textSec} strokeWidth={2} />
                    <text x={b.x + 44} y={b.y + b.h / 2 - 3} fill={isCore ? '#ffffff' : isDiscovered ? p.textSec : p.text}
                      fontSize={13} fontWeight={700}>
                      {n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name}
                    </text>
                    {sub && (
                      <text x={b.x + 44} y={b.y + b.h / 2 + 13} fill={isCore ? 'rgba(255,255,255,0.75)' : p.textSec}
                        fontSize={10} fontFamily="'JetBrains Mono Variable', monospace">
                        {sub.length > 26 ? sub.slice(0, 25) + '…' : sub}
                      </text>
                    )}
                    {!isCore && !isDiscovered && n.status && (
                      <circle cx={b.x + b.w - 14} cy={b.y + 14} r={4} fill={sc}>
                        <title>{n.status}</title>
                      </circle>
                    )}
                    {/* Multi-homed: one dot per additional network segment */}
                    {(n.networks?.length ?? 0) > 1 && n.networks!.slice(1).map((nid, di) => (
                      <circle key={nid} cx={b.x + b.w - 14 - (di + 1) * 10} cy={b.y + b.h - 11} r={3.5}
                        fill={netColors[nid] ?? p.textMuted} stroke={p.card} strokeWidth={1}>
                        <title>{`also on ${netLabel(nid)}`}</title>
                      </circle>
                    ))}
                  </g>
                )
              })}

              {/* Legend */}
              <g transform={`translate(${COL_X[0]}, ${layout.contentH - 26})`}>
                {([
                  ['manage', 'managed by InfraEye'],
                  ['hosted_on', 'hosted on'],
                  ['network', 'observed connection'],
                  ['member', 'cluster member'],
                  ['discovered', 'nmap discovered'],
                ] as [TEdge['kind'], string][]).map(([kind, label], i) => {
                  const st = edgeStyle(kind, p)
                  return (
                    <g key={kind} transform={`translate(${i * 165}, 0)`}>
                      <line x1={0} y1={0} x2={26} y2={0} stroke={st.stroke} strokeWidth={2} strokeDasharray={st.dash} />
                      <text x={32} y={4} fill={p.textSec} fontSize={10.5}>{label}</text>
                    </g>
                  )
                })}
              </g>
            </g>
          </svg>
        )}

        {/* Network segment legend — only meaningful in Networks mode. Each
            entry states plainly whether the subnet is a real, scanned
            interface CIDR or just an unmapped bucket, so nothing here reads
            as more precise than it is. */}
        {groupMode === 'network' && (topo?.networks?.length ?? 0) > 0 && (
          <div style={{
            position: 'absolute', top: 12, left: 12, maxWidth: 300,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '10px 12px', fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}>
            <div style={{ fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.4, marginBottom: 6, textTransform: 'uppercase', fontSize: 10 }}>
              Network segments
            </div>
            {topo!.networks.map(nw => {
              const real = nw.id !== 'net-unmapped-private' && !!nw.cidr
              return (
                <div key={nw.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 5 }} title={nw.source}>
                  <span style={{
                    width: 9, height: 9, borderRadius: 3, marginTop: 2, flexShrink: 0,
                    background: netColors[nw.id] ?? 'var(--text-muted)',
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {nw.cidr || nw.label}
                    </div>
                    <div style={{ color: real ? 'var(--success)' : 'var(--text-muted)', fontSize: 10 }}>
                      {real ? 'scanned via SSH' : nw.kind === 'vpn' ? 'CGNAT / VPN range' : nw.kind === 'public' ? 'public internet' : 'not yet scanned'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Scan issues panel — floats over the canvas instead of pushing it
            down, so the map keeps the full page regardless of issue count. */}
        {notesOpen && (topo?.notes?.length ?? 0) > 0 && (
          <div style={{
            position: 'absolute', top: 12, right: 12, maxWidth: 420, maxHeight: '60%', overflowY: 'auto',
            border: '1px solid var(--warning)', background: 'var(--bg-card)', borderRadius: 10,
            padding: '10px 14px', fontSize: 'var(--text-xs)', color: 'var(--text-primary)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 2,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color="var(--warning)" /> Live scan issues
              </strong>
              <button className="sidebar-toggle-btn" onClick={() => setNotesOpen(false)} title="Close">×</button>
            </div>
            <ul style={{ margin: '4px 0 0 20px', fontFamily: 'var(--font-mono)' }}>
              {topo!.notes!.map((n, i) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}
            </ul>
          </div>
        )}

        {/* Pan/zoom controls */}
        {hasInfra && (
          <div style={{
            position: 'absolute', right: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 4,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 4,
          }}>
            <button className="sidebar-toggle-btn" onClick={() => zoomBy(1.25)} title="Zoom in"><ZoomIn size={14} /></button>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', padding: '1px 0' }}>
              {Math.round(view.k * 100)}%
            </div>
            <button className="sidebar-toggle-btn" onClick={() => zoomBy(0.8)} title="Zoom out"><ZoomOut size={14} /></button>
            <button className="sidebar-toggle-btn" onClick={fitView} title="Fit to view"><Maximize size={14} /></button>
          </div>
        )}

        {/* Pan/zoom hint */}
        {hasInfra && (
          <div style={{
            position: 'absolute', left: 12, bottom: 12, display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px',
            pointerEvents: 'none', opacity: 0.75,
          }}>
            drag to pan · scroll or pinch to zoom
          </div>
        )}
      </div>
    </div>
  )
}
