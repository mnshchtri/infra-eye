import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, IconButton, TableCell, TableRow, Tooltip, Typography } from '@mui/material'
import {
  HardDrive, Database, Layers, Boxes, AlertTriangle, RefreshCw, Server, Tag,
} from 'lucide-react'
import { api } from '../../api/client'
import { errMessage } from '../../utils/errors'
import { useToastStore } from '../../store/toastStore'
import {
  CenteredSpinner, DataTable, Dot, EmptyRow, LoadFailed, MonoCell, SectionCard, Tile, TileGrid, ToneChip,
} from '../server/ServerParts'
import { MONO } from '../server/tokens'
import type { Tone } from '../server/tokens'
import { fmtBytes, categoryColor, usageTone } from './format'
import type { K8sStorageInfo, K8sCategoryUsage } from './types'

const phaseTone = (phase: string): Tone => {
  switch (phase) {
    case 'Bound': return 'success'
    case 'Available': return 'info'
    case 'Pending': return 'warning'
    case 'Failed': case 'Lost': return 'error'
    default: return 'default'
  }
}

/** Stacked bar + legend for a capacity rollup (by StorageClass or namespace). */
function Breakdown({ title, rows, unit }: { title: string; rows: K8sCategoryUsage[]; unit?: string }) {
  if (rows.length === 0) return null
  const shown = rows.slice(0, 10)
  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>{title}</Typography>
      <Box sx={{ display: 'flex', height: 14, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        {shown.map((row, i) => (
          <Tooltip key={row.name} title={`${row.name} - ${fmtBytes(row.size_bytes)} (${row.percent.toFixed(1)}%)`}>
            <Box sx={{ width: `${Math.max(row.percent, 0.4)}%`, bgcolor: categoryColor(row.name, i) }} />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.75, mt: 1.5 }}>
        {shown.map((row, i) => (
          <Box key={row.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.875 }}>
            <Dot color={categoryColor(row.name, i)} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>
              {fmtBytes(row.size_bytes)} · {row.entries} {unit || 'vol'}{row.entries === 1 ? '' : 's'}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
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

  if (loading && !info) return <CenteredSpinner />

  if (!info || failed) {
    return <LoadFailed icon={HardDrive} message="Unable to load cluster storage data" onRetry={load} />
  }

  const s = info.summary
  const pressured = info.nodes.filter(n => n.disk_pressure).length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TileGrid>
        <Tile label="Provisioned" value={fmtBytes(s.provisioned_bytes)} sub={`${s.pvs} persistent volume${s.pvs === 1 ? '' : 's'}`} icon={HardDrive} />
        <Tile label="Claims bound" value={`${s.bound_pvcs}/${s.pvcs}`} sub={s.pending_pvcs > 0 ? `${s.pending_pvcs} pending` : 'none pending'} icon={Database} accent={s.pending_pvcs > 0 ? 'warning.main' : 'success.main'} />
        <Tile label="Unbound capacity" value={fmtBytes(s.unbound_bytes)} sub="available or released" icon={Boxes} accent={s.unbound_bytes > 0 ? 'warning.main' : undefined} />
        <Tile label="Node ephemeral" value={fmtBytes(s.ephemeral_total_bytes)} sub={pressured > 0 ? `${pressured} node(s) under disk pressure` : `${s.nodes} node${s.nodes === 1 ? '' : 's'}`} icon={Server} accent={pressured > 0 ? 'error.main' : undefined} />
      </TileGrid>

      <SectionCard
        icon={Tag}
        title="Capacity breakdown"
        action={
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={load} disabled={loading} aria-label="Refresh storage"><RefreshCw size={14} /></IconButton>
            </span>
          </Tooltip>
        }
      >
        <Breakdown title="Provisioned by storage class" rows={info.by_class} unit="vol" />
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
          <Breakdown title="Claimed by namespace" rows={info.by_namespace} unit="claim" />
        </Box>
        {info.by_class.length === 0 && info.by_namespace.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>No persistent storage provisioned in this cluster</Box>
        )}
      </SectionCard>

      <SectionCard icon={Database} title="Persistent volume claims" count={info.pvcs.length}>
        <DataTable label="Persistent volume claims" headers={['Claim', 'Namespace', 'Status', 'Capacity', 'Storage class', 'Access', 'Used by']} maxHeight={420}>
          {info.pvcs.length === 0 ? <EmptyRow colSpan={7} label="No claims found" /> : info.pvcs.map((pvc, i) => (
            <TableRow key={`${pvc.namespace}/${pvc.name}-${i}`} hover>
              <MonoCell bold>{pvc.name}</MonoCell>
              <MonoCell muted>{pvc.namespace}</MonoCell>
              <TableCell><ToneChip label={pvc.status} tone={phaseTone(pvc.status)} /></TableCell>
              <MonoCell bold>
                {fmtBytes(pvc.capacity_bytes || pvc.request_bytes)}
                {pvc.capacity_bytes === 0 && pvc.request_bytes > 0 && (
                  <Box component="span" sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 400 }}> req</Box>
                )}
              </MonoCell>
              <MonoCell muted>{pvc.storage_class || '—'}</MonoCell>
              <MonoCell muted>{pvc.access_modes || '—'}</MonoCell>
              <MonoCell muted sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pvc.used_by || '—'}</MonoCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard icon={HardDrive} title="Persistent volumes" count={info.pvs.length}>
        <DataTable label="Persistent volumes" headers={['Volume', 'Capacity', 'Status', 'Claim', 'Storage class', 'Backing', 'Reclaim']} maxHeight={420}>
          {info.pvs.length === 0 ? <EmptyRow colSpan={7} label="No persistent volumes found" /> : info.pvs.map((pv, i) => (
            <TableRow key={`${pv.name}-${i}`} hover>
              <MonoCell bold sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pv.name}</MonoCell>
              <MonoCell bold>{fmtBytes(pv.capacity_bytes)}</MonoCell>
              <TableCell><ToneChip label={pv.status} tone={phaseTone(pv.status)} /></TableCell>
              <MonoCell muted>{pv.claim || '—'}</MonoCell>
              <MonoCell muted>{pv.storage_class || '—'}</MonoCell>
              <MonoCell muted>{pv.source_type}{pv.node ? ` · ${pv.node}` : ''}</MonoCell>
              <MonoCell muted>{pv.reclaim_policy || '—'}</MonoCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard icon={Layers} title="Storage classes" count={info.storage_classes.length}>
        <DataTable label="Storage classes" headers={['Name', 'Provisioner', 'Reclaim', 'Binding', 'Expandable']}>
          {info.storage_classes.length === 0 ? <EmptyRow colSpan={5} label="No storage classes defined" /> : info.storage_classes.map((sc, i) => (
            <TableRow key={`${sc.name}-${i}`} hover>
              <MonoCell bold>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {sc.name}
                  {sc.is_default && <ToneChip label="default" tone="primary" />}
                </Box>
              </MonoCell>
              <MonoCell muted>{sc.provisioner}</MonoCell>
              <MonoCell muted>{sc.reclaim_policy || '—'}</MonoCell>
              <MonoCell muted>{sc.binding_mode || '—'}</MonoCell>
              <MonoCell sx={{ color: sc.allow_expansion ? 'success.main' : 'text.secondary' }}>{sc.allow_expansion ? 'yes' : 'no'}</MonoCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard icon={Server} title="Node storage" count={info.nodes.length}>
        <DataTable label="Node storage" headers={['Node', 'Ephemeral capacity', 'Allocatable', 'Reserved', 'Attached volumes', 'Runtime']}>
          {info.nodes.length === 0 ? <EmptyRow colSpan={6} label="No nodes found" /> : info.nodes.map((n, i) => {
            const reserved = n.ephemeral_total_bytes - n.ephemeral_allocatable_bytes
            const reservedPct = n.ephemeral_total_bytes > 0 ? (reserved / n.ephemeral_total_bytes) * 100 : 0
            return (
              <TableRow key={`${n.name}-${i}`} hover>
                <MonoCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Dot tone={n.ready ? 'success' : 'error'} />
                    <span style={{ fontWeight: 700 }}>{n.name}</span>
                    {n.disk_pressure && <ToneChip label="disk pressure" tone="error" />}
                  </Box>
                </MonoCell>
                <MonoCell bold>{fmtBytes(n.ephemeral_total_bytes)}</MonoCell>
                <MonoCell muted>{fmtBytes(n.ephemeral_allocatable_bytes)}</MonoCell>
                <MonoCell sx={{ color: `${usageTone(reservedPct)}.main` }}>
                  {reserved > 0 ? `${fmtBytes(reserved)} (${reservedPct.toFixed(0)}%)` : '—'}
                </MonoCell>
                <MonoCell muted>{n.attached_volumes}</MonoCell>
                <MonoCell muted>{n.container_runtime || '—'}</MonoCell>
              </TableRow>
            )
          })}
        </DataTable>
      </SectionCard>

      {pressured > 0 && (
        <Alert severity="error" variant="outlined" icon={<AlertTriangle size={16} />}>
          {pressured} node{pressured === 1 ? ' is' : 's are'} reporting <strong>DiskPressure</strong>. The kubelet will start evicting pods to reclaim ephemeral storage.
        </Alert>
      )}
    </Box>
  )
}
