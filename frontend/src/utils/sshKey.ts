// Reads OpenSSH public keys — one, or a whole authorized_keys file — and
// reports the fingerprints `ssh-keygen -l` would print, plus the key strength
// problems worth catching before a key is trusted on a server.
//
// Public keys only. A private key pasted here is refused rather than parsed.

// Key types OpenSSH emits. The declared type must match the one embedded in
// the blob; a mismatch means the line was corrupted or hand-edited.
const KEY_TYPES = [
  'ssh-rsa',
  'ssh-ed25519',
  'ssh-dss',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ssh-ed25519@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com',
  'ssh-rsa-cert-v01@openssh.com',
  'ssh-ed25519-cert-v01@openssh.com',
]

const CURVE_BITS: Record<string, number> = { nistp256: 256, nistp384: 384, nistp521: 521 }

// ── MD5 (RFC 1321) ───────────────────────────────────────────────────────
// WebCrypto deliberately omits MD5, but `ssh-keygen -E md5` and the AWS EC2
// console still show MD5 fingerprints, so matching a key against those needs
// a local implementation.

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const MD5_K = (() => {
  const k = new Uint32Array(64)
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
  return k
})()

function md5(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80

  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, bitLength >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true)

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476

  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }

      const sum = (f + a + MD5_K[i] + view.getUint32(chunk + g * 4, true)) >>> 0
      const shift = MD5_SHIFTS[i]
      a = d
      d = c
      c = b
      b = (b + (((sum << shift) | (sum >>> (32 - shift))) >>> 0)) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return out
}

// ── SSH wire format ──────────────────────────────────────────────────────

// An SSH key blob is a run of length-prefixed fields: uint32 length, then that
// many bytes. The first field is always the key type.
function readFields(blob: Uint8Array): Uint8Array[] {
  const fields: Uint8Array[] = []
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  let offset = 0
  while (offset + 4 <= blob.length) {
    const length = view.getUint32(offset, false)
    offset += 4
    if (length > blob.length - offset) throw new Error('field length runs past the end of the key blob')
    fields.push(blob.subarray(offset, offset + length))
    offset += length
  }
  return fields
}

// mpint values carry a leading 0x00 when the high bit would otherwise make
// them look negative; that padding byte is not part of the key size.
function mpintBits(field: Uint8Array): number {
  let i = 0
  while (i < field.length && field[i] === 0) i++
  if (i === field.length) return 0
  return (field.length - i - 1) * 8 + (32 - Math.clz32(field[i]))
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export interface SshKeyInfo {
  line: number
  type: string
  bits: number | null
  curve?: string
  comment: string
  // authorized_keys restrictions written before the key (from=, command=, …).
  options?: string
  // "SHA256:…" — the form `ssh-keygen -l` prints by default.
  fingerprintSha256: string
  // "MD5:aa:bb:…" — the legacy form, still shown by AWS and older tooling.
  fingerprintMd5: string
  // Real problems: a key that will be rejected, or a line that is corrupt.
  warnings: string[]
  // Worth knowing but not broken — a key that works and could be stronger.
  advisories: string[]
  error?: string
  raw: string
}

export interface SshKeyResult {
  keys: SshKeyInfo[]
  // Set when the input contains a private key — nothing is parsed in that case.
  privateKeyRefused: boolean
  error?: string
}

// Splits key-strength findings into things that will actually fail (warnings)
// and things that merely could be better (advisories), so a working 2048-bit
// key is not shown with the same alarm as a key OpenSSH refuses outright.
function analyzeStrength(type: string, bits: number | null): { warnings: string[]; advisories: string[] } {
  const warnings: string[] = []
  const advisories: string[] = []

  if (type === 'ssh-dss') {
    warnings.push('DSA — OpenSSH has disabled this key type by default since 7.0 and removed it in 9.8')
  }
  if (type === 'ssh-rsa' && bits !== null && bits < 2048) {
    warnings.push(`${bits}-bit RSA is below the 2048-bit minimum and is rejected by current OpenSSH`)
  } else if (type === 'ssh-rsa' && bits !== null && bits < 3072) {
    advisories.push(`${bits}-bit RSA works, but ed25519 or 4096-bit RSA is the current recommendation`)
  }
  if (type.endsWith('-cert-v01@openssh.com')) {
    advisories.push('signed certificate rather than a bare public key — its validity window and principals live in the certificate body')
  }

  return { warnings, advisories }
}

async function parseLine(raw: string, lineNumber: number): Promise<SshKeyInfo | null> {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  const tokens = trimmed.split(/\s+/)
  // authorized_keys lines may open with an options field (no-pty, from="…"),
  // so locate the key type rather than assuming it is the first token.
  const typeIndex = tokens.findIndex(t => KEY_TYPES.includes(t))

  const base: SshKeyInfo = {
    line: lineNumber,
    type: '',
    bits: null,
    comment: '',
    fingerprintSha256: '',
    fingerprintMd5: '',
    warnings: [],
    advisories: [],
    raw: trimmed,
  }

  if (typeIndex < 0) {
    return { ...base, error: 'no recognizable SSH key type on this line' }
  }

  const declaredType = tokens[typeIndex]
  const b64 = tokens[typeIndex + 1]
  if (!b64) return { ...base, type: declaredType, error: 'key type is present but the key data is missing' }

  let blob: Uint8Array
  try {
    blob = base64ToBytes(b64)
  } catch {
    return { ...base, type: declaredType, error: 'key data is not valid base64' }
  }

  let fields: Uint8Array[]
  try {
    fields = readFields(blob)
  } catch (e: unknown) {
    return { ...base, type: declaredType, error: e instanceof Error ? e.message : 'malformed key blob' }
  }

  if (fields.length === 0) return { ...base, type: declaredType, error: 'key blob is empty' }

  const embeddedType = new TextDecoder().decode(fields[0])
  const warnings: string[] = []
  if (embeddedType !== declaredType) {
    warnings.push(`the line says "${declaredType}" but the key data says "${embeddedType}" — this line has been corrupted or edited`)
  }

  let bits: number | null = null
  let curve: string | undefined
  if (embeddedType === 'ssh-rsa' && fields.length >= 3) {
    bits = mpintBits(fields[2])
  } else if (embeddedType === 'ssh-dss' && fields.length >= 2) {
    bits = mpintBits(fields[1])
  } else if (embeddedType.includes('ed25519')) {
    bits = 256
  } else if (embeddedType.includes('ecdsa') && fields.length >= 2) {
    curve = new TextDecoder().decode(fields[1])
    bits = CURVE_BITS[curve] ?? null
  }

  const strength = analyzeStrength(embeddedType, bits)

  const sha256 = await crypto.subtle.digest('SHA-256', blob as BufferSource)
  // ssh-keygen prints the base64 digest with padding stripped.
  const fingerprintSha256 = `SHA256:${bytesToBase64(new Uint8Array(sha256)).replace(/=+$/, '')}`
  const fingerprintMd5 = `MD5:${[...md5(blob)].map(b => b.toString(16).padStart(2, '0')).join(':')}`

  return {
    line: lineNumber,
    type: embeddedType,
    bits,
    curve,
    comment: tokens.slice(typeIndex + 2).join(' '),
    options: typeIndex > 0 ? tokens.slice(0, typeIndex).join(' ') : undefined,
    fingerprintSha256,
    fingerprintMd5,
    warnings: [...warnings, ...strength.warnings],
    advisories: strength.advisories,
    raw: trimmed,
  }
}

export async function inspectSshKeys(input: string): Promise<SshKeyResult> {
  if (!input.trim()) return { keys: [], privateKeyRefused: false }

  // Refuse rather than parse: a private key does not belong in a tool that
  // renders what it is given, and nothing here needs one.
  if (/-----BEGIN[A-Z ]*PRIVATE KEY-----/.test(input)) {
    return {
      keys: [],
      privateKeyRefused: true,
      error: 'That looks like a private key. Nothing here needs one — paste the matching .pub file instead.',
    }
  }

  const lines = input.split('\n')
  const parsed = await Promise.all(lines.map((line, i) => parseLine(line, i + 1)))
  const keys = parsed.filter((k): k is SshKeyInfo => k !== null)

  // Per-line errors are kept either way — auditing an authorized_keys file
  // means seeing which line is broken. But when nothing parsed at all, say so
  // at the top rather than leaving a table of failures as the only signal.
  const noneParsed = keys.length === 0 || keys.every(k => k.error)
  return {
    keys,
    privateKeyRefused: false,
    error: noneParsed ? 'No SSH public keys found. Paste a line like "ssh-ed25519 AAAAC3Nz… user@host".' : undefined,
  }
}
