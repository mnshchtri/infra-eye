// Minimal X.509 DER/ASN.1 reader for PEM certificates — no dependency on a
// crypto/ASN.1 library. Covers the fields people actually look at when
// troubleshooting TLS (Subject, Issuer, validity, SANs, key algorithm,
// signature algorithm) for typical RSA/EC leaf and CA certs. It does not
// verify signatures or chains — this is a viewer, not a validator.

interface Asn1Node {
  tagClass: number
  constructed: boolean
  tagNumber: number
  contentStart: number
  contentEnd: number
}

function readTLV(buf: Uint8Array, offset: number): Asn1Node {
  const tagByte = buf[offset]
  const tagClass = (tagByte >> 6) & 0x3
  const constructed = !!(tagByte & 0x20)
  let tagNumber = tagByte & 0x1f
  let pos = offset + 1
  if (tagNumber === 0x1f) {
    tagNumber = 0
    while (true) {
      const b = buf[pos++]
      tagNumber = (tagNumber << 7) | (b & 0x7f)
      if (!(b & 0x80)) break
    }
  }
  const lenByte = buf[pos++]
  let length: number
  if (lenByte & 0x80) {
    const numBytes = lenByte & 0x7f
    if (numBytes === 0) throw new Error('Indefinite-length DER is not supported.')
    length = 0
    for (let i = 0; i < numBytes; i++) length = length * 256 + buf[pos++]
  } else {
    length = lenByte
  }
  const contentStart = pos
  const contentEnd = pos + length
  if (contentEnd > buf.length) throw new Error('Truncated certificate data.')
  return { tagClass, constructed, tagNumber, contentStart, contentEnd }
}

function children(buf: Uint8Array, node: Asn1Node): Asn1Node[] {
  const out: Asn1Node[] = []
  let pos = node.contentStart
  while (pos < node.contentEnd) {
    const child = readTLV(buf, pos)
    out.push(child)
    pos = child.contentEnd
  }
  return out
}

function readOid(buf: Uint8Array, node: Asn1Node): string {
  const bytes = buf.subarray(node.contentStart, node.contentEnd)
  const parts: number[] = []
  let value = 0
  for (let i = 0; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f)
    if (!(bytes[i] & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  const first = Math.min(2, Math.floor((parts[0] || 0) / 40))
  const rest = [first, (parts[0] || 0) - first * 40, ...parts.slice(1)]
  return rest.join('.')
}

function readInteger(buf: Uint8Array, node: Asn1Node): string {
  const bytes = buf.subarray(node.contentStart, node.contentEnd)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join(':')
}

function readBitLength(buf: Uint8Array, node: Asn1Node): number {
  // INTEGER content; strip a leading 0x00 padding byte if present, then count bits.
  let bytes = buf.subarray(node.contentStart, node.contentEnd)
  if (bytes.length > 1 && bytes[0] === 0x00) bytes = bytes.subarray(1)
  if (bytes.length === 0) return 0
  let bits = (bytes.length - 1) * 8
  let top = bytes[0]
  while (top > 0) { bits++; top >>= 1 }
  return bits
}

function readString(buf: Uint8Array, node: Asn1Node): string {
  const bytes = buf.subarray(node.contentStart, node.contentEnd)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function readTime(buf: Uint8Array, node: Asn1Node): Date | null {
  const s = readString(buf, node)
  // UTCTime: YYMMDDHHMMSSZ  |  GeneralizedTime: YYYYMMDDHHMMSSZ
  const m = s.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  const year = y.length === 2 ? (parseInt(y, 10) < 50 ? 2000 + parseInt(y, 10) : 1900 + parseInt(y, 10)) : parseInt(y, 10)
  return new Date(Date.UTC(year, parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), parseInt(se, 10)))
}

const NAME_OIDS: Record<string, string> = {
  '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST',
  '2.5.4.9': 'STREET', '2.5.4.10': 'O', '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'emailAddress',
}

const SIG_ALG_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'MD5 with RSA',
  '1.2.840.113549.1.1.5': 'SHA-1 with RSA',
  '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
  '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 with RSA',
  '1.2.840.10045.4.3.1': 'ECDSA with SHA-224',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.3.101.112': 'Ed25519',
}

const PUBKEY_ALG_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.10045.2.1': 'EC',
  '1.3.101.112': 'Ed25519',
}

const CURVE_OIDS: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
}

function readName(buf: Uint8Array, node: Asn1Node): string {
  const parts: string[] = []
  for (const rdn of children(buf, node)) {
    for (const atv of children(buf, rdn)) {
      const [oidNode, valueNode] = children(buf, atv)
      if (!oidNode || !valueNode) continue
      const oid = readOid(buf, oidNode)
      const label = NAME_OIDS[oid] || oid
      parts.push(`${label}=${readString(buf, valueNode)}`)
    }
  }
  return parts.join(', ')
}

export interface CertSan {
  type: 'DNS' | 'IP' | 'email' | 'URI'
  value: string
}

export interface CertResult {
  subject: string
  issuer: string
  serialNumber: string
  version: number
  notBefore: Date | null
  notAfter: Date | null
  isExpired: boolean
  daysRemaining: number | null
  signatureAlgorithm: string
  publicKeyAlgorithm: string
  publicKeyBits: number | null
  publicKeyCurve: string | null
  isCA: boolean
  sans: CertSan[]
  fingerprintSha256: string
  fingerprintSha1: string
  otherCertsInInput: number
}

async function digestHex(algo: 'SHA-256' | 'SHA-1', data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(algo, data as BufferSource)
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(':')
}

function pemToDer(pem: string): { der: Uint8Array; otherBlocks: number } {
  const blocks = [...pem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)]
  if (blocks.length === 0) throw new Error('No "-----BEGIN CERTIFICATE-----" block found in input.')
  const b64 = blocks[0][1].replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { der: bytes, otherBlocks: blocks.length - 1 }
}

export async function decodeCertificate(pem: string): Promise<CertResult> {
  const { der, otherBlocks } = pemToDer(pem)

  const cert = readTLV(der, 0)
  const [tbs, sigAlgNode] = children(der, cert)

  const tbsChildren = children(der, tbs)
  let idx = 0
  let version = 1
  if (tbsChildren[idx].tagClass === 2 && tbsChildren[idx].tagNumber === 0) {
    const versionInt = children(der, tbsChildren[idx])[0]
    version = parseInt(readInteger(der, versionInt).replace(/:/g, ''), 16) + 1
    idx++
  }
  const serialNode = tbsChildren[idx++]
  idx++ // signature AlgorithmIdentifier (inside TBS) — same as outer sigAlgNode, skip
  const issuerNode = tbsChildren[idx++]
  const validityNode = tbsChildren[idx++]
  const subjectNode = tbsChildren[idx++]
  const spkiNode = tbsChildren[idx++]

  let extensionsNode: Asn1Node | undefined
  for (; idx < tbsChildren.length; idx++) {
    const n = tbsChildren[idx]
    if (n.tagClass === 2 && n.tagNumber === 3) extensionsNode = n
  }

  const [notBeforeNode, notAfterNode] = children(der, validityNode)
  const notBefore = readTime(der, notBeforeNode)
  const notAfter = readTime(der, notAfterNode)

  const sigAlgOid = readOid(der, children(der, sigAlgNode)[0])
  const signatureAlgorithm = SIG_ALG_OIDS[sigAlgOid] || sigAlgOid

  const [spkiAlgNode, spkiKeyNode] = children(der, spkiNode)
  const spkiAlgChildren = children(der, spkiAlgNode)
  const pubKeyOid = readOid(der, spkiAlgChildren[0])
  const publicKeyAlgorithm = PUBKEY_ALG_OIDS[pubKeyOid] || pubKeyOid

  let publicKeyBits: number | null = null
  let publicKeyCurve: string | null = null
  if (pubKeyOid === '1.2.840.113549.1.1.1') {
    // RSA: BIT STRING wraps SEQUENCE { modulus INTEGER, exponent INTEGER } — skip the unused-bits byte.
    const keyBitString = der.subarray(spkiKeyNode.contentStart + 1, spkiKeyNode.contentEnd)
    const rsaSeq = readTLV(keyBitString, 0)
    const [modulusNode] = children(keyBitString, rsaSeq)
    publicKeyBits = readBitLength(keyBitString, modulusNode)
  } else if (pubKeyOid === '1.2.840.10045.2.1' && spkiAlgChildren[1]) {
    const curveOid = readOid(der, spkiAlgChildren[1])
    publicKeyCurve = CURVE_OIDS[curveOid] || curveOid
  } else if (pubKeyOid === '1.3.101.112') {
    publicKeyBits = 256
  }

  let isCA = false
  const sans: CertSan[] = []
  if (extensionsNode) {
    for (const extSeq of children(der, children(der, extensionsNode)[0])) {
      const extChildren = children(der, extSeq)
      const extOid = readOid(der, extChildren[0])
      const valueNode = extChildren[extChildren.length - 1] // last child is always extnValue OCTET STRING
      const valueBytes = der.subarray(valueNode.contentStart, valueNode.contentEnd)

      if (extOid === '2.5.29.19') {
        const bcSeq = readTLV(valueBytes, 0)
        const bcChildren = children(valueBytes, bcSeq)
        if (bcChildren[0] && bcChildren[0].tagNumber === 1 /* BOOLEAN */) {
          isCA = valueBytes[bcChildren[0].contentStart] !== 0x00
        }
      }

      if (extOid === '2.5.29.17') {
        const sanSeq = readTLV(valueBytes, 0)
        for (const gn of children(valueBytes, sanSeq)) {
          const raw = valueBytes.subarray(gn.contentStart, gn.contentEnd)
          if (gn.tagNumber === 2) sans.push({ type: 'DNS', value: new TextDecoder().decode(raw) })
          else if (gn.tagNumber === 1) sans.push({ type: 'email', value: new TextDecoder().decode(raw) })
          else if (gn.tagNumber === 6) sans.push({ type: 'URI', value: new TextDecoder().decode(raw) })
          else if (gn.tagNumber === 7) sans.push({ type: 'IP', value: raw.length === 4 ? [...raw].join('.') : [...raw].map(b => b.toString(16).padStart(2, '0')).join(':') })
        }
      }
    }
  }

  const [fingerprintSha256, fingerprintSha1] = await Promise.all([
    digestHex('SHA-256', der),
    digestHex('SHA-1', der),
  ])

  const now = Date.now()
  const daysRemaining = notAfter ? Math.round((notAfter.getTime() - now) / 86400000) : null

  return {
    subject: readName(der, subjectNode),
    issuer: readName(der, issuerNode),
    serialNumber: readInteger(der, serialNode),
    version,
    notBefore,
    notAfter,
    isExpired: notAfter ? notAfter.getTime() < now : false,
    daysRemaining,
    signatureAlgorithm,
    publicKeyAlgorithm,
    publicKeyBits,
    publicKeyCurve,
    isCA,
    sans,
    fingerprintSha256,
    fingerprintSha1,
    otherCertsInInput: otherBlocks,
  }
}
