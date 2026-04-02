import { memo } from 'react'

interface KTableProps {
  columns: string[];
  data: any[];
  actions?: (item: any) => React.ReactNode;
  selectedIndex: number;
  loading: boolean;
  onNameClick?: (item: any) => void;
}

const getVal = (item: any, col: string) => {
  switch(col.toLowerCase()) {
    case 'name': return item.metadata.name;
    case 'namespace': return item.metadata.namespace;
    case 'status': {
      const val = item.status?.phase || (item.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'Running' : 'Ready');
      return <span className={`badge ${val === 'Running' || val === 'Ready' || val === 'Active' ? 'badge-online' : 'badge-offline'}`}>{val}</span>;
    }
    case 'restarts': return item.status?.containerStatuses?.[0]?.restartCount ?? 0;
    case 'role': return item.metadata.labels?.['kubernetes.io/role'] || (item.metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined ? 'control-plane' : 'worker');
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
    case 'address': return item.status?.loadBalancer?.ingress?.[0]?.ip || item.status?.loadBalancer?.ingress?.[0]?.hostname || '—';
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
        const ts = new Date(item.lastTimestamp || item.creationTimestamp).getTime();
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return `${Math.floor(diff)}s`;
        if (diff < 3600) return `${Math.floor(diff/60)}m`;
        if (diff < 86400) return `${Math.floor(diff/3600)}h`;
        return `${Math.floor(diff/86400)}d`;
    }
    case 'cluster-ip': return item.spec?.clusterIP;
    case 'internal-ip': return item.status?.addresses?.find((a: any) => a.type === 'InternalIP')?.address;
    default: return '—';
  }
}

const KTableRow = memo(({ item, columns, isSelected, actions, onNameClick }: { item: any; columns: string[]; isSelected: boolean; actions?: (item: any) => React.ReactNode; onNameClick?: (item: any) => void }) => {
  return (
    <tr className={isSelected ? 'k-row-selected' : ''}>
      {columns.map((c: string) => (
        <td 
          key={c} 
          style={c === 'Name' ? { fontWeight: 700, color: 'var(--brand-primary)', cursor: onNameClick ? 'pointer' : 'default' } : {}}
          onClick={() => { if (c === 'Name' && onNameClick) onNameClick(item) }}
        >
          {getVal(item, c)}
        </td>
      ))}
      {actions && (
        <td>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {actions(item)}
          </div>
        </td>
      )}
    </tr>
  );
});

KTableRow.displayName = 'KTableRow';

export const KTable = memo(({ columns, data, actions, selectedIndex, loading, onNameClick }: KTableProps) => {
  const colCount = columns.length + (actions ? 1 : 0)

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
    <div style={{ overflow: 'hidden', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
       <table className="k-table">
          <colgroup>
            {columns.map(c => <col key={c} style={{ width: getColWidth(c) }} />)}
            {actions && <col style={{ width: '140px' }} />}
          </colgroup>
          <thead>
             <tr>
                {columns.map((c: string) => <th key={c} style={c === 'Status' ? { textAlign: 'center' } : {}}>{c}</th>)}
                {actions && <th style={{ textAlign: 'right' }}>Management</th>}
             </tr>
          </thead>
          <tbody>
             {loading ? (
               Array.from({ length: 5 }).map((_, i) => (
                 <tr key={`skel-${i}`}>
                   {Array.from({ length: colCount }).map((_, j) => (
                     <td key={j}><div style={{ height: 14, background: 'var(--bg-app)', borderRadius: 4, width: '40%', animation: 'pulse-skeleton 1.5s ease infinite' }} /></td>
                   ))}
                 </tr>
               ))
             ) : data.length === 0 ? (
               <tr>
                 <td colSpan={colCount} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: 13 }}>
                   No resources found
                 </td>
               </tr>
             ) : data.map((item: any, i: number) => (
                <KTableRow 
                  key={item.metadata?.uid || `${item.metadata?.name}-${i}`} 
                  item={item} 
                  columns={columns} 
                  isSelected={selectedIndex === i} 
                  actions={actions} 
                  onNameClick={onNameClick}
                />
             ))}
          </tbody>
       </table>
    </div>
  )
})

KTable.displayName = 'KTable'
