import { decodeCertificateChain, type CertResult } from './certDecoder'
import { errMessage } from './errors'

// Checks a PEM bundle the way a TLS server loads it: in file order, leaf
// first, each certificate signed by the next one down. Almost every "works in
// my browser but the app can't connect" TLS bug is one of the problems below —
// a missing intermediate, or a bundle assembled in the wrong order.
//
// This reads the chain's structure (issuer/subject linkage, validity, CA
// flags). It does NOT verify signatures, so it cannot prove a chain is
// authentic — only that it is assembled correctly.

// Certificates expiring inside this window are called out while there is still
// time to rotate them.
const EXPIRY_WARNING_DAYS = 30

export type CertRole = 'leaf' | 'intermediate' | 'root'

export interface ChainLink {
  index: number
  cert: CertResult
  role: CertRole
  selfSigned: boolean
  // Whether the next certificate in the file is the one that issued this one.
  // null for the last certificate, which has nothing after it to check.
  issuedByNext: boolean | null
  // Problems with this certificate on its own (validity, weak key).
  issues: string[]
}

export interface ChainResult {
  links: ChainLink[]
  // Problems with the bundle as a whole (order, gaps, duplicates).
  problems: string[]
  // Notes that are worth stating but are not errors.
  notes: string[]
  ordered: boolean
  error?: string
}

function roleOf(cert: CertResult, selfSigned: boolean): CertRole {
  if (selfSigned && cert.isCA) return 'root'
  return cert.isCA ? 'intermediate' : 'leaf'
}

export async function analyzeCertChain(pem: string): Promise<ChainResult> {
  if (!pem.trim()) return { links: [], problems: [], notes: [], ordered: true }

  let certs: CertResult[]
  try {
    certs = await decodeCertificateChain(pem)
  } catch (e: unknown) {
    return { links: [], problems: [], notes: [], ordered: true, error: errMessage(e) || 'Could not parse the certificate bundle' }
  }

  const links: ChainLink[] = certs.map((cert, index) => {
    const selfSigned = cert.subject === cert.issuer
    const issues: string[] = []

    if (cert.isExpired) {
      issues.push(`expired${cert.notAfter ? ` on ${cert.notAfter.toISOString().slice(0, 10)}` : ''}`)
    } else if (cert.daysRemaining !== null && cert.daysRemaining <= EXPIRY_WARNING_DAYS) {
      issues.push(`expires in ${cert.daysRemaining} day${cert.daysRemaining === 1 ? '' : 's'}`)
    }
    if (cert.notBefore && cert.notBefore.getTime() > Date.now()) {
      issues.push(`not valid until ${cert.notBefore.toISOString().slice(0, 10)}`)
    }
    // 1024-bit RSA is below every current CA/Browser Forum baseline and is
    // rejected outright by modern clients.
    if (cert.publicKeyAlgorithm.startsWith('RSA') && cert.publicKeyBits !== null && cert.publicKeyBits < 2048) {
      issues.push(`${cert.publicKeyBits}-bit RSA key is below the 2048-bit minimum`)
    }

    return {
      index,
      cert,
      role: roleOf(cert, selfSigned),
      selfSigned,
      issuedByNext: null,
      issues,
    }
  })

  // Link each certificate to the next: the next one should be its issuer.
  for (let i = 0; i < links.length - 1; i++) {
    links[i].issuedByNext = links[i].cert.issuer === links[i + 1].cert.subject
  }

  const problems: string[] = []
  const notes: string[] = []

  if (links[0].cert.isCA) {
    problems.push('The bundle starts with a CA certificate — servers expect the leaf (your server certificate) first, then intermediates.')
  }

  // A broken link means either the wrong order or a missing intermediate. The
  // two are worth distinguishing, because the fixes are different.
  for (let i = 0; i < links.length - 1; i++) {
    if (links[i].issuedByNext) continue

    // Check the inverted link first. If the *next* certificate is the one this
    // certificate signed, the bundle is simply upside down — saying "missing
    // intermediate" here would be true but would send you looking for a file
    // you already have.
    if (links[i + 1].cert.issuer === links[i].cert.subject) {
      problems.push(`Reverse order: certificate #${i + 2} is issued by #${i + 1}, so this bundle runs CA-first. Reverse it — the leaf must come first.`)
      continue
    }

    const issuer = links[i].cert.issuer
    const issuerElsewhere = links.findIndex(l => l.cert.subject === issuer)
    if (issuerElsewhere >= 0) {
      problems.push(`Out of order: certificate #${i + 1} is issued by #${issuerElsewhere + 1}, but #${i + 2} comes next in the file.`)
    } else {
      problems.push(`Missing intermediate after certificate #${i + 1}: nothing in this bundle has the subject "${issuer}" that signed it.`)
    }
  }

  // A self-signed certificate anywhere but the end terminates the chain early.
  for (let i = 0; i < links.length - 1; i++) {
    if (links[i].selfSigned) {
      problems.push(`Certificate #${i + 1} is self-signed but is not last — everything after it is unreachable from the leaf.`)
    }
  }

  const seen = new Map<string, number>()
  for (const link of links) {
    const previous = seen.get(link.cert.fingerprintSha256)
    if (previous !== undefined) {
      problems.push(`Certificate #${link.index + 1} is a duplicate of #${previous + 1}.`)
    } else {
      seen.set(link.cert.fingerprintSha256, link.index)
    }
  }

  const last = links[links.length - 1]
  if (last.role === 'root') {
    notes.push('The root CA is included. That is harmless, but clients already trust it — omitting it saves bytes on every handshake.')
  }
  if (links.length === 1 && !links[0].cert.isCA) {
    notes.push('Only the leaf certificate is present. If your CA issues from an intermediate, append it or clients that do not fetch it will fail to verify.')
  }
  if (links.length === 1 && links[0].selfSigned) {
    notes.push('This is a self-signed certificate — clients will reject it unless they are configured to trust it explicitly.')
  }

  return {
    links,
    problems,
    notes,
    ordered: problems.length === 0,
  }
}
