/** MUI palette path for a finding severity, for use in `sx={{ color }}`. */
export function severityColor(sev: string): string {
  return sev === 'high' ? 'error.main' : sev === 'medium' ? 'warning.main' : 'text.secondary'
}
