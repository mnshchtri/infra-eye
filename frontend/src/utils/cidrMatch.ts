import { intToIp, parseCidr, type ParsedCidr } from './ipv4'

// Answers the two questions that come up when a security group, NetworkPolicy,
// or route table doesn't behave: "is this address actually inside that block?"
// and "do any of these blocks collide with each other?".

export interface CidrEntry {
  input: string
  cidr?: string
  parsed?: ParsedCidr
  error?: string
}

export interface MatchRow {
  input: string
  error?: string
  // The block as a single host route (/32) or its own range, for display.
  range?: string
  // Every listed CIDR that fully contains this entry, longest-prefix first —
  // the order a router would consult them in.
  matchedBy: string[]
}

export type OverlapRelation = 'identical' | 'contains' | 'contained'

export interface OverlapRow {
  a: string
  b: string
  relation: OverlapRelation
}

export interface CidrMatchResult {
  cidrs: CidrEntry[]
  rows: MatchRow[]
  overlaps: OverlapRow[]
  // Blocks written with host bits set (10.0.0.5/24) — usually a typo, and the
  // kernel/cloud provider will silently normalize them.
  unnormalized: CidrEntry[]
}

function splitLines(text: string): string[] {
  // Accept newline-, comma-, or whitespace-separated lists, and ignore
  // "# comment" lines so a pasted rule file works as-is.
  return text
    .split('\n')
    .map(l => l.replace(/#.*$/, ''))
    .join('\n')
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// A contains B when B's whole range sits inside A's. CIDR blocks are aligned
// power-of-two ranges, so two blocks either nest or are disjoint — a partial
// overlap is impossible once both are normalized to their network address.
function contains(a: ParsedCidr, b: ParsedCidr): boolean {
  return a.network <= b.network && a.broadcast >= b.broadcast
}

export function analyzeCidrs(cidrText: string, testText: string): CidrMatchResult {
  const cidrs: CidrEntry[] = splitLines(cidrText).map(input => {
    const parsed = parseCidr(input, true)
    if (!parsed.ok) return { input, error: parsed.error }
    return {
      input,
      cidr: `${intToIp(parsed.value.network)}/${parsed.value.prefix}`,
      parsed: parsed.value,
    }
  })

  const valid = cidrs.filter((c): c is CidrEntry & { parsed: ParsedCidr; cidr: string } => !!c.parsed)

  const rows: MatchRow[] = splitLines(testText).map(input => {
    const parsed = parseCidr(input, true)
    if (!parsed.ok) return { input, error: parsed.error, matchedBy: [] }

    const target = parsed.value
    const matchedBy = valid
      .filter(c => contains(c.parsed, target))
      // Longest prefix first: the most specific block is the one that wins.
      .sort((a, b) => b.parsed.prefix - a.parsed.prefix)
      .map(c => c.cidr)

    const range = target.prefix === 32
      ? intToIp(target.network)
      : `${intToIp(target.network)} – ${intToIp(target.broadcast)}`

    return { input, range, matchedBy }
  })

  const overlaps: OverlapRow[] = []
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i]
      const b = valid[j]
      if (a.parsed.network === b.parsed.network && a.parsed.prefix === b.parsed.prefix) {
        overlaps.push({ a: a.cidr, b: b.cidr, relation: 'identical' })
      } else if (contains(a.parsed, b.parsed)) {
        overlaps.push({ a: a.cidr, b: b.cidr, relation: 'contains' })
      } else if (contains(b.parsed, a.parsed)) {
        overlaps.push({ a: a.cidr, b: b.cidr, relation: 'contained' })
      }
    }
  }

  return {
    cidrs,
    rows,
    overlaps,
    unnormalized: cidrs.filter(c => c.parsed?.hasHostBits),
  }
}
