import { ipToInt, intToIp } from './ipv4'

// IPv6 address and prefix math. Unlike IPv4 this needs 128-bit arithmetic, so
// everything runs on BigInt rather than the 32-bit bitwise ops in ipv4.ts.

const BITS = 128n
const FULL_MASK = (1n << BITS) - 1n

// Well-known prefixes, most specific first — the first match wins.
const ADDRESS_TYPES: { prefix: string; length: number; label: string }[] = [
  { prefix: '::', length: 128, label: 'Unspecified (::)' },
  { prefix: '::1', length: 128, label: 'Loopback (::1)' },
  { prefix: '::ffff:0:0', length: 96, label: 'IPv4-mapped (RFC 4291)' },
  { prefix: '64:ff9b::', length: 96, label: 'IPv4/IPv6 translation — NAT64 (RFC 6052)' },
  { prefix: '2001:db8::', length: 32, label: 'Documentation (RFC 3849)' },
  { prefix: '2001::', length: 32, label: 'Teredo tunneling (RFC 4380)' },
  { prefix: '2002::', length: 16, label: '6to4 (RFC 3056)' },
  { prefix: 'ff00::', length: 8, label: 'Multicast' },
  { prefix: 'fe80::', length: 10, label: 'Link-local unicast' },
  { prefix: 'fc00::', length: 7, label: 'Unique local — ULA (RFC 4193)' },
  { prefix: '2000::', length: 3, label: 'Global unicast' },
]

// Parses an address (no prefix) into its 128-bit value. Accepts "::"
// compression, an embedded IPv4 tail (::ffff:192.0.2.1), and a zone id, which
// is scope-local and dropped.
function parseAddress(text: string): bigint | null {
  let addr = text.trim()
  if (!addr) return null

  const zoneIndex = addr.indexOf('%')
  if (zoneIndex >= 0) addr = addr.slice(0, zoneIndex)

  // An embedded IPv4 tail occupies the low 32 bits — rewrite it as two hex
  // groups so the rest of the parser only ever sees hextets.
  const lastColon = addr.lastIndexOf(':')
  if (lastColon >= 0 && addr.slice(lastColon + 1).includes('.')) {
    const v4 = ipToInt(addr.slice(lastColon + 1))
    if (v4 === null) return null
    addr = `${addr.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`
  } else if (addr.includes('.')) {
    return null
  }

  let groups: string[]
  const doubleColons = addr.split('::').length - 1
  if (doubleColons > 1) return null

  if (doubleColons === 1) {
    const [left, right] = addr.split('::')
    const head = left ? left.split(':') : []
    const tail = right ? right.split(':') : []
    // "::" must stand for at least one all-zero group.
    const fill = 8 - head.length - tail.length
    if (fill < 1) return null
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail]
  } else {
    groups = addr.split(':')
    if (groups.length !== 8) return null
  }

  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  return value
}

function toGroups(value: bigint): string[] {
  const groups: string[] = []
  for (let i = 7; i >= 0; i--) {
    groups.push(((value >> BigInt(i * 16)) & 0xffffn).toString(16))
  }
  return groups
}

export function expandIpv6(value: bigint): string {
  return toGroups(value).map(g => g.padStart(4, '0')).join(':')
}

// RFC 5952 canonical form: lowercase, no leading zeros, and "::" replacing the
// longest run of two or more zero groups (leftmost run on a tie).
export function compressIpv6(value: bigint): string {
  const groups = toGroups(value)

  let bestStart = -1
  let bestLength = 0
  let runStart = -1
  let runLength = 0
  for (let i = 0; i < 8; i++) {
    if (groups[i] === '0') {
      if (runStart < 0) runStart = i
      runLength++
      if (runLength > bestLength) {
        bestLength = runLength
        bestStart = runStart
      }
    } else {
      runStart = -1
      runLength = 0
    }
  }

  if (bestLength < 2) return groups.join(':')
  const head = groups.slice(0, bestStart).join(':')
  const tail = groups.slice(bestStart + bestLength).join(':')
  return `${head}::${tail}`
}

// PTR name for reverse lookups: every nibble reversed, dot-separated.
export function ip6Arpa(value: bigint): string {
  const nibbles = expandIpv6(value).replace(/:/g, '').split('').reverse()
  return `${nibbles.join('.')}.ip6.arpa`
}

function maskForPrefix(prefix: number): bigint {
  if (prefix === 0) return 0n
  return (FULL_MASK << BigInt(128 - prefix)) & FULL_MASK
}

function classify(value: bigint): string {
  for (const type of ADDRESS_TYPES) {
    const base = parseAddress(type.prefix)
    if (base === null) continue
    const mask = maskForPrefix(type.length)
    if ((value & mask) === (base & mask)) return type.label
  }
  return 'Reserved / unassigned'
}

export interface Ipv6Result {
  input: string
  expanded: string
  compressed: string
  prefix: number
  // Present only when the input actually carried a "/prefix".
  hasPrefix: boolean
  network: string
  firstAddress: string
  lastAddress: string
  // "2^80" — the exponent form is the only readable one at these sizes.
  totalAddresses: string
  // Exact count, only when it fits in a sane number of digits.
  totalAddressesExact?: string
  type: string
  // Dotted-quad form of the low 32 bits, for IPv4-mapped/translated addresses.
  embeddedIpv4?: string
  ptrName: string
  // Set when the address carried host bits below its own prefix.
  hasHostBits: boolean
}

export type Ipv6AnalyzeResult = { ok: true; result: Ipv6Result } | { ok: false; error: string }

export function analyzeIpv6(input: string): Ipv6AnalyzeResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Enter an IPv6 address or prefix, e.g. 2001:db8::1/64' }

  const slashIndex = trimmed.lastIndexOf('/')
  const addressPart = slashIndex >= 0 ? trimmed.slice(0, slashIndex) : trimmed
  const prefixPart = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : ''

  let prefix = 128
  if (slashIndex >= 0) {
    if (!/^\d{1,3}$/.test(prefixPart)) return { ok: false, error: 'Prefix length must be a number between 0 and 128' }
    prefix = parseInt(prefixPart, 10)
    if (prefix > 128) return { ok: false, error: 'Prefix length must be between 0 and 128' }
  }

  const value = parseAddress(addressPart)
  if (value === null) return { ok: false, error: `"${addressPart}" is not a valid IPv6 address` }

  const mask = maskForPrefix(prefix)
  const network = value & mask
  const last = network | (FULL_MASK & ~mask)
  const hostBits = 128 - prefix

  const type = classify(value)
  const isIpv4Bearing = type.startsWith('IPv4-mapped') || type.startsWith('IPv4/IPv6 translation')

  // Below 2^64 the exact figure still reads as a number rather than noise.
  const exact = hostBits <= 64 ? (1n << BigInt(hostBits)).toLocaleString('en-US') : undefined

  return {
    ok: true,
    result: {
      input: trimmed,
      expanded: expandIpv6(value),
      compressed: compressIpv6(value),
      prefix,
      hasPrefix: slashIndex >= 0,
      network: `${compressIpv6(network)}/${prefix}`,
      firstAddress: compressIpv6(network),
      lastAddress: compressIpv6(last),
      totalAddresses: `2^${hostBits}`,
      totalAddressesExact: exact,
      type,
      embeddedIpv4: isIpv4Bearing ? intToIp(Number(value & 0xffffffffn)) : undefined,
      ptrName: ip6Arpa(value),
      hasHostBits: value !== network,
    },
  }
}
