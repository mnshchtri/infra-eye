import { memo } from 'react'
import { Inbox } from 'lucide-react'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { K8sRow } from '../../types/k8s'

interface KTableProps {
  columns: string[];
  data: K8sRow[];
  actions?: (item: K8sRow) => React.ReactNode;
  selectedIndex: number;
  loading: boolean;
  onNameClick?: (item: K8sRow) => void;
  /** Row-selection checkboxes (bulk actions). Omit to keep the table as-is. */
  selectable?: boolean;
  isRowChecked?: (item: K8sRow) => boolean;
  onToggleRow?: (item: K8sRow) => void;
  allChecked?: boolean;
  onToggleAll?: () => void;
}

const getVal = (item: K8sRow, col: string) => {
  switch(col.toLowerCase()) {
    case 'name': return item.metadata.name;
    case 'namespace': return item.metadata.namespace;
    case 'status': {
      const val = item.status?.phase || (item.status?.conditions?.find((c: K8sRow) => c.type === 'Ready')?.status === 'True' ? 'Running' : 'Ready');
      return <Chip size="small" label={val} color={val === 'Running' || val === 'Ready' || val === 'Active' ? 'success' : 'error'} />;
    }
    case 'restarts': return item.status?.containerStatuses?.[0]?.restartCount ?? 0;
    case 'role': return <Box component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>{item.metadata.labels?.['kubernetes.io/role'] || (item.metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined ? 'control-plane' : 'worker')}</Box>;
    case 'version': return item.status?.nodeInfo?.kubeletVersion;
    case 'ready': return `${item.status?.readyReplicas || item.status?.numberReady || 0}/${item.spec?.replicas || item.status?.desiredNumberScheduled || 0}`;
    case 'available': return item.status?.availableReplicas || item.status?.numberAvailable || 0;
    case 'type': return item.type || item.spec?.type || '—';
    case 'reason': return item.reason || '—';
    case 'object': return item.involvedObject ? `${item.involvedObject.kind}/${item.involvedObject.name}` : '—';
    case 'message': return item.message || '—';
    case 'targets': {
       const current = item.status?.currentCPUUtilizationPercentage ?? '?';
       const target = item.spec?.targetCPUUtilizationPercentage ?? '?';
       return `${current}% / ${target}%`;
    }
    case 'minpods': return item.spec?.minReplicas ?? 0;
    case 'maxpods': return item.spec?.maxReplicas ?? 0;
    case 'replicas': return item.status?.currentReplicas ?? 0;
    case 'hosts': return item.spec?.rules?.[0]?.host || '—';
    case 'address': return item.status?.loadBalancer?.ingress?.[0]?.ip || item.status?.loadBalancer?.ingress?.[0]?.hostname || item.status?.addresses?.[0]?.value || '—';
    case 'controller': return item.spec?.controllerName || '—';
    case 'class': return item.spec?.gatewayClassName || '—';
    case 'hostnames': return item.spec?.hostnames?.join(', ') || '*';
    case 'listeners': return item.spec?.listeners?.length ?? 0;
    case 'group': return item.spec?.group || '—';
    case 'scope': return item.spec?.scope || '—';
    case 'minavailable': return item.spec?.minAvailable ?? '—';
    case 'maxunavailable': return item.spec?.maxUnavailable ?? '—';
    case 'volume': return item.spec?.volumeName || '—';
    case 'capacity': return item.status?.capacity?.storage || item.spec?.resources?.requests?.storage || '—';
    case 'accessmodes': return item.spec?.accessModes?.join(', ') || '—';
    case 'storageclass': return item.spec?.storageClassName || '—';
    case 'claim': return item.spec?.claimRef ? `${item.spec.claimRef.namespace}/${item.spec.claimRef.name}` : '—';
    case 'reclaimpolicy': return item.spec?.persistentVolumeReclaimPolicy || item.reclaimPolicy || '—';
    case 'provisioner': return item.provisioner || '—';
    case 'volumebindingmode': return item.volumeBindingMode || '—';
    case 'allowvolumeexpansion': return item.allowVolumeExpansion ? 'True' : 'False';
    case 'age': {
        if (!item.lastTimestamp && !item.creationTimestamp) return '—';
        const ts = new Date(item.lastTimestamp || item.creationTimestamp || item.metadata.creationTimestamp || 0).getTime();
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return `${Math.floor(diff)}s`;
        if (diff < 3600) return `${Math.floor(diff/60)}m`;
        if (diff < 86400) return `${Math.floor(diff/3600)}h`;
        return `${Math.floor(diff/86400)}d`;
    }
    case 'cluster-ip': return item.spec?.clusterIP;
    case 'internal-ip': return item.status?.addresses?.find((a: K8sRow) => a.type === 'InternalIP')?.address;
    default: return '—';
  }
}

const KTableRow = memo(({ item, columns, isSelected, actions, onNameClick, checked, onToggleChecked }: { item: K8sRow; columns: string[]; isSelected: boolean; actions?: (item: K8sRow) => React.ReactNode; onNameClick?: (item: K8sRow) => void; checked?: boolean; onToggleChecked?: (item: K8sRow) => void }) => {
  return (
    <TableRow hover selected={isSelected}>
      {onToggleChecked && (
        <TableCell padding="checkbox">
          <Checkbox size="small" checked={!!checked} onChange={() => onToggleChecked(item)} slotProps={{ input: { 'aria-label': `Select ${item.metadata?.name ?? 'row'}` } }} />
        </TableCell>
      )}
      {columns.map((c: string) => (
        <TableCell
          key={c}
          align={c === 'Status' ? 'center' : 'left'}
          onClick={() => { if (c === 'Name' && onNameClick) onNameClick(item) }}
          sx={{
            fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.5,
            ...(c === 'Name'
              ? { cursor: onNameClick ? 'pointer' : 'default', fontWeight: 600, color: onNameClick ? 'primary.main' : 'text.primary', wordBreak: 'break-all', '&:hover': onNameClick ? { textDecoration: 'underline' } : undefined }
              : { color: 'text.secondary' }),
          }}
        >
          {getVal(item, c)}
        </TableCell>
      ))}
      {actions && (
        <TableCell align="right" sx={{ borderLeft: 1, borderLeftColor: 'divider' }}>
          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
            {actions(item)}
          </Box>
        </TableCell>
      )}
    </TableRow>
  );
});

KTableRow.displayName = 'KTableRow';

export const KTable = memo(({ columns, data, actions, selectedIndex, loading, onNameClick, selectable, isRowChecked, onToggleRow, allChecked, onToggleAll }: KTableProps) => {
  const colCount = columns.length + (actions ? 1 : 0) + (selectable ? 1 : 0)

  // Dynamic width helper
  const getColWidth = (col: string) => {
    switch(col.toLowerCase()) {
      case 'name': return '35%';
      case 'namespace': return '15%';
      case 'status': return '120px';
      case 'restarts': return '80px';
      case 'ready': return '100px';
      case 'available': return '100px';
      case 'age': return '100px';
      case 'version': return '140px';
      case 'role': return '140px';
      case 'internal-ip': return '160px';
      case 'type': return '120px';
      case 'cluster-ip': return '140px';
      case 'capacity': return '120px';
      case 'accessmodes': return '120px';
      case 'storageclass': return '140px';
      case 'reclaimpolicy': return '140px';
      case 'provisioner': return '180px';
      case 'volumebindingmode': return '180px';
      case 'allowvolumeexpansion': return '100px';
      case 'hosts': return '180px';
      default: return 'auto';
    }
  }

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mb: 2.5 }}>
      <Table size="small" sx={{ minWidth: 800, tableLayout: 'fixed' }}>
        <colgroup>
          {selectable && <col style={{ width: 44 }} />}
          {columns.map(c => <col key={c} style={{ width: getColWidth(c) }} />)}
          {actions && <col style={{ width: '120px' }} />}
        </colgroup>
        <TableHead>
          <TableRow>
            {selectable && (
              <TableCell padding="checkbox">
                <Checkbox size="small" checked={!!allChecked} onChange={onToggleAll} slotProps={{ input: { 'aria-label': 'Select all rows' } }} />
              </TableCell>
            )}
            {columns.map((c: string) => (
              <TableCell key={c} align={c === 'Status' ? 'center' : 'left'} sx={{ fontWeight: 600, color: 'text.secondary' }}>{c}</TableCell>
            ))}
            {actions && <TableCell align="right" sx={{ fontWeight: 600, color: 'text.secondary', borderLeft: 1, borderLeftColor: 'divider' }}>Actions</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={`skel-${i}`}>
                {Array.from({ length: colCount }).map((_, j) => (
                  <TableCell key={j}><Skeleton width="60%" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colCount} align="center" sx={{ py: 7, color: 'text.secondary' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <Inbox size={22} />
                  <Typography variant="body2">No resources found</Typography>
                </Box>
              </TableCell>
            </TableRow>
          ) : data.map((item: K8sRow, i: number) => (
            <KTableRow
              key={item.metadata?.uid || `${item.metadata?.name}-${i}`}
              item={item}
              columns={columns}
              isSelected={selectedIndex === i}
              actions={actions}
              onNameClick={onNameClick}
              checked={selectable ? isRowChecked?.(item) : undefined}
              onToggleChecked={selectable ? onToggleRow : undefined}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
})

KTable.displayName = 'KTable'
