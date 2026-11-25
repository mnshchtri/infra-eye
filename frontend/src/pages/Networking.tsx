import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw,
  Wifi, Globe, Server, Activity, Power,
  HelpCircle, Network,
  ChevronDown, ChevronUp
} from 'lucide-react'
import {
  Box, Breadcrumbs, Chip, IconButton, Link as MuiLink, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { Button, Card, EmptyState, PageHeader, SearchInput, Spinner, StatCard, TabSwitcher } from '../components/ui'
import { api } from '../api/client'
import { LinuxIcon, AppleIcon } from '../components/OSIcons'
import { useToastStore } from '../store/toastStore'
import { apiError } from '../utils/errors'

interface Server {
  id: number; name: string; host: string; status: string; os: string; ssh_user: string;
}
interface ListeningPort {
  protocol: string; state: string; recv_q: string; send_q: string;
  local: string; remote: string; program: string; pid: string;
}
interface SystemService {
  name: string; load: string; active: string; sub: string; description: string;
}
interface NetworkInterface {
  name: string; flags: string; mtu: string; state: string;
  ipv4: string; ipv6: string;
  rx_bytes: string; tx_bytes: string; rx_packets: string; tx_packets: string;
}
interface NetworkingInfo {
  hostname: string;
  ports: ListeningPort[];
  services: SystemService[];
  interfaces: NetworkInterface[];
  uptime: string;
}

type ChipColor = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'error'

const PROTO_COLORS: Record<string, ChipColor> = { tcp: 'info', tcp6: 'info', udp: 'warning', udp6: 'warning' }
const STATE_COLORS: Record<string, ChipColor> = {
  LISTEN: 'success',
  ESTABLISHED: 'primary',
  'TIME-WAIT': 'default',
  'CLOSE-WAIT': 'error',
  'SYN-SENT': 'warning',
  'SYN-RECV': 'warning',
}

function formatBytes(b: string): string {
  const n = parseInt(b)
  if (isNaN(n) || n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return (n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

const mono = { fontFamily: 'var(--font-mono)' } as const
const cellSx = { lineHeight: 1.5, verticalAlign: 'top' } as const

function Tag({ label, color }: { label: string; color: ChipColor }) {
  return <Chip size="small" label={label} color={color} variant={color === 'default' ? 'outlined' : 'filled'} sx={{ height: 20, fontSize: '0.6875rem' }} />
}

function PortRow({ port }: { port: ListeningPort }) {
  const localParts = port.local.split(':')
  const localPort = localParts[localParts.length - 1]
  const localAddr = localParts.slice(0, -1).join(':') || '::'
  const hasRemote = port.remote && port.remote !== '*' && port.remote !== '0.0.0.0:*' && port.remote !== '[::]:*' && port.remote !== '*:*'

  return (
    <TableRow hover sx={{ '& td': cellSx }}>
      <TableCell><Tag label={port.protocol} color={PROTO_COLORS[port.protocol] || 'default'} /></TableCell>
      <TableCell><Tag label={port.state} color={STATE_COLORS[port.state] || 'default'} /></TableCell>
      <TableCell sx={mono}>
        <Box component="span" sx={{ color: 'text.secondary', mr: 0.5 }}>{localAddr}</Box>
        <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>:{localPort}</Box>
      </TableCell>
      <TableCell sx={{ ...mono, color: 'text.secondary' }}>{hasRemote ? port.remote : '—'}</TableCell>
      <TableCell sx={mono}>
        {port.program ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Server size={12} />
            <span>{port.program}</span>
            {port.pid && <Typography component="span" variant="caption" color="text.secondary">PID {port.pid}</Typography>}
          </Box>
        ) : <Box component="span" sx={{ color: 'text.secondary' }}>—</Box>}
      </TableCell>
    </TableRow>
  )
}

function ServiceRow({ svc }: { svc: SystemService }) {
  const activeColor: ChipColor = svc.active === 'active' ? 'success' : svc.active === 'failed' ? 'error' : 'default'
  const subColor: ChipColor = svc.sub === 'running' ? 'success' : svc.sub === 'exited' ? 'warning' : 'default'

  return (
    <TableRow hover sx={{ '& td': cellSx }}>
      <TableCell sx={{ ...mono, fontWeight: 600 }}>{svc.name}</TableCell>
      <TableCell><Tag label={svc.active} color={activeColor} /></TableCell>
      <TableCell><Tag label={svc.sub} color={subColor} /></TableCell>
      <TableCell sx={{ color: 'text.secondary' }}>{svc.description}</TableCell>
    </TableRow>
  )
}

function InterfaceRow({ iface }: { iface: NetworkInterface }) {
  const isUp = iface.state === 'UP'
  return (
    <TableRow hover sx={{ '& td': cellSx }}>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography component="span" sx={{ ...mono, fontWeight: 600 }}>{iface.name}</Typography>
          <Tag label={iface.state} color={isUp ? 'success' : 'default'} />
        </Box>
      </TableCell>
      <TableCell sx={mono}>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Box component="span" sx={{ fontWeight: 600, color: isUp ? 'text.primary' : 'text.secondary' }}>{iface.ipv4 || '—'}</Box>
          {iface.ipv6 && iface.ipv6 !== '—' && <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>{iface.ipv6}</Box>}
        </Box>
      </TableCell>
      <TableCell sx={{ ...mono, color: 'text.secondary' }}>{iface.mtu}</TableCell>
      <TableCell sx={mono}>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Box component="span" sx={{ color: 'success.main' }}>RX {formatBytes(iface.rx_bytes)}</Box>
          <Box component="span" sx={{ color: 'info.main' }}>TX {formatBytes(iface.tx_bytes)}</Box>
        </Box>
      </TableCell>
      <TableCell sx={{ ...mono, color: 'text.secondary' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <span>RX {iface.rx_packets}</span>
          <span>TX {iface.tx_packets}</span>
        </Box>
      </TableCell>
    </TableRow>
  )
}

function DataTable({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <TableContainer component={Box} sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>{heads.map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>{children}</TableBody>
      </Table>
    </TableContainer>
  )
}

function PanelHeader({ icon: Icon, title, count, children }: { icon: typeof Network; title: string; count: number; children?: React.ReactNode }) {
  return (
    <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon size={16} color="var(--brand-primary)" />
        <Typography variant="subtitle1" component="h2">{title}</Typography>
        <Typography variant="body2" color="text.secondary">({count})</Typography>
      </Box>
      {children}
    </Box>
  )
}

type Tab = 'ports' | 'services' | 'interfaces'

export function Networking() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastStore()
  const [server, setServer] = useState<Server | null>(null)
  const [info, setInfo] = useState<NetworkingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('ports')
  const [serviceFilter, setServiceFilter] = useState<'all' | 'active' | 'failed'>('all')
  const [portsExpanded, setPortsExpanded] = useState(true)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [serverRes, netRes] = await Promise.all([
        api.get(`/api/servers/${id}`),
        api.get(`/api/servers/${id}/networking`)
      ])
      setServer(serverRes.data)
      setInfo({
        ...netRes.data,
        ports: netRes.data?.ports || [],
        services: netRes.data?.services || [],
        interfaces: netRes.data?.interfaces || [],
      })
    } catch (err: unknown) {
      toast.error('Failed to load', apiError(err) || 'Could not fetch networking data')
    } finally {
      setLoading(false)
    }
  }

  const filteredPorts = useMemo(() => {
    if (!info) return []
    if (!search) return info.ports
    const q = search.toLowerCase()
    return info.ports.filter(p =>
      p.protocol.toLowerCase().includes(q) ||
      p.state.toLowerCase().includes(q) ||
      p.local.toLowerCase().includes(q) ||
      p.remote.toLowerCase().includes(q) ||
      (p.program || '').toLowerCase().includes(q) ||
      p.pid.includes(q)
    )
  }, [info, search])

  const filteredServices = useMemo(() => {
    if (!info) return []
    let list = info.services
    if (serviceFilter !== 'all') list = list.filter(s => s.active === serviceFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.active.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      )
    }
    return list
  }, [info, search, serviceFilter])

  const filteredInterfaces = useMemo(() => {
    if (!info) return []
    if (!search) return info.interfaces
    const q = search.toLowerCase()
    return info.interfaces.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.ipv4.toLowerCase().includes(q) ||
      i.ipv6.toLowerCase().includes(q) ||
      i.state.toLowerCase().includes(q)
    )
  }, [info, search])

  const activeCount = info?.services.filter(s => s.active === 'active').length || 0
  const failedCount = info?.services.filter(s => s.active === 'failed').length || 0
  const listenCount = info?.ports.filter(p => p.state === 'LISTEN').length || 0

  if (loading && !server) return (
    <div className="page">
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><Spinner size={36} /></Box>
    </div>
  )

  if (!server) return <div className="page"><EmptyState title="Server not found" /></div>

  const statusColor: ChipColor = server.status === 'online' ? 'success' : server.status === 'offline' ? 'error' : 'default'
  const failedTotal = info?.services.filter(s => s.active === 'failed').length || 0

  return (
    <div className="page">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Tooltip title="Back to server">
          <IconButton onClick={() => navigate(`/servers/${id}`)} aria-label="Back to server" size="small"><ArrowLeft size={16} /></IconButton>
        </Tooltip>
        <Breadcrumbs aria-label="breadcrumb" sx={{ fontSize: 13 }}>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>Infrastructure</Typography>
          <MuiLink component="button" type="button" underline="hover" color="text.secondary" variant="body2" onClick={() => navigate('/servers')}>Servers</MuiLink>
          <MuiLink component="button" type="button" underline="hover" color="primary" variant="body2" onClick={() => navigate(`/servers/${id}`)}>{server.name}</MuiLink>
          <Typography variant="body2" color="text.primary">Networking</Typography>
        </Breadcrumbs>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 1, border: 1, borderColor: 'divider', flexShrink: 0 }}>
          {server.os === 'darwin' ? <AppleIcon size={24} color="currentColor" /> :
           server.os === 'linux' ? <LinuxIcon size={22} color="currentColor" /> :
           <HelpCircle size={24} />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <PageHeader title={server.name} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: -1.5 }}>
            <Tag label={server.status} color={statusColor} />
            {info && <Typography variant="caption" color="text.secondary" sx={mono}>{info.uptime}</Typography>}
          </Box>
        </Box>
        <Button variant="primary" onClick={loadData} loading={loading} icon={<RefreshCw size={14} />}>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Refresh</Box>
        </Button>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2 }}>
        <StatCard label="Listening ports" value={`${listenCount}`} icon={Network} color="var(--info)" />
        <StatCard label="Active services" value={`${activeCount}`} icon={Activity} color="var(--success)" />
        <StatCard label="Failed services" value={`${failedCount}`} icon={Power} color={failedCount > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
        <StatCard label="Interfaces" value={`${info?.interfaces.length || 0}`} icon={Globe} color="var(--brand-primary)" />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, maxWidth: 360, minWidth: 200 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Filter ports, services, interfaces..." />
        </Box>
        <TabSwitcher
          active={activeTab}
          onChange={id => { setActiveTab(id as Tab); setSearch('') }}
          tabs={[
            { id: 'ports', label: 'Ports', icon: Network },
            { id: 'services', label: failedCount > 0 ? `Services (${failedCount} failed)` : 'Services', icon: Activity },
            { id: 'interfaces', label: 'Interfaces', icon: Wifi },
          ]}
        />
      </Box>

      {activeTab === 'ports' && (
        <Card>
          <PanelHeader icon={Network} title="Listening ports" count={filteredPorts.length}>
            <Tooltip title={portsExpanded ? 'Collapse' : 'Expand'}>
              <IconButton size="small" onClick={() => setPortsExpanded(!portsExpanded)} aria-label={portsExpanded ? 'Collapse ports' : 'Expand ports'}>
                {portsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </IconButton>
            </Tooltip>
          </PanelHeader>
          {portsExpanded && (
            filteredPorts.length === 0 ? (
              <EmptyState icon={Network} title={search ? 'No ports match the filter' : 'No listening ports detected'} />
            ) : (
              <DataTable heads={['Protocol', 'State', 'Local address', 'Remote address', 'Program']}>
                {filteredPorts.map((p, i) => <PortRow key={`${p.local}-${p.protocol}-${i}`} port={p} />)}
              </DataTable>
            )
          )}
        </Card>
      )}

      {activeTab === 'services' && (
        <Card>
          <PanelHeader icon={Activity} title="System services" count={filteredServices.length}>
            <ToggleButtonGroup
              exclusive size="small" value={serviceFilter} aria-label="Service filter"
              onChange={(_, v: 'all' | 'active' | 'failed' | null) => { if (v) setServiceFilter(v) }}
            >
              <ToggleButton value="all" sx={{ textTransform: 'none' }}>All</ToggleButton>
              <ToggleButton value="active" sx={{ textTransform: 'none' }}>Active</ToggleButton>
              <ToggleButton value="failed" sx={{ textTransform: 'none' }}>Failed ({failedTotal})</ToggleButton>
            </ToggleButtonGroup>
          </PanelHeader>
          {filteredServices.length === 0 ? (
            <EmptyState icon={Activity} title={search ? 'No services match the filter' : 'No services found'} />
          ) : (
            <DataTable heads={['Name', 'Active', 'Sub', 'Description']}>
              {filteredServices.map(s => <ServiceRow key={s.name} svc={s} />)}
            </DataTable>
          )}
        </Card>
      )}

      {activeTab === 'interfaces' && (
        <Card>
          <PanelHeader icon={Wifi} title="Network interfaces" count={filteredInterfaces.length} />
          {filteredInterfaces.length === 0 ? (
            <EmptyState icon={Wifi} title={search ? 'No interfaces match the filter' : 'No network interfaces found'} />
          ) : (
            <DataTable heads={['Interface', 'IP address', 'MTU', 'Traffic', 'Packets']}>
              {filteredInterfaces.map(i => <InterfaceRow key={i.name} iface={i} />)}
            </DataTable>
          )}
        </Card>
      )}
    </div>
  )
}
