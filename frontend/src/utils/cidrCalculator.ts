import { intToIp, ipToInt, netmaskForPrefix, usableHostCount, usableRange } from './ipv4'

// IPv4 CIDR math only — covers the day-to-day case (VPC subnets, k8s pod/service
// CIDRs, firewall rules). IPv6 lives in ipv6.ts, where 128-bit arithmetic needs
// BigInt rather than the 32-bit bitwise ops these share with ipv4.ts.

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

  const maskInt = netmaskForPrefix(prefix)
  const wildcardInt = (~maskInt) >>> 0
  const networkInt = (ipInt & maskInt) >>> 0
  const broadcastInt = (networkInt | wildcardInt) >>> 0
  const totalAddresses = Math.pow(2, 32 - prefix)

  // /31 (RFC 3021 point-to-point) and /32 (single host) have no
  // network/broadcast pair to reserve — usableRange/usableHostCount handle it.
  const [firstUsable, lastUsable] = usableRange(networkInt, broadcastInt, prefix)
  const usableHosts = usableHostCount(prefix)

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
