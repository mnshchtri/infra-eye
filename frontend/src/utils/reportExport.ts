import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { CodeFinding, DastFinding } from '../types/audit'

/**
 * One finding, normalized to a shape both Code Security and DAST results can
 * produce — so every export format (PDF/CSV/Markdown/JSON) is written once
 * and works for both scan types, rather than duplicated per finding shape.
 */
export interface ReportRow {
  severity: string
  source: string   // scanning tool, e.g. "trivy" or "OWASP ZAP"
  category: string // secret/sast/dependency/iac, or a DAST alert's confidence
  rule: string
  title: string
  location: string // file:line, or a URL for DAST
  detail: string
}

export interface ReportMeta {
  title: string       // e.g. "Code Security Report"
  subject: string     // repo URL or target URL
  extra?: string       // e.g. "branch: main" or "mode: baseline"
  scannedAt: string
  toolsRun?: string[]
  toolErrors?: Record<string, string>
  counts: { critical: number; high: number; medium: number; low: number }
}

export function codeFindingsToRows(findings: CodeFinding[] | null | undefined): ReportRow[] {
  return (findings ?? []).map(f => ({
    severity: f.severity, source: f.tool, category: f.category, rule: f.rule_id,
    title: f.title,
    location: [f.file, f.line ? `:${f.line}` : '', f.package ? ` (${f.package})` : ''].join(''),
    detail: [f.description, f.fixed_in ? `Fixed in ${f.fixed_in}` : ''].filter(Boolean).join(' — '),
  }))
}

export function dastFindingsToRows(findings: DastFinding[] | null | undefined): ReportRow[] {
  return (findings ?? []).map(f => ({
    severity: f.risk, source: 'OWASP ZAP', category: f.confidence, rule: f.plugin_id,
    title: f.name, location: f.url || '',
    detail: [f.description, f.solution ? `Fix: ${f.solution}` : ''].filter(Boolean).join(' — '),
  }))
}

function severityRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s] ?? 0
}

function sortedRows(rows: ReportRow[]): ReportRow[] {
  return [...rows].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}

function fileBase(meta: ReportMeta): string {
  const safe = meta.subject.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  const date = new Date(meta.scannedAt).toISOString().slice(0, 10)
  return `${safe || 'report'}-${date}`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/** Row-per-finding spreadsheet — the format a PM/tracking board actually wants to import. */
export function downloadCSV(meta: ReportMeta, rows: ReportRow[]) {
  const header = ['Severity', 'Source', 'Category', 'Rule', 'Title', 'Location', 'Detail']
  const lines = [header, ...sortedRows(rows).map(r => [r.severity, r.source, r.category, r.rule, r.title, r.location, r.detail])]
    .map(cols => cols.map(csvCell).join(','))
  triggerDownload(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `${fileBase(meta)}.csv`)
}

/** Raw structured data for tooling — CI gates, ticket-filing scripts, anything programmatic. */
export function downloadJSON(meta: ReportMeta, raw: unknown) {
  triggerDownload(new Blob([JSON.stringify({ ...meta, findings: raw }, null, 2)], { type: 'application/json' }), `${fileBase(meta)}.json`)
}

/** Drop-in write-up for a GitHub/GitLab issue or PR comment. */
export function downloadMarkdown(meta: ReportMeta, rows: ReportRow[]) {
  const lines: string[] = []
  lines.push(`# ${meta.title}`)
  lines.push('')
  lines.push(`**Target:** ${meta.subject}`)
  if (meta.extra) lines.push(`**${meta.extra}**`)
  lines.push(`**Scanned:** ${new Date(meta.scannedAt).toLocaleString()}`)
  if (meta.toolsRun?.length) lines.push(`**Tools run:** ${meta.toolsRun.join(', ')}`)
  lines.push('')
  lines.push(`| Severity | Critical | High | Medium | Low |`)
  lines.push(`|---|---|---|---|---|`)
  lines.push(`| Count | ${meta.counts.critical} | ${meta.counts.high} | ${meta.counts.medium} | ${meta.counts.low} |`)
  lines.push('')
  if (meta.toolErrors && Object.keys(meta.toolErrors).length > 0) {
    lines.push('## Notes')
    for (const [tool, msg] of Object.entries(meta.toolErrors)) lines.push(`- **${tool}:** ${msg}`)
    lines.push('')
  }
  if (rows.length === 0) {
    lines.push('No findings.')
  } else {
    lines.push('## Findings')
    lines.push('')
    lines.push('| Severity | Source | Rule | Title | Location |')
    lines.push('|---|---|---|---|---|')
    for (const r of sortedRows(rows)) {
      lines.push(`| ${r.severity.toUpperCase()} | ${r.source} | ${r.rule} | ${r.title.replace(/\|/g, '\\|')} | ${r.location.replace(/\|/g, '\\|')} |`)
    }
    lines.push('')
    lines.push('## Details')
    lines.push('')
    for (const r of sortedRows(rows)) {
      lines.push(`### ${r.title} (${r.severity.toUpperCase()})`)
      lines.push(`- **Source:** ${r.source} · **Rule:** ${r.rule} · **Location:** ${r.location || 'n/a'}`)
      if (r.detail) lines.push(`- ${r.detail}`)
      lines.push('')
    }
  }
  triggerDownload(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), `${fileBase(meta)}.md`)
}

const severityPdfColor: Record<string, [number, number, number]> = {
  critical: [185, 28, 28], high: [220, 38, 38], medium: [217, 119, 6], low: [100, 116, 139], info: [100, 116, 139],
}

/** Formatted, presentable report for people who won't open a JSON file — leadership, clients, audit trail. */
export function downloadPDF(meta: ReportMeta, rows: ReportRow[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(meta.title, margin, 50)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(90)
  let y = 72
  doc.text(`Target: ${meta.subject}`, margin, y)
  y += 15
  if (meta.extra) { doc.text(meta.extra, margin, y); y += 15 }
  doc.text(`Scanned: ${new Date(meta.scannedAt).toLocaleString()}`, margin, y)
  y += 15
  if (meta.toolsRun?.length) { doc.text(`Tools run: ${meta.toolsRun.join(', ')}`, margin, y); y += 15 }

  // Summary badges
  y += 10
  const badges: [string, number, [number, number, number]][] = [
    ['CRITICAL', meta.counts.critical, severityPdfColor.critical],
    ['HIGH', meta.counts.high, severityPdfColor.high],
    ['MEDIUM', meta.counts.medium, severityPdfColor.medium],
    ['LOW', meta.counts.low, severityPdfColor.low],
  ]
  let x = margin
  const badgeW = (pageWidth - margin * 2) / 4 - 8
  for (const [label, count, color] of badges) {
    doc.setDrawColor(...color)
    doc.setLineWidth(1.2)
    doc.roundedRect(x, y, badgeW, 44, 4, 4)
    doc.setFontSize(16)
    doc.setTextColor(...color)
    doc.setFont('helvetica', 'bold')
    doc.text(String(count), x + 10, y + 24)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.setFont('helvetica', 'normal')
    doc.text(label, x + 10, y + 37)
    x += badgeW + 8
  }
  y += 44 + 20

  if (meta.toolErrors && Object.keys(meta.toolErrors).length > 0) {
    doc.setFontSize(9)
    doc.setTextColor(180, 120, 20)
    for (const [tool, msg] of Object.entries(meta.toolErrors)) {
      const wrapped = doc.splitTextToSize(`${tool}: ${msg}`, pageWidth - margin * 2)
      doc.text(wrapped, margin, y)
      y += wrapped.length * 11
    }
    y += 8
  }

  const body = sortedRows(rows).map(r => [r.severity.toUpperCase(), r.source, r.rule, r.title, r.location, r.detail])
  autoTable(doc, {
    startY: y,
    head: [['Severity', 'Source', 'Rule', 'Title', 'Location', 'Detail']],
    body: body.length > 0 ? body : [['—', '—', '—', 'No findings', '—', '—']],
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 0: { cellWidth: 50 }, 3: { cellWidth: 100 }, 4: { cellWidth: 90 }, 5: { cellWidth: 140 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const sev = String(data.cell.raw).toLowerCase()
        const color = severityPdfColor[sev]
        if (color) { data.cell.styles.textColor = color; data.cell.styles.fontStyle = 'bold' }
      }
    },
  })

  const pageCount = doc.internal.pages.length - 1
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(`InfraEye · generated ${new Date().toLocaleString()} · page ${i} of ${pageCount}`, margin, doc.internal.pageSize.getHeight() - 20)
  }

  doc.save(`${fileBase(meta)}.pdf`)
}
