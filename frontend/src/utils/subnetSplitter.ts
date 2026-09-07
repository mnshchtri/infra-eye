import { intToIp, parseCidr, usableHostCount, usableRange } from './ipv4'

// Splits an IPv4 block into equal-sized subnets — the VPC/subnet planning step
// that follows a CIDR lookup. Two ways to ask for it: by target prefix
// ("carve /16 into /20s") or by count ("I need 6 subnets, pick the size").

// Listing every subnet of a large split would be millions of rows, so the
// table is capped and the caller is told the real total.
const MAX_LISTED_SUBNETS = 512

export interface Subnet {
  index: number
  cidr: string
  network: string
  firstUsable: string
  lastUsable: string
  broadcast: string
  usableHosts: number
  totalAddresses: number
}

export type SplitMode = 'prefix' | 'count'

export interface SplitResult {
  // The parent block, normalized to its network address.
  block: string
  blockPrefix: number
  newPrefix: number
  // How many subnets the split actually produces (always a power of two).
  totalSubnets: number
  // How many the caller asked for, when splitting by count — the remainder
  // are spare capacity, not waste to hide.
  requestedSubnets?: number
  subnets: Subnet[]
  listTruncated: boolean
  hostsPerSubnet: number
  // Set when the input carried host bits (10.0.5.7/16), so the UI can say the
  // split was done on the enclosing network rather than silently "fixing" it.
  normalizedFrom?: string
}

export type SplitCidrResult = { ok: true; result: SplitResult } | { ok: false; error: string }

export function splitCidr(block: string, mode: SplitMode, value: number): SplitCidrResult {
  const parsed = parseCidr(block)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const { prefix: blockPrefix, network, size } = parsed.value

  if (!Number.isFinite(value) || value < 1) {
    return { ok: false, error: mode === 'prefix' ? 'Enter a target prefix length' : 'Enter how many subnets you need' }
  }

  let newPrefix: number
  let requestedSubnets: number | undefined

  if (mode === 'prefix') {
    newPrefix = Math.trunc(value)
    if (newPrefix > 32) return { ok: false, error: 'Target prefix must be between 0 and 32' }
    if (newPrefix < blockPrefix) {
      return { ok: false, error: `/${newPrefix} is larger than the block itself — pick a prefix of /${blockPrefix} or longer` }
    }
  } else {
    requestedSubnets = Math.trunc(value)
    // Subnets divide on power-of-two boundaries, so 6 subnets means borrowing
    // 3 bits and getting 8 — the caller sees both numbers.
    const bitsNeeded = Math.ceil(Math.log2(requestedSubnets))
    newPrefix = blockPrefix + bitsNeeded
    if (newPrefix > 32) {
      const maxSubnets = Math.pow(2, 32 - blockPrefix)
      return { ok: false, error: `/${blockPrefix} can only be divided into ${maxSubnets.toLocaleString()} subnets at most (down to /32)` }
    }
  }

  const subnetSize = Math.pow(2, 32 - newPrefix)
  const totalSubnets = size / subnetSize
  const listCount = Math.min(totalSubnets, MAX_LISTED_SUBNETS)

  const subnets: Subnet[] = []
  for (let i = 0; i < listCount; i++) {
    const subnetNetwork = network + i * subnetSize
    const subnetBroadcast = subnetNetwork + subnetSize - 1
    const [firstUsable, lastUsable] = usableRange(subnetNetwork, subnetBroadcast, newPrefix)
    subnets.push({
      index: i + 1,
      cidr: `${intToIp(subnetNetwork)}/${newPrefix}`,
      network: intToIp(subnetNetwork),
      firstUsable,
      lastUsable,
      broadcast: intToIp(subnetBroadcast),
      usableHosts: usableHostCount(newPrefix),
      totalAddresses: subnetSize,
    })
  }

  return {
    ok: true,
    result: {
      block: `${intToIp(network)}/${blockPrefix}`,
      blockPrefix,
      newPrefix,
      totalSubnets,
      requestedSubnets,
      subnets,
      listTruncated: totalSubnets > listCount,
      hostsPerSubnet: usableHostCount(newPrefix),
      normalizedFrom: parsed.value.hasHostBits ? parsed.value.input : undefined,
    },
  }
}
