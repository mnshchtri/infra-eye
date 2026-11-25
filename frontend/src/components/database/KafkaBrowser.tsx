import { useEffect, useState } from 'react'
import { Layers, Users, RefreshCw, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import { Spinner } from '../ui'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { errMessage } from '../../utils/errors'
import type {
  KafkaTopicInfo, KafkaTopicsResponse, KafkaOffsetsResponse, KafkaPartitionOffset,
  KafkaMessage, KafkaMessagesResponse, KafkaGroupInfo, KafkaGroupsResponse,
} from '../../types/kafka'

interface KafkaBrowserProps {
  resourceId: number
}

type Selection = { kind: 'topic'; name: string } | { kind: 'group'; id: string } | null

const monoCell = { fontSize: 12.5, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }
const headCell = { fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }

function Loading({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 13 }}>
      <Spinner size={14} /> {children}
    </Box>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 600, color: 'text.secondary' }}>{children}</Typography>
}

function fmtTime(ts: string): string {
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleString()
}

/**
 * Read-only Kafka topic browser: topic list with partition low/high
 * watermarks, a bounded recent-message tail per partition, and consumer
 * group lag. No write path — Kafka topics aren't edited through a grid the
 * way SQL rows or Redis keys are.
 */
export function KafkaBrowser({ resourceId }: KafkaBrowserProps) {
  const toast = useToastStore()
  const [topics, setTopics] = useState<KafkaTopicInfo[]>([])
  const [groups, setGroups] = useState<KafkaGroupInfo[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [topicsOpen, setTopicsOpen] = useState(true)
  const [groupsOpen, setGroupsOpen] = useState(true)

  const [selection, setSelection] = useState<Selection>(null)

  const [offsets, setOffsets] = useState<KafkaPartitionOffset[]>([])
  const [loadingOffsets, setLoadingOffsets] = useState(false)
  const [partition, setPartition] = useState(0)
  const [messages, setMessages] = useState<KafkaMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messageLimit, setMessageLimit] = useState(20)

  async function loadLists() {
    setLoadingList(true)
    try {
      const [topicsRes, groupsRes] = await Promise.all([
        api.get<KafkaTopicsResponse>(`/api/resources/${resourceId}/kafka/topics`),
        api.get<KafkaGroupsResponse>(`/api/resources/${resourceId}/kafka/groups`),
      ])
      setTopics(topicsRes.data.topics ?? [])
      setGroups(groupsRes.data.groups ?? [])
    } catch (err: unknown) {
      toast.error('Load failed', errMessage(err, 'Could not load Kafka topics/groups'))
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => { loadLists() }, [resourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function selectTopic(name: string) {
    setSelection({ kind: 'topic', name })
    setPartition(0)
    setMessages([])
    setLoadingOffsets(true)
    try {
      const res = await api.get<KafkaOffsetsResponse>(`/api/resources/${resourceId}/kafka/topics/${encodeURIComponent(name)}/offsets`)
      setOffsets(res.data.partitions ?? [])
    } catch (err: unknown) {
      toast.error('Load failed', errMessage(err, 'Could not load partition offsets'))
      setOffsets([])
    } finally {
      setLoadingOffsets(false)
    }
  }

  async function loadMessages(topic: string, p: number, limit: number) {
    setLoadingMessages(true)
    try {
      const res = await api.get<KafkaMessagesResponse>(`/api/resources/${resourceId}/kafka/topics/${encodeURIComponent(topic)}/messages`, {
        params: { partition: p, limit },
      })
      setMessages(res.data.messages ?? [])
    } catch (err: unknown) {
      toast.error('Load failed', errMessage(err, 'Could not load messages'))
    } finally {
      setLoadingMessages(false)
    }
  }

  useEffect(() => {
    if (selection?.kind === 'topic') loadMessages(selection.name, partition, messageLimit)
  }, [selection, partition]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedGroup = selection?.kind === 'group' ? groups.find(g => g.group_id === selection.id) : undefined

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <Box sx={{ width: 260, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>Kafka</Typography>
          <Tooltip title="Refresh">
            <IconButton size="small" aria-label="Refresh" onClick={loadLists}><RefreshCw size={12} /></IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loadingList ? (
            <Box sx={{ p: 2.5 }}><Loading>Loading…</Loading></Box>
          ) : (
            <List dense disablePadding>
              <ListItemButton onClick={() => setTopicsOpen(o => !o)} aria-expanded={topicsOpen} sx={{ gap: 0.75, px: 1.5, py: 0.75 }}>
                {topicsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Layers size={13} />
                <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}>Topics ({topics.length})</Typography>
              </ListItemButton>
              {topicsOpen && topics.map(t => {
                const sel = selection?.kind === 'topic' && selection.name === t.name
                return (
                  <ListItemButton key={t.name} selected={sel} onClick={() => selectTopic(t.name)}
                    sx={{ justifyContent: 'space-between', py: 0.5, pl: 4, pr: 1.5, ...monoCell, color: sel ? 'primary.main' : 'text.secondary' }}>
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</Box>
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: 0.75 }}>{t.partitions}p</Typography>
                  </ListItemButton>
                )
              })}
              {topics.length === 0 && topicsOpen && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4, pb: 1 }}>No topics.</Typography>
              )}

              <ListItemButton onClick={() => setGroupsOpen(o => !o)} aria-expanded={groupsOpen} sx={{ gap: 0.75, px: 1.5, py: 0.75, mt: 0.75 }}>
                {groupsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Users size={13} />
                <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}>Consumer groups ({groups.length})</Typography>
              </ListItemButton>
              {groupsOpen && groups.map(g => {
                const sel = selection?.kind === 'group' && selection.id === g.group_id
                return (
                  <ListItemButton key={g.group_id} selected={sel} onClick={() => setSelection({ kind: 'group', id: g.group_id })}
                    sx={{ justifyContent: 'space-between', py: 0.5, pl: 4, pr: 1.5, ...monoCell, color: sel ? 'primary.main' : 'text.secondary' }}>
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.group_id}</Box>
                    {g.total_lag > 0 && (
                      <Typography component="span" variant="caption" sx={{ color: 'warning.main', flexShrink: 0, ml: 0.75 }}>lag {g.total_lag}</Typography>
                    )}
                  </ListItemButton>
                )
              })}
              {groups.length === 0 && groupsOpen && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4, pb: 1 }}>No consumer groups.</Typography>
              )}
            </List>
          )}
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: selection ? 2.5 : 0 }}>
        {!selection ? (
          <Box sx={{ p: 5, textAlign: 'center', color: 'text.secondary', fontSize: 13 }}>
            <Layers size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div>Select a topic or consumer group.</div>
          </Box>
        ) : selection.kind === 'topic' ? (
          <div>
            <Typography sx={{ ...monoCell, fontSize: 14, fontWeight: 600, mb: 2 }}>{selection.name}</Typography>

            <Box sx={{ mb: 0.75 }}><SectionLabel>Partitions</SectionLabel></Box>
            {loadingOffsets ? (
              <Box sx={{ mb: 2 }}><Loading>Loading offsets…</Loading></Box>
            ) : (
              <Table size="small" sx={{ mb: 2.5 }}>
                <TableHead><TableRow>
                  <TableCell sx={headCell}>Partition</TableCell><TableCell sx={headCell}>Low</TableCell><TableCell sx={headCell}>High</TableCell><TableCell sx={headCell}>Count</TableCell><TableCell />
                </TableRow></TableHead>
                <TableBody>
                  {offsets.map(o => (
                    <TableRow key={o.partition} hover selected={partition === o.partition} sx={{ cursor: 'pointer' }} onClick={() => setPartition(o.partition)}>
                      <TableCell sx={monoCell}>{o.partition}</TableCell>
                      <TableCell sx={monoCell}>{o.low}</TableCell>
                      <TableCell sx={monoCell}>{o.high}</TableCell>
                      <TableCell sx={monoCell}>{o.high - o.low}</TableCell>
                      <TableCell sx={monoCell}>{partition === o.partition && <Box component="span" sx={{ color: 'primary.main', fontSize: 11 }}>viewing ▸</Box>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
              <SectionLabel><MessageSquare size={12} /> Recent messages — partition {partition}</SectionLabel>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <TextField size="small" type="number" value={messageLimit}
                  onChange={e => setMessageLimit(Number(e.target.value) || 20)}
                  sx={{ width: 76, '& input': { py: 0.5, px: 1, fontSize: 12 } }}
                  slotProps={{ htmlInput: { min: 1, max: 200, 'aria-label': 'Message limit' } }} />
                <Tooltip title="Refresh messages">
                  <IconButton size="small" aria-label="Refresh messages" onClick={() => loadMessages(selection.name, partition, messageLimit)}>
                    <RefreshCw size={12} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            {loadingMessages ? (
              <Loading>Loading messages…</Loading>
            ) : messages.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No messages on this partition.</Typography>
            ) : (
              <Table size="small">
                <TableHead><TableRow>
                  <TableCell sx={headCell}>Offset</TableCell><TableCell sx={headCell}>Key</TableCell><TableCell sx={headCell}>Value</TableCell><TableCell sx={headCell}>Time</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {messages.map(m => (
                    <TableRow key={m.offset}>
                      <TableCell sx={monoCell}>{m.offset}</TableCell>
                      <TableCell sx={{ ...monoCell, color: 'text.secondary' }}>{m.key || <em>—</em>}</TableCell>
                      <TableCell sx={{ ...monoCell, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{m.value}</TableCell>
                      <TableCell sx={{ ...monoCell, color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtTime(m.timestamp)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        ) : (
          <div>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
              <Typography sx={{ ...monoCell, fontSize: 14, fontWeight: 600 }}>{selection.id}</Typography>
              {selectedGroup && <Typography variant="caption" color="text.secondary">{selectedGroup.protocol_type}</Typography>}
            </Box>
            {selectedGroup && (
              <Typography variant="body2" sx={{ color: selectedGroup.total_lag > 0 ? 'warning.main' : 'success.main', mb: 2 }}>
                Total lag: {selectedGroup.total_lag}
              </Typography>
            )}
            <Table size="small">
              <TableHead><TableRow>
                <TableCell sx={headCell}>Topic</TableCell><TableCell sx={headCell}>Partition</TableCell><TableCell sx={headCell}>Committed</TableCell><TableCell sx={headCell}>High watermark</TableCell><TableCell sx={headCell}>Lag</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {(selectedGroup?.partitions ?? []).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell sx={monoCell}>{p.topic}</TableCell>
                    <TableCell sx={monoCell}>{p.partition}</TableCell>
                    <TableCell sx={monoCell}>{p.committed_offset}</TableCell>
                    <TableCell sx={monoCell}>{p.high_watermark}</TableCell>
                    <TableCell sx={{ ...monoCell, color: p.lag > 0 ? 'warning.main' : 'text.secondary' }}>{p.lag}</TableCell>
                  </TableRow>
                ))}
                {(!selectedGroup || selectedGroup.partitions.length === 0) && (
                  <TableRow><TableCell sx={monoCell} colSpan={5}>No committed offsets for this group.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Box>
    </Box>
  )
}
