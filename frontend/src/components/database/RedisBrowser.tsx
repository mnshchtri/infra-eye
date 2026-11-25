import { useEffect, useState } from 'react'
import {
  Search, Trash2, Plus, X, Save, Key as KeyIcon, Clock, RefreshCw,
} from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Chip from '@mui/material/Chip'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import { Button, Spinner } from '../ui'
import { api } from '../../api/client'
import { useToastStore } from '../../store/toastStore'
import { errMessage } from '../../utils/errors'
import type { RedisKeysResponse, RedisKeyDetail, RedisType, ZMember } from '../../types/redis'

interface RedisBrowserProps {
  resourceId: number
  canEdit: boolean
}

const typeColor: Record<RedisType, 'primary' | 'success' | 'warning' | 'info' | 'error'> = {
  string: 'primary', hash: 'success', list: 'warning', set: 'info', zset: 'error',
}

const monoInputSx = { '& input': { fontFamily: 'var(--font-mono)', fontSize: 12.5 } }

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip title={label}>
      <IconButton size="small" color="error" aria-label={label} onClick={onClick}><X size={13} /></IconButton>
    </Tooltip>
  )
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
      const keys = res.data.keys ?? []
      setKeys(prev => reset ? keys : [...prev, ...keys])
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
    <Box sx={{ display: 'flex', height: '100%' }}>
      <Box sx={{ width: 260, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ p: 1.25, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.75, alignItems: 'center' }}>
          <TextField
            size="small" fullWidth value={pattern} onChange={e => setPattern(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') loadKeys(true) }}
            placeholder="pattern (e.g. user:*)"
            sx={{ '& input': { fontFamily: 'var(--font-mono)', fontSize: 12, py: 0.75 } }}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start"><Search size={12} /></InputAdornment> },
              htmlInput: { 'aria-label': 'Key pattern' },
            }}
          />
          <Tooltip title="Scan">
            <IconButton size="small" aria-label="Scan" onClick={() => loadKeys(true)}><RefreshCw size={13} /></IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loadingKeys && keys.length === 0 ? (
            <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 13 }}>
              <Spinner size={14} /> Scanning…
            </Box>
          ) : keys.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No keys match.</Typography>
          ) : (
            <>
              <List dense disablePadding>
                {keys.map(key => (
                  <ListItemButton key={key} selected={selectedKey === key} onClick={() => selectKey(key)}
                    sx={{ gap: 0.75, py: 0.5, px: 1.5, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: selectedKey === key ? 'primary.main' : 'text.secondary' }}>
                    <KeyIcon size={11} style={{ flexShrink: 0 }} />
                    <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</Box>
                  </ListItemButton>
                ))}
              </List>
              {cursor !== '0' && (
                <Box sx={{ p: 1.25 }}>
                  <Button variant="secondary" size="sm" onClick={() => loadKeys(false)} loading={loadingKeys} style={{ width: '100%' }}>Load more</Button>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: selectedKey ? 2.5 : 0 }}>
        {!selectedKey ? (
          <Box sx={{ p: 5, textAlign: 'center', color: 'text.secondary', fontSize: 13 }}>
            <KeyIcon size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div>Select a key to view its value.</div>
          </Box>
        ) : loadingDetail || !detail ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
            <Spinner size={16} /> Loading {selectedKey}…
          </Box>
        ) : (
          <div>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Typography component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>{detail.key}</Typography>
                <Chip size="small" color={typeColor[detail.type]} label={detail.type} />
              </Box>
              {canEdit && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 12, color: 'text.secondary' }}>
                    <Clock size={12} />
                    <TextField size="small" value={draftTtl} onChange={e => setDraftTtl(e.target.value)} placeholder="no expiry"
                      sx={{ width: 110, '& input': { fontFamily: 'var(--font-mono)', fontSize: 12, py: 0.5 } }}
                      slotProps={{ htmlInput: { 'aria-label': 'TTL in seconds' } }} />
                    sec
                  </Box>
                  <Button size="sm" onClick={save} loading={saving} icon={<Save size={13} />}>Save</Button>
                  <Tooltip title="Delete key">
                    <IconButton color="error" aria-label="Delete key" onClick={() => deleteKey(detail.key)}><Trash2 size={14} /></IconButton>
                  </Tooltip>
                </Box>
              )}
              {!canEdit && (
                <Typography variant="caption" color="text.secondary">TTL: {fmtTtl(detail.ttl_seconds)}</Typography>
              )}
            </Box>

            {detail.type === 'string' && (
              <TextField fullWidth multiline minRows={9} value={draftString} onChange={e => setDraftString(e.target.value)} disabled={!canEdit}
                sx={{ '& textarea': { fontFamily: 'var(--font-mono)', fontSize: 13 } }}
                slotProps={{ htmlInput: { 'aria-label': 'Value' } }} />
            )}

            {detail.type === 'hash' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {draftFields.map((f, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    <TextField size="small" sx={{ flex: 1, ...monoInputSx }} value={f.k} disabled={!canEdit} placeholder="field"
                      onChange={e => setDraftFields(prev => prev.map((x, j) => j === i ? { ...x, k: e.target.value } : x))}
                      slotProps={{ htmlInput: { 'aria-label': `Field name ${i + 1}` } }} />
                    <TextField size="small" sx={{ flex: 2, ...monoInputSx }} value={f.v} disabled={!canEdit} placeholder="value"
                      onChange={e => setDraftFields(prev => prev.map((x, j) => j === i ? { ...x, v: e.target.value } : x))}
                      slotProps={{ htmlInput: { 'aria-label': `Field value ${i + 1}` } }} />
                    {canEdit && <RemoveButton label="Remove field" onClick={() => setDraftFields(prev => prev.filter((_, j) => j !== i))} />}
                  </Box>
                ))}
                {canEdit && (
                  <Box><Button variant="secondary" size="sm" onClick={() => setDraftFields(prev => [...prev, { k: '', v: '' }])} icon={<Plus size={13} />}>Add field</Button></Box>
                )}
              </Box>
            )}

            {(detail.type === 'list' || detail.type === 'set') && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {draftItems.map((v, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    <TextField size="small" fullWidth sx={monoInputSx} value={v} disabled={!canEdit}
                      onChange={e => setDraftItems(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                      slotProps={{ htmlInput: { 'aria-label': `Item ${i + 1}` } }} />
                    {canEdit && <RemoveButton label="Remove item" onClick={() => setDraftItems(prev => prev.filter((_, j) => j !== i))} />}
                  </Box>
                ))}
                {canEdit && (
                  <Box><Button variant="secondary" size="sm" onClick={() => setDraftItems(prev => [...prev, ''])} icon={<Plus size={13} />}>Add item</Button></Box>
                )}
              </Box>
            )}

            {detail.type === 'zset' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {draftMembers.map((m, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                    <TextField size="small" sx={{ flex: 2, ...monoInputSx }} value={m.member} disabled={!canEdit} placeholder="member"
                      onChange={e => setDraftMembers(prev => prev.map((x, j) => j === i ? { ...x, member: e.target.value } : x))}
                      slotProps={{ htmlInput: { 'aria-label': `Member ${i + 1}` } }} />
                    <TextField size="small" type="number" sx={{ width: 120, ...monoInputSx }} value={m.score} disabled={!canEdit} placeholder="score"
                      onChange={e => setDraftMembers(prev => prev.map((x, j) => j === i ? { ...x, score: Number(e.target.value) } : x))}
                      slotProps={{ htmlInput: { 'aria-label': `Score ${i + 1}` } }} />
                    {canEdit && <RemoveButton label="Remove member" onClick={() => setDraftMembers(prev => prev.filter((_, j) => j !== i))} />}
                  </Box>
                ))}
                {canEdit && (
                  <Box><Button variant="secondary" size="sm" onClick={() => setDraftMembers(prev => [...prev, { member: '', score: 0 }])} icon={<Plus size={13} />}>Add member</Button></Box>
                )}
              </Box>
            )}
          </div>
        )}
      </Box>
    </Box>
  )
}
