// IPv4 CIDR math only — covers the day-to-day case (VPC subnets, k8s pod/service
// CIDRs, firewall rules). IPv6 needs 128-bit arithmetic that doesn't fit
// comfortably in JS numbers/bitwise ops and isn't worth the added complexity here.

export interface CidrResult {
  input: string
  ip: string
  prefix: number
  netmask: string
  wildcardMask: string
  networkAddress: string
  broadcastAddress: string
  firstUsable: string
  lastUsable: string
  totalAddresses: number
  usableHosts: number
  ipClass: string
  previousSubnet: string
  nextSubnet: string
}

export type CidrCalcResult = { ok: true; result: CidrResult } | { ok: false; error: string }

function ipToInt(ip: string): number | null {
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

function intToIp(n: number): string {
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 0xff).join('.')
}

function classify(firstOctet: number): string {
  if (firstOctet < 128) return 'A'
  if (firstOctet < 192) return 'B'
  if (firstOctet < 224) return 'C'
  if (firstOctet < 240) return 'D (multicast)'
  return 'E (reserved)'
}

export function calculateCidr(input: string): CidrCalcResult {
  const trimmed = input.trim()
  const match = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/)
  if (!match) return { ok: false, error: 'Enter an IPv4 CIDR block, e.g. 10.0.0.0/24' }

  const [, ip, prefixStr] = match
  const prefix = parseInt(prefixStr, 10)
  if (prefix < 0 || prefix > 32) return { ok: false, error: 'Prefix length must be between 0 and 32.' }

  const ipInt = ipToInt(ip)
  if (ipInt === null) return { ok: false, error: `"${ip}" is not a valid IPv4 address (each octet must be 0-255).` }

  const maskInt = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const wildcardInt = (~maskInt) >>> 0
  const networkInt = (ipInt & maskInt) >>> 0
  const broadcastInt = (networkInt | wildcardInt) >>> 0
  const totalAddresses = Math.pow(2, 32 - prefix)

  let firstUsable: string
  let lastUsable: string
  let usableHosts: number
  if (prefix >= 31) {
    // /31 (RFC 3021 point-to-point) and /32 (single host) — no network/broadcast split
    firstUsable = intToIp(networkInt)
    lastUsable = intToIp(broadcastInt)
    usableHosts = prefix === 32 ? 1 : 2
  } else {
    firstUsable = intToIp(networkInt + 1)
    lastUsable = intToIp(broadcastInt - 1)
    usableHosts = totalAddresses - 2
  }

  const prevNetworkInt = (networkInt - totalAddresses) >>> 0
  const nextNetworkInt = (networkInt + totalAddresses) >>> 0

  return {
    ok: true,
    result: {
      input: trimmed,
      ip,
      prefix,
      netmask: intToIp(maskInt),
      wildcardMask: intToIp(wildcardInt),
      networkAddress: intToIp(networkInt),
      broadcastAddress: intToIp(broadcastInt),
      firstUsable,
      lastUsable,
      totalAddresses,
      usableHosts,
      ipClass: classify(ipInt >>> 24),
      previousSubnet: `${intToIp(prevNetworkInt)}/${prefix}`,
      nextSubnet: `${intToIp(nextNetworkInt)}/${prefix}`,
    },
  }
}
