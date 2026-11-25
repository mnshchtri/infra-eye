import { useMemo, type ReactNode } from 'react'
import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles'
import { useUIStore } from '../store/uiStore'
import { buildTheme } from './theme'

// injectFirst puts MUI's styles at the top of <head>, so the legacy index.css
// (still styling not-yet-migrated pages) wins on equal specificity instead of
// being clobbered. CssBaseline is intentionally NOT used until the migration
// is complete — it would reset element defaults the legacy CSS relies on.
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const darkMode = useUIStore(s => s.darkMode)
  const theme = useMemo(() => buildTheme(darkMode), [darkMode])
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </StyledEngineProvider>
  )
}
