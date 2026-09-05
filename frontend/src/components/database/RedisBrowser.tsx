import { useEffect, useState } from 'react'
import {
  Search, Loader2, Trash2, Plus, X, Save, Key as KeyIcon, Clock, RefreshCw,
} from 'lucide-react'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { errMessage } from '../../utils/errors'
import type { RedisKeysResponse, RedisKeyDetail, RedisType, ZMember } from '../../types/redis'

interface RedisBrowserProps {
  resourceId: number
  canEdit: boolean
}

const typeColor: Record<RedisType, string> = {
  string: 'var(--brand-primary)', hash: 'var(--success)', list: 'var(--warning)',
  set: 'var(--info)', zset: 'var(--danger)',
}

function fmtTtl(sec: number): string {
  if (sec < 0) return 'no expiry'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

/**
 * Key list (pattern-filtered, cursor-paginated via SCAN) + a detail panel
 * that edits a key's value as a whole, shaped per Redis type — the same
 * "replace" semantics the backend's PUT .../redis/key implements.
 */
export function RedisBrowser({ resourceId, canEdit }: RedisBrowserProps) {
  const toast = useToastStore()
  const [pattern, setPattern] = useState('*')
  const [keys, setKeys] = useState<string[]>([])
  const [cursor, setCursor] = useState('0')
  const [loadingKeys, setLoadingKeys] = useState(true)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<RedisKeyDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)

  // Draft editors per type
  const [draftString, setDraftString] = useState('')
  const [draftFields, setDraftFields] = useState<{ k: string; v: string }[]>([])
  const [draftItems, setDraftItems] = useState<string[]>([])
  const [draftMembers, setDraftMembers] = useState<ZMember[]>([])
  const [draftTtl, setDraftTtl] = useState<string>('')

  async function loadKeys(reset: boolean) {
    setLoadingKeys(true)
    try {
      const res = await api.get<RedisKeysResponse>(`/api/resources/${resourceId}/redis/keys`, {
        params: { pattern, cursor: reset ? '0' : cursor, count: 200 },
      })
      setKeys(prev => reset ? res.data.keys : [...prev, ...res.data.keys])
      setCursor(res.data.cursor)
    } catch (err: unknown) {
      toast.error('Scan failed', errMessage(err))
    } finally {
      setLoadingKeys(false)
    }
  }

  useEffect(() => { loadKeys(true) }, [resourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function selectKey(key: string) {
    setSelectedKey(key)
    setLoadingDetail(true)
    setDetail(null)
    try {
      const res = await api.get<RedisKeyDetail>(`/api/resources/${resourceId}/redis/key`, { params: { key } })
      setDetail(res.data)
      setDraftTtl(res.data.ttl_seconds >= 0 ? String(res.data.ttl_seconds) : '')
      if (res.data.type === 'string') setDraftString(res.data.value as string)
      else if (res.data.type === 'hash') setDraftFields(Object.entries(res.data.value as Record<string, string>).map(([k, v]) => ({ k, v })))
      else if (res.data.type === 'list' || res.data.type === 'set') setDraftItems([...(res.data.value as string[])])
      else if (res.data.type === 'zset') setDraftMembers([...(res.data.value as ZMember[])])
    } catch (err: unknown) {
      toast.error('Load failed', errMessage(err, 'Could not load key'))
    } finally {
      setLoadingDetail(false)
    }
  }

  async function save() {
    if (!detail) return
    setSaving(true)
    try {
      const ttlSeconds = draftTtl.trim() === '' ? null : Number(draftTtl)
      const body: Record<string, unknown> = { key: detail.key, type: detail.type, ttl_seconds: ttlSeconds }
      if (detail.type === 'string') body.string_value = draftString
      else if (detail.type === 'hash') body.fields = Object.fromEntries(draftFields.filter(f => f.k.trim() !== '').map(f => [f.k, f.v]))
      else if (detail.type === 'list' || detail.type === 'set') body.items = draftItems.filter(i => i !== '')
      else if (detail.type === 'zset') body.members = draftMembers

      await api.put(`/api/resources/${resourceId}/redis/key`, body)
      toast.success('Key saved', detail.key)
      selectKey(detail.key)
    } catch (err: unknown) {
      toast.error('Save failed', errMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function deleteKey(key: string) {
    try {
      await api.delete(`/api/resources/${resourceId}/redis/key`, { params: { key } })
      toast.success('Key deleted', key)
      setKeys(prev => prev.filter(k => k !== key))
      if (selectedKey === key) { setSelectedKey(null); setDetail(null) }
    } catch (err: unknown) {
      toast.error('Delete failed', errMessage(err))
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--text-muted)' }} />
            <input className="input" value={pattern} onChange={e => setPattern(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadKeys(true) }}
              placeholder="pattern (e.g. user:*)" style={{ fontSize: 12, padding: '6px 8px 6px 26px', height: 28, fontFamily: 'var(--font-mono)' }} />
          </div>
          <button className="btn-icon" onClick={() => loadKeys(true)} title="Scan" style={{ width: 28, height: 28 }}><RefreshCw size={13} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingKeys && keys.length === 0 ? (
            <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12.5 }}>
              <Loader2 size={14} className="spin" /> Scanning…
            </div>
          ) : keys.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-muted)' }}>No keys match.</div>
          ) : (
            <>
              {keys.map(key => (
                <button key={key} onClick={() => selectKey(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px',
                    background: selectedKey === key ? 'var(--brand-glow)' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: 12.5, fontFamily: 'var(--font-mono)', color: selectedKey === key ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  }}>
                  <KeyIcon size={11} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                </button>
              ))}
              {cursor !== '0' && (
                <button onClick={() => loadKeys(false)} disabled={loadingKeys} className="btn btn-secondary btn-sm" style={{ margin: 10, width: 'calc(100% - 20px)' }}>
                  {loadingKeys ? <Loader2 size={12} className="spin" /> : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: selectedKey ? 20 : 0 }}>
        {!selectedKey ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <KeyIcon size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
            <div>Select a key to view its value.</div>
          </div>
        ) : loadingDetail || !detail ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            <Loader2 size={16} className="spin" /> Loading {selectedKey}…
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700 }}>{detail.key}</span>
                <span style={{ padding: '2px 8px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: typeColor[detail.type], border: `1px solid ${typeColor[detail.type]}40` }}>{detail.type}</span>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                    <Clock size={12} />
                    <input className="input" value={draftTtl} onChange={e => setDraftTtl(e.target.value)} placeholder="no expiry"
                      style={{ width: 90, fontSize: 12, padding: '4px 8px', height: 26, fontFamily: 'var(--font-mono)' }} />
                    sec
                  </span>
                  <button className="btn btn-primary btn-sm" onClick={save} disabled={saving} style={{ gap: 6 }}>
                    {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save
                  </button>
                  <button className="btn-icon danger" onClick={() => deleteKey(detail.key)} title="Delete key" style={{ width: 30, height: 30 }}><Trash2 size={14} /></button>
                </div>
              )}
              {!canEdit && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>TTL: {fmtTtl(detail.ttl_seconds)}</span>
              )}
            </div>

            {detail.type === 'string' && (
              <textarea className="input" value={draftString} onChange={e => setDraftString(e.target.value)} disabled={!canEdit}
                style={{ width: '100%', minHeight: 200, fontFamily: 'var(--font-mono)', fontSize: 13, padding: 12 }} />
            )}

            {detail.type === 'hash' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {draftFields.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input className="input" value={f.k} disabled={!canEdit} placeholder="field"
                      onChange={e => setDraftFields(prev => prev.map((x, j) => j === i ? { ...x, k: e.target.value } : x))}
                      style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '6px 10px', height: 32 }} />
                    <input className="input" value={f.v} disabled={!canEdit} placeholder="value"
                      onChange={e => setDraftFields(prev => prev.map((x, j) => j === i ? { ...x, v: e.target.value } : x))}
                      style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '6px 10px', height: 32 }} />
                    {canEdit && <button className="btn-icon danger" onClick={() => setDraftFields(prev => prev.filter((_, j) => j !== i))} style={{ width: 32, height: 32 }}><X size={13} /></button>}
                  </div>
                ))}
                {canEdit && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setDraftFields(prev => [...prev, { k: '', v: '' }])} style={{ alignSelf: 'flex-start', gap: 6 }}>
                    <Plus size={13} /> Add field
                  </button>
                )}
              </div>
            )}

            {(detail.type === 'list' || detail.type === 'set') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {draftItems.map((v, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input className="input" value={v} disabled={!canEdit}
                      onChange={e => setDraftItems(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                      style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '6px 10px', height: 32 }} />
                    {canEdit && <button className="btn-icon danger" onClick={() => setDraftItems(prev => prev.filter((_, j) => j !== i))} style={{ width: 32, height: 32 }}><X size={13} /></button>}
                  </div>
                ))}
                {canEdit && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setDraftItems(prev => [...prev, ''])} style={{ alignSelf: 'flex-start', gap: 6 }}>
                    <Plus size={13} /> Add item
                  </button>
                )}
              </div>
            )}

            {detail.type === 'zset' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {draftMembers.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input className="input" value={m.member} disabled={!canEdit} placeholder="member"
                      onChange={e => setDraftMembers(prev => prev.map((x, j) => j === i ? { ...x, member: e.target.value } : x))}
                      style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '6px 10px', height: 32 }} />
                    <input className="input" type="number" value={m.score} disabled={!canEdit} placeholder="score"
                      onChange={e => setDraftMembers(prev => prev.map((x, j) => j === i ? { ...x, score: Number(e.target.value) } : x))}
                      style={{ width: 100, fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: '6px 10px', height: 32 }} />
                    {canEdit && <button className="btn-icon danger" onClick={() => setDraftMembers(prev => prev.filter((_, j) => j !== i))} style={{ width: 32, height: 32 }}><X size={13} /></button>}
                  </div>
                ))}
                {canEdit && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setDraftMembers(prev => [...prev, { member: '', score: 0 }])} style={{ alignSelf: 'flex-start', gap: 6 }}>
                    <Plus size={13} /> Add member
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
