import { useEffect, useState } from 'react'
import { Layers, Users, Loader2, RefreshCw, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
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

const cellStyle: React.CSSProperties = { padding: '6px 10px', fontSize: 12.5, fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border)' }
const headStyle: React.CSSProperties = { padding: '6px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border)' }

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
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Kafka</span>
          <button className="btn-icon" onClick={loadLists} title="Refresh" style={{ width: 26, height: 26 }}><RefreshCw size={12} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingList ? (
            <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12.5 }}>
              <Loader2 size={14} className="spin" /> Loading…
            </div>
          ) : (
            <>
              <button onClick={() => setTopicsOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 10px', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
              }}>
                {topicsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Layers size={13} /> Topics ({topics.length})
              </button>
              {topicsOpen && topics.map(t => (
                <button key={t.name} onClick={() => selectTopic(t.name)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 12px 6px 30px',
                    background: selection?.kind === 'topic' && selection.name === t.name ? 'var(--brand-glow)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: 12.5, fontFamily: 'var(--font-mono)', color: selection?.kind === 'topic' && selection.name === t.name ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 6 }}>{t.partitions}p</span>
                </button>
              ))}
              {topics.length === 0 && topicsOpen && (
                <div style={{ padding: '4px 12px 8px 30px', fontSize: 12, color: 'var(--text-muted)' }}>No topics.</div>
              )}

              <button onClick={() => setGroupsOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 10px', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 6,
              }}>
                {groupsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Users size={13} /> Consumer groups ({groups.length})
              </button>
              {groupsOpen && groups.map(g => (
                <button key={g.group_id} onClick={() => setSelection({ kind: 'group', id: g.group_id })}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 12px 6px 30px',
                    background: selection?.kind === 'group' && selection.id === g.group_id ? 'var(--brand-glow)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: 12.5, fontFamily: 'var(--font-mono)', color: selection?.kind === 'group' && selection.id === g.group_id ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.group_id}</span>
                  {g.total_lag > 0 && (
                    <span style={{ fontSize: 10.5, color: 'var(--warning)', flexShrink: 0, marginLeft: 6 }}>lag {g.total_lag}</span>
                  )}
                </button>
              ))}
              {groups.length === 0 && groupsOpen && (
                <div style={{ padding: '4px 12px 8px 30px', fontSize: 12, color: 'var(--text-muted)' }}>No consumer groups.</div>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: selection ? 20 : 0 }}>
        {!selection ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <Layers size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
            <div>Select a topic or consumer group.</div>
          </div>
        ) : selection.kind === 'topic' ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700 }}>{selection.name}</span>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Partitions</div>
            {loadingOffsets ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12.5, marginBottom: 16 }}>
                <Loader2 size={13} className="spin" /> Loading offsets…
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
                <thead><tr>
                  <th style={headStyle}>Partition</th><th style={headStyle}>Low</th><th style={headStyle}>High</th><th style={headStyle}>Count</th><th style={headStyle}></th>
                </tr></thead>
                <tbody>
                  {offsets.map(o => (
                    <tr key={o.partition} style={{ cursor: 'pointer', background: partition === o.partition ? 'var(--brand-glow)' : 'none' }}
                      onClick={() => setPartition(o.partition)}>
                      <td style={cellStyle}>{o.partition}</td>
                      <td style={cellStyle}>{o.low}</td>
                      <td style={cellStyle}>{o.high}</td>
                      <td style={cellStyle}>{o.high - o.low}</td>
                      <td style={cellStyle}>{partition === o.partition && <span style={{ color: 'var(--brand-primary)', fontSize: 11 }}>viewing ▸</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <MessageSquare size={12} /> Recent messages — partition {partition}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className="input" type="number" min={1} max={200} value={messageLimit}
                  onChange={e => setMessageLimit(Number(e.target.value) || 20)}
                  style={{ width: 64, fontSize: 12, padding: '4px 8px', height: 26 }} />
                <button className="btn-icon" onClick={() => loadMessages(selection.name, partition, messageLimit)} title="Refresh" style={{ width: 26, height: 26 }}>
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>
            {loadingMessages ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12.5 }}>
                <Loader2 size={13} className="spin" /> Loading messages…
              </div>
            ) : messages.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No messages on this partition.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={headStyle}>Offset</th><th style={headStyle}>Key</th><th style={headStyle}>Value</th><th style={headStyle}>Time</th>
                </tr></thead>
                <tbody>
                  {messages.map(m => (
                    <tr key={m.offset}>
                      <td style={cellStyle}>{m.offset}</td>
                      <td style={{ ...cellStyle, color: 'var(--text-muted)' }}>{m.key || <em>—</em>}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{m.value}</td>
                      <td style={{ ...cellStyle, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtTime(m.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700 }}>{selection.id}</span>
              {selectedGroup && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedGroup.protocol_type}</span>}
            </div>
            {selectedGroup && (
              <div style={{ fontSize: 12.5, color: selectedGroup.total_lag > 0 ? 'var(--warning)' : 'var(--success)', marginBottom: 16 }}>
                Total lag: {selectedGroup.total_lag}
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={headStyle}>Topic</th><th style={headStyle}>Partition</th><th style={headStyle}>Committed</th><th style={headStyle}>High watermark</th><th style={headStyle}>Lag</th>
              </tr></thead>
              <tbody>
                {(selectedGroup?.partitions ?? []).map((p, i) => (
                  <tr key={i}>
                    <td style={cellStyle}>{p.topic}</td>
                    <td style={cellStyle}>{p.partition}</td>
                    <td style={cellStyle}>{p.committed_offset}</td>
                    <td style={cellStyle}>{p.high_watermark}</td>
                    <td style={{ ...cellStyle, color: p.lag > 0 ? 'var(--warning)' : 'var(--text-secondary)' }}>{p.lag}</td>
                  </tr>
                ))}
                {(!selectedGroup || selectedGroup.partitions.length === 0) && (
                  <tr><td style={cellStyle} colSpan={5}>No committed offsets for this group.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
