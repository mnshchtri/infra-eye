// Shared IPv4 address math for the networking tools (CIDR calculator, subnet
// splitter, overlap checker). IPv6 lives in ipv6.ts — it needs BigInt.
//
// Addresses are handled as unsigned 32-bit integers. Every bitwise result is
// pushed back through `>>> 0` because JS bitwise ops produce signed int32,
// which would turn anything at or above 128.0.0.0 negative.

export function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = parseInt(p, 10)
    if (v < 0 || v > 255) return null
    n = (n << 8) | v
  }
  return n >>> 0
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 0xff).join('.')
}

export function isValidIpv4(ip: string): boolean {
  return ipToInt(ip.trim()) !== null
}

export function netmaskForPrefix(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

export interface ParsedCidr {
  // The block as written, trimmed.
  input: string
  // The address as written, which may carry host bits (e.g. 10.0.0.5/24).
  ip: string
  prefix: number
  mask: number
  network: number
  broadcast: number
  // 2^(32-prefix) — a plain number, since /0 is 2^32 and stays exact.
  size: number
  // True when the written address had host bits set, i.e. it is not the
  // network address of its own block. Worth surfacing: it usually means a
  // typo'd firewall rule or route.
  hasHostBits: boolean
}

export type ParseCidrResult = { ok: true; value: ParsedCidr } | { ok: false; error: string }

// Parses "10.0.0.0/24". A bare address is accepted and treated as a /32 host
// route when `allowBareIp` is set, which is what the match/overlap tool wants.
export function parseCidr(input: string, allowBareIp = false): ParseCidrResult {
  const trimmed = input.trim()
  const match = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\/(\d{1,2}))?$/)
  if (!match) {
    return { ok: false, error: allowBareIp ? 'Expected an IPv4 address or CIDR block' : 'Expected an IPv4 CIDR block, e.g. 10.0.0.0/24' }
  }

  const [, ip, prefixStr] = match
  if (prefixStr === undefined && !allowBareIp) {
    return { ok: false, error: 'Missing prefix length, e.g. 10.0.0.0/24' }
  }

  const prefix = prefixStr === undefined ? 32 : parseInt(prefixStr, 10)
  if (prefix > 32) return { ok: false, error: 'Prefix length must be between 0 and 32' }

  const ipInt = ipToInt(ip)
  if (ipInt === null) return { ok: false, error: `"${ip}" is not a valid IPv4 address (each octet must be 0-255)` }

  const mask = netmaskForPrefix(prefix)
  const network = (ipInt & mask) >>> 0
  const size = Math.pow(2, 32 - prefix)
  const broadcast = (network + size - 1) >>> 0

  return {
    ok: true,
    value: { input: trimmed, ip, prefix, mask, network, broadcast, size, hasHostBits: ipInt !== network },
  }
}

// Usable host count, following the same rules the CIDR calculator shows:
// /31 is an RFC 3021 point-to-point link (both addresses usable) and /32 is a
// single host, so neither reserves a network/broadcast pair.
export function usableHostCount(prefix: number): number {
  if (prefix === 32) return 1
  if (prefix === 31) return 2
  return Math.pow(2, 32 - prefix) - 2
}

// First/last host addresses of a block, with the same /31 and /32 handling.
export function usableRange(network: number, broadcast: number, prefix: number): [string, string] {
  if (prefix >= 31) return [intToIp(network), intToIp(broadcast)]
  return [intToIp(network + 1), intToIp(broadcast - 1)]
}
