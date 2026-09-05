import { useEffect, useRef } from 'react'

interface ScanConsoleProps {
  lines: string[]
}

/** Jenkins-style live console output for a scan in progress. */
export function ScanConsole({ lines }: ScanConsoleProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines.length])

  return (
    <div
      ref={ref}
      style={{
        background: '#0a0e14', color: '#9fe6a0', fontFamily: 'var(--font-mono)', fontSize: 12,
        lineHeight: 1.6, padding: '12px 16px', maxHeight: 260, overflowY: 'auto',
        borderTop: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}
    >
      {lines.length === 0 ? (
        <span style={{ color: '#6b7280' }}>Connecting to scan console...</span>
      ) : (
        lines.map((line, i) => <div key={i}>{line}</div>)
      )}
    </div>
  )
}
