// ── Redis key browser ──

export type RedisType = 'string' | 'hash' | 'list' | 'set' | 'zset'

export interface RedisKeysResponse {
  keys: string[]
  cursor: string // "0" means the scan is complete
}

export interface ZMember {
  member: string
  score: number
}

export interface RedisKeyDetail {
  key: string
  type: RedisType
  ttl_seconds: number // -1 = no expiry
  value: string | Record<string, string> | string[] | ZMember[]
}
