import { useEffect, useRef, useState } from 'react'
import { Download, FileText, FileSpreadsheet, FileJson, FileCode } from 'lucide-react'
import { downloadCSV, downloadJSON, downloadMarkdown, downloadPDF, type ReportMeta, type ReportRow } from '../../utils/reportExport'

interface ExportMenuProps {
  meta: ReportMeta
  rows: ReportRow[]
  raw: unknown // the full scan result, for the JSON export
}

/**
 * One export control, three audiences: a PDF for people who won't open a
 * JSON file (leadership, a client, an audit trail), a CSV for tracking in a
 * spreadsheet or PM board, and Markdown/JSON for engineers — a ready-to-paste
 * issue write-up, or raw data for tooling. Everything is generated
 * client-side from data already on the page, so there's no server round trip.
 */
export function ExportMenu({ meta, rows, raw }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const items: { label: string; icon: typeof Download; run: () => void }[] = [
    { label: 'PDF report', icon: FileText, run: () => downloadPDF(meta, rows) },
    { label: 'CSV (spreadsheet)', icon: FileSpreadsheet, run: () => downloadCSV(meta, rows) },
    { label: 'Markdown', icon: FileCode, run: () => downloadMarkdown(meta, rows) },
    { label: 'JSON', icon: FileJson, run: () => downloadJSON(meta, raw) },
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-secondary" onClick={() => setOpen(o => !o)} style={{ gap: 8, padding: '8px 14px' }}>
        <Download size={14} /><span>Export</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20, minWidth: 180,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {items.map(item => (
            <button key={item.label} onClick={() => { item.run(); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px',
                background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                color: 'var(--text-primary)', fontSize: 12.5, textAlign: 'left',
              }}>
              <item.icon size={14} color="var(--text-muted)" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
