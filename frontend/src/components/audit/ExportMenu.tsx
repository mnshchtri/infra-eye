import { useState } from 'react'
import { Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material'
import { Download, FileText, FileSpreadsheet, FileJson, FileCode } from 'lucide-react'
import { downloadCSV, downloadJSON, downloadMarkdown, downloadPDF, type ReportMeta, type ReportRow } from '../../utils/reportExport'
import { Button } from '../ui'

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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const items: { label: string; icon: typeof Download; run: () => void }[] = [
    { label: 'PDF report', icon: FileText, run: () => downloadPDF(meta, rows) },
    { label: 'CSV (spreadsheet)', icon: FileSpreadsheet, run: () => downloadCSV(meta, rows) },
    { label: 'Markdown', icon: FileCode, run: () => downloadMarkdown(meta, rows) },
    { label: 'JSON', icon: FileJson, run: () => downloadJSON(meta, raw) },
  ]

  return (
    <>
      <Button
        variant="secondary" size="sm" icon={<Download size={14} />}
        onClick={e => setAnchor(e.currentTarget)}
        aria-haspopup="menu" aria-expanded={!!anchor}
      >
        Export
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {items.map(item => (
          <MenuItem key={item.label} onClick={() => { item.run(); setAnchor(null) }}>
            <ListItemIcon><item.icon size={14} /></ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
