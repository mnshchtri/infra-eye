// Strict parser for InfraEye's own <AlertRules> export format.
//
// This deliberately is not a general XML parser and does not use the browser's DOMParser:
// the input is text the user pasted/edited, and we only need a handful of attributes and one
// text node out of it. A small closed grammar (elements, quoted attributes, text, comments,
// the XML declaration) is easy to reason about, and it rejects DOCTYPE/ENTITY declarations
// outright, so there is no entity-expansion surface at all.

export interface ParsedRule {
  name: string
  server_id: number
  enabled: boolean
  condition_type: string
  condition_op: string
  condition_value: string
  action_type: string
  action_command: string
}

interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const NOT_WELL_FORMED = 'The XML is not well-formed — check for unescaped characters like < or & in rule values.'

const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g
const BARE_AMP = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/

function decode(s: string): string {
  if (BARE_AMP.test(s)) throw new Error(NOT_WELL_FORMED)
  return s.replace(ENTITY, (_m, named: string | undefined, dec: string | undefined, hex: string | undefined) => {
    if (named) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named]!
    const code = dec ? parseInt(dec, 10) : parseInt(hex!, 16)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new Error(NOT_WELL_FORMED)
    return String.fromCodePoint(code)
  })
}

// An element start/end/self-closing tag with only quoted attribute values.
const TAG = /^<(\/)?([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/)?>/
const ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g

function parseTree(input: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let i = 0
  while (i < input.length) {
    if (input[i] !== '<') {
      const next = input.indexOf('<', i)
      const chunk = input.slice(i, next === -1 ? input.length : next)
      stack[stack.length - 1].text += decode(chunk)
      i = next === -1 ? input.length : next
      continue
    }
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4)
      if (end === -1) throw new Error(NOT_WELL_FORMED)
      i = end + 3
      continue
    }
    if (input.startsWith('<?', i)) {
      const end = input.indexOf('?>', i + 2)
      if (end === -1) throw new Error(NOT_WELL_FORMED)
      i = end + 2
      continue
    }
    // <!DOCTYPE>, <!ENTITY>, <![CDATA[ … and anything else starting with "<!" are not supported.
    const m = TAG.exec(input.slice(i))
    if (!m) throw new Error(NOT_WELL_FORMED)
    const [whole, closing, tag, attrSrc, selfClose] = m
    if (closing) {
      const open = stack.pop()
      if (!open || open.tag !== tag || stack.length === 0) throw new Error(NOT_WELL_FORMED)
    } else {
      const attrs: Record<string, string> = {}
      for (const a of attrSrc.matchAll(ATTR)) {
        if (a[1] in attrs) throw new Error(NOT_WELL_FORMED) // duplicate attribute
        attrs[a[1]] = decode(a[2] ?? a[3] ?? '')
      }
      const node: XmlNode = { tag, attrs, children: [], text: '' }
      stack[stack.length - 1].children.push(node)
      if (!selfClose) stack.push(node)
    }
    i += whole.length
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new Error(NOT_WELL_FORMED)
  return root.children[0]
}

function find(node: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.tag === tag) out.push(c)
    find(c, tag, out)
  }
  return out
}

export function parseAlertRulesXml(input: string): ParsedRule[] {
  const root = parseTree(input.trim())
  return find(root, 'Rule').map(node => {
    const cond = find(node, 'Condition')[0]
    const action = find(node, 'Action')[0]
    return {
      name: node.attrs.name || 'Rule',
      server_id: parseInt(node.attrs.serverId || '0'),
      enabled: node.attrs.enabled !== 'false',
      condition_type: cond?.attrs.type || 'cpu',
      condition_op: cond?.attrs.op || 'gt',
      condition_value: cond?.attrs.value || '80',
      action_type: action?.attrs.type || 'ssh_command',
      action_command: action?.text || '',
    }
  })
}
