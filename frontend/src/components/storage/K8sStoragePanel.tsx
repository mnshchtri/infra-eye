import { useCallback, useEffect, useState } from 'react'
import {
  HardDrive, Database, Layers, Boxes, AlertTriangle, RefreshCw, Server, Tag,
} from 'lucide-react'
import { api } from '../../api/client'
import { errMessage } from '../../utils/errors'
import { useToastStore } from '../../store/toastStore'
import { fmtBytes, categoryColor, usageColor } from './format'
import type { K8sStorageInfo, K8sCategoryUsage } from './types'

const MONO = 'var(--font-mono)'

function Tile({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: typeof HardDrive; accent?: string
}) {
  return (
    <div className="card" style={{ padding: '20px 24px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 36, height: 36, border: '1px solid var(--border-bright)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={16} color={accent || 'var(--brand-primary)'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: MONO, lineHeight: 1.1 }}>{value}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.1em', fontFamily: MONO, textTransform: 'uppercase' }}>{label}</div>
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
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10 }}>
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
  textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: MONO, textAlign: 'left', background: 'var(--bg-elevated)',
}
const tdStyle: React.CSSProperties = { padding: '10px 16px', fontFamily: MONO, fontSize: 13 }

function THead({ headers, sticky }: { headers: string[]; sticky?: boolean }) {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--border)' }}>
        {headers.map(h => <th key={h} style={sticky ? { ...thStyle, position: 'sticky', top: 0 } : thStyle}>{h}</th>)}
      </tr>
    </thead>
  )
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return <tr><td colSpan={colSpan} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{label}</td></tr>
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ padding: '3px 8px', fontSize: 11, fontWeight: 900, background: `${color}18`, color, border: `1px solid ${color}30`, fontFamily: MONO, textTransform: 'uppercase' }}>{text}</span>
  )
}

const phaseColor = (phase: string) => {
  switch (phase) {
    case 'Bound': return 'var(--success)'
    case 'Available': return 'var(--info)'
    case 'Pending': return 'var(--warning)'
    case 'Released': return 'var(--text-muted)'
    case 'Failed': case 'Lost': return 'var(--danger)'
    default: return 'var(--text-muted)'
  }
}

/** Stacked bar + legend for a capacity rollup (by StorageClass or namespace). */
function Breakdown({ title, rows, unit }: { title: string; rows: K8sCategoryUsage[]; unit?: string }) {
  if (rows.length === 0) return null
  const shown = rows.slice(0, 10)
  return (
    <div style={{ padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: MONO, marginBottom: 12 }}>
        {title}
      </div>
      <div style={{ display: 'flex', height: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {shown.map((row, i) => (
          <div
            key={row.name}
            title={`${row.name} — ${fmtBytes(row.size_bytes)} (${row.percent.toFixed(1)}%)`}
            style={{ width: `${Math.max(row.percent, 0.4)}%`, background: categoryColor(row.name, i) }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
        {shown.map((row, i) => (
          <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 8, height: 8, background: categoryColor(row.name, i), flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{row.name}</span>
            <span style={{ fontSize: 12, fontFamily: MONO, color: 'var(--text-muted)' }}>
              {fmtBytes(row.size_bytes)} · {row.entries} {unit || 'vol'}{row.entries === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Storage for a Kubernetes cluster. A cluster has no single disk to walk, so
 * the question "what is consuming storage" is answered with the objects that
 * actually hold capacity — PVs, claims and per-node ephemeral space — rolled up
 * by StorageClass and namespace.
 */
export function K8sStoragePanel({ serverId }: { serverId: string }) {
  const toast = useToastStore()
  const [info, setInfo] = useState<K8sStorageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const fetchStorage = useCallback(async (): Promise<K8sStorageInfo> => {
    const res = await api.get(`/api/servers/${serverId}/k8s-storage`)
    return {
      ...res.data,
      storage_classes: res.data?.storage_classes || [],
      pvs: res.data?.pvs || [],
      pvcs: res.data?.pvcs || [],
      nodes: res.data?.nodes || [],
      by_class: res.data?.by_class || [],
      by_namespace: res.data?.by_namespace || [],
      summary: res.data?.summary || {},
    }
  }, [serverId])

  // First load. `alive` guards the state writes so a request for one cluster
  // can't land on another cluster's panel after a route change.
  useEffect(() => {
    let alive = true
    fetchStorage()
      .then(data => { if (alive) { setInfo(data); setFailed(false) } })
      .catch((err: unknown) => {
        if (!alive) return
        setInfo(null)
        setFailed(true)
        toast.error('Failed to load cluster storage', errMessage(err))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [fetchStorage, toast])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setInfo(await fetchStorage())
      setFailed(false)
    } catch (err: unknown) {
      setInfo(null)
      setFailed(true)
      toast.error('Failed to load cluster storage', errMessage(err))
    } finally {
      setLoading(false)
    }
  }, [fetchStorage, toast])

  if (loading && !info) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--brand-primary)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!info || failed) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <HardDrive size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
        <div style={{ fontSize: 13 }}>Unable to load cluster storage data</div>
        <button className="btn btn-secondary" onClick={load} style={{ marginTop: 16 }}>Retry</button>
      </div>
    )
  }

  const s = info.summary
  const pressured = info.nodes.filter(n => n.disk_pressure).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="grid-stats-4">
        <Tile label="Provisioned" value={fmtBytes(s.provisioned_bytes)} sub={`${s.pvs} persistent volume${s.pvs === 1 ? '' : 's'}`} icon={HardDrive} />
        <Tile label="Claims Bound" value={`${s.bound_pvcs}/${s.pvcs}`} sub={s.pending_pvcs > 0 ? `${s.pending_pvcs} pending` : 'none pending'} icon={Database} accent={s.pending_pvcs > 0 ? 'var(--warning)' : 'var(--success)'} />
        <Tile label="Unbound Capacity" value={fmtBytes(s.unbound_bytes)} sub="available or released" icon={Boxes} accent={s.unbound_bytes > 0 ? 'var(--warning)' : undefined} />
        <Tile label="Node Ephemeral" value={fmtBytes(s.ephemeral_total_bytes)} sub={pressured > 0 ? `${pressured} node(s) under disk pressure` : `${s.nodes} node${s.nodes === 1 ? '' : 's'}`} icon={Server} accent={pressured > 0 ? 'var(--danger)' : undefined} />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Tag size={16} color="var(--brand-primary)" />
          <span style={{ fontWeight: 800, fontSize: 14 }}>Capacity Breakdown</span>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }} title="Refresh">
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
        </div>
        <Breakdown title="Provisioned by storage class" rows={info.by_class} unit="vol" />
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Breakdown title="Claimed by namespace" rows={info.by_namespace} unit="claim" />
        </div>
        {info.by_class.length === 0 && info.by_namespace.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No persistent storage provisioned in this cluster</div>
        )}
      </div>

      <SectionCard icon={Database} title="Persistent Volume Claims" count={info.pvcs.length}>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Claim', 'Namespace', 'Status', 'Capacity', 'Storage Class', 'Access', 'Used By']} sticky />
            <tbody>
              {info.pvcs.length === 0 ? <EmptyRow colSpan={7} label="No claims found" /> : info.pvcs.map((pvc, i) => (
                <tr key={`${pvc.namespace}/${pvc.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{pvc.name}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{pvc.namespace}</td>
                  <td style={tdStyle}><Pill text={pvc.status} color={phaseColor(pvc.status)} /></td>
                  <td style={{ ...tdStyle, fontWeight: 800 }}>
                    {fmtBytes(pvc.capacity_bytes || pvc.request_bytes)}
                    {pvc.capacity_bytes === 0 && pvc.request_bytes > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> req</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{pvc.storage_class || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{pvc.access_modes || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pvc.used_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard icon={HardDrive} title="Persistent Volumes" count={info.pvs.length}>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Volume', 'Capacity', 'Status', 'Claim', 'Storage Class', 'Backing', 'Reclaim']} sticky />
            <tbody>
              {info.pvs.length === 0 ? <EmptyRow colSpan={7} label="No persistent volumes found" /> : info.pvs.map((pv, i) => (
                <tr key={`${pv.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pv.name}</td>
                  <td style={{ ...tdStyle, fontWeight: 800 }}>{fmtBytes(pv.capacity_bytes)}</td>
                  <td style={tdStyle}><Pill text={pv.status} color={phaseColor(pv.status)} /></td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{pv.claim || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{pv.storage_class || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>
                    {pv.source_type}{pv.node ? ` · ${pv.node}` : ''}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{pv.reclaim_policy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard icon={Layers} title="Storage Classes" count={info.storage_classes.length}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Name', 'Provisioner', 'Reclaim', 'Binding', 'Expandable']} />
            <tbody>
              {info.storage_classes.length === 0 ? <EmptyRow colSpan={5} label="No storage classes defined" /> : info.storage_classes.map((sc, i) => (
                <tr key={`${sc.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {sc.name}
                      {sc.is_default && <Pill text="default" color="var(--brand-primary)" />}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{sc.provisioner}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{sc.reclaim_policy || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{sc.binding_mode || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: sc.allow_expansion ? 'var(--success)' : 'var(--text-muted)' }}>{sc.allow_expansion ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard icon={Server} title="Node Storage" count={info.nodes.length}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead headers={['Node', 'Ephemeral Capacity', 'Allocatable', 'Reserved', 'Attached Volumes', 'Runtime']} />
            <tbody>
              {info.nodes.length === 0 ? <EmptyRow colSpan={6} label="No nodes found" /> : info.nodes.map((n, i) => {
                const reserved = n.ephemeral_total_bytes - n.ephemeral_allocatable_bytes
                const reservedPct = n.ephemeral_total_bytes > 0 ? (reserved / n.ephemeral_total_bytes) * 100 : 0
                return (
                  <tr key={`${n.name}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 6, height: 6, background: n.ready ? 'var(--success)' : 'var(--danger)' }} />
                        <span style={{ fontWeight: 700 }}>{n.name}</span>
                        {n.disk_pressure && <Pill text="disk pressure" color="var(--danger)" />}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 800 }}>{fmtBytes(n.ephemeral_total_bytes)}</td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{fmtBytes(n.ephemeral_allocatable_bytes)}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: usageColor(reservedPct) }}>
                      {reserved > 0 ? `${fmtBytes(reserved)} (${reservedPct.toFixed(0)}%)` : '—'}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-secondary)' }}>{n.attached_volumes}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--text-muted)' }}>{n.container_runtime || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {pressured > 0 && (
        <div className="card" style={{ padding: '14px 18px', border: '1px solid var(--danger)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={16} color="var(--danger)" />
          <span style={{ fontSize: 13 }}>
            {pressured} node{pressured === 1 ? ' is' : 's are'} reporting <strong>DiskPressure</strong> — the kubelet will start evicting pods to reclaim ephemeral storage.
          </span>
        </div>
      )}
    </div>
  )
}
