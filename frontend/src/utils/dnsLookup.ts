import { errMessage } from './errors'

// DNS lookups over Cloudflare's DNS-over-HTTPS JSON endpoint.
//
// NOTE: this is the one Developer Tools utility that leaves the browser. The
// queried name is sent to a third party, so the UI says so plainly rather than
// letting it look like the local-only tools around it.
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query'
export const DOH_RESOLVER = 'cloudflare-dns.com'

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'PTR', 'CAA'] as const
export type DnsRecordType = typeof DNS_RECORD_TYPES[number]

// Numeric rrtype → name, for rendering answers whose type differs from the
// query (a CNAME in an A lookup's answer chain, most commonly).
const RRTYPE_NAMES: Record<number, string> = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 35: 'NAPTR', 43: 'DS', 46: 'RRSIG', 48: 'DNSKEY',
  257: 'CAA', 64: 'SVCB', 65: 'HTTPS',
}

// RCODEs worth explaining; anything else falls back to its number.
const RCODE_MESSAGES: Record<number, string> = {
  1: 'FORMERR — the resolver rejected the query as malformed',
  2: 'SERVFAIL — the authoritative server failed to answer (often a broken DNSSEC chain)',
  3: 'NXDOMAIN — the name does not exist',
  4: 'NOTIMP — the resolver does not implement this query type',
  5: 'REFUSED — the resolver refused to answer',
}

export interface DnsAnswer {
  name: string
  type: string
  ttl: number
  data: string
}

export interface DnsLookupResult {
  name: string
  type: DnsRecordType
  answers: DnsAnswer[]
  // Authority-section records — what a resolver returns instead of an answer
  // when the name exists but holds no record of the requested type.
  authority: DnsAnswer[]
  // True when the resolver validated the DNSSEC chain for this answer.
  authenticated: boolean
  // Set for a non-zero RCODE, explained rather than left as a bare number.
  status?: string
}

export type DnsResult = { ok: true; result: DnsLookupResult } | { ok: false; error: string }

interface DohAnswer { name?: string; type?: number; TTL?: number; data?: string }
interface DohResponse { Status?: number; AD?: boolean; Answer?: DohAnswer[]; Authority?: DohAnswer[]; Comment?: string }

function mapAnswers(records: DohAnswer[] | undefined): DnsAnswer[] {
  if (!Array.isArray(records)) return []
  return records.map(r => ({
    name: (r.name ?? '').replace(/\.$/, ''),
    type: RRTYPE_NAMES[r.type ?? -1] ?? `TYPE${r.type ?? '?'}`,
    ttl: typeof r.TTL === 'number' ? r.TTL : 0,
    data: r.data ?? '',
  }))
}

// A hostname, or an IPv4/IPv6 address for a PTR query. Deliberately permissive
// about the label charset so internationalized and underscore-prefixed names
// (_dmarc, _acme-challenge) go through.
function isQueryableName(name: string): boolean {
  if (!name || name.length > 253) return false
  if (/[\s/\\?#@]/.test(name)) return false
  return name.includes('.') || name.endsWith('.arpa') || name === 'localhost'
}

export async function lookupDns(name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsResult> {
  const trimmed = name.trim().replace(/\.$/, '')
  if (!trimmed) return { ok: false, error: 'Enter a hostname to look up' }
  if (!isQueryableName(trimmed)) {
    return { ok: false, error: `"${trimmed}" is not a queryable name — enter a fully-qualified hostname, e.g. api.example.com` }
  }

  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(trimmed)}&type=${type}`

  let response: Response
  try {
    response = await fetch(url, { headers: { Accept: 'application/dns-json' }, signal })
  } catch (e: unknown) {
    if (signal?.aborted) return { ok: false, error: 'Lookup cancelled' }
    return { ok: false, error: `Could not reach ${DOH_RESOLVER}: ${errMessage(e) || 'network error'}` }
  }

  if (!response.ok) {
    return { ok: false, error: `${DOH_RESOLVER} returned HTTP ${response.status} ${response.statusText}` }
  }

  let body: DohResponse
  try {
    body = await response.json() as DohResponse
  } catch (e: unknown) {
    return { ok: false, error: `Could not parse the resolver's response: ${errMessage(e) || 'invalid JSON'}` }
  }

  const status = body.Status ?? 0
  return {
    ok: true,
    result: {
      name: trimmed,
      type,
      answers: mapAnswers(body.Answer),
      authority: mapAnswers(body.Authority),
      authenticated: body.AD === true,
      status: status === 0 ? undefined : (RCODE_MESSAGES[status] ?? `RCODE ${status}`),
    },
  }
}
