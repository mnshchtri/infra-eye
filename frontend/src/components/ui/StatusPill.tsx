export interface StatusPillProps {
  status: string
  color: string
  variant?: 'solid' | 'outline'
}

export function StatusPill({ status, color, variant = 'solid' }: StatusPillProps) {
  const cssVars = {
    '--pill-color': color,
    '--pill-bg': `${color}18`,
    '--pill-border': `${color}30`,
  } as React.CSSProperties

  return (
    <span className={`status-pill status-pill-${variant}`} style={cssVars}>
      {status}
    </span>
  )
}
