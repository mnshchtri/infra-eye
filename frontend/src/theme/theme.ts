import { createTheme, type Theme } from '@mui/material/styles'

// Enterprise, data-first theme: dense controls, flat surfaces, muted blue/gray
// palette. Colours deliberately mirror the legacy CSS tokens in index.css so
// pages not yet migrated to MUI keep matching the migrated ones.
const FONT_SANS = "'Inter Variable', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif"
export const FONT_MONO = "'JetBrains Mono Variable', 'JetBrains Mono', Consolas, Monaco, monospace"

export const SIDEBAR_WIDTH = 248
export const SIDEBAR_WIDTH_COLLAPSED = 64
export const APPBAR_HEIGHT = 48

export function buildTheme(dark: boolean): Theme {
  return createTheme({
    cssVariables: false,
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: dark ? '#2b9af3' : '#0066cc' },
      success: { main: dark ? '#5ba352' : '#3e8635' },
      warning: { main: dark ? '#f4c145' : '#f0ab00' },
      error: { main: dark ? '#e62325' : '#c9190b' },
      info: { main: dark ? '#73bcf7' : '#2b9af3' },
      background: dark
        ? { default: '#151515', paper: '#212427' }
        : { default: '#f0f0f0', paper: '#ffffff' },
      divider: dark ? 'rgba(255,255,255,0.1)' : '#d2d2d2',
    },
    shape: { borderRadius: 4 },
    spacing: 8,
    typography: {
      fontFamily: FONT_SANS,
      fontSize: 13,
      h1: { fontSize: '1.75rem', fontWeight: 600 },
      h2: { fontSize: '1.5rem', fontWeight: 600 },
      h3: { fontSize: '1.25rem', fontWeight: 600 },
      h4: { fontSize: '1.125rem', fontWeight: 600 },
      h5: { fontSize: '1rem', fontWeight: 600 },
      h6: { fontSize: '0.9375rem', fontWeight: 600 },
      subtitle1: { fontSize: '0.9375rem', fontWeight: 500 },
      subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
      body1: { fontSize: '0.8125rem' },
      body2: { fontSize: '0.75rem' },
      button: { textTransform: 'none', fontWeight: 600 },
      caption: { fontSize: '0.6875rem' },
    },
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: {
        defaultProps: { size: 'small', disableElevation: true },
        styleOverrides: { root: { borderRadius: 3 } },
      },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiFormControl: { defaultProps: { size: 'small' } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiCheckbox: { defaultProps: { size: 'small' } },
      MuiSwitch: { defaultProps: { size: 'small' } },
      MuiTable: { defaultProps: { size: 'small' } },
      MuiChip: { defaultProps: { size: 'small' }, styleOverrides: { root: { borderRadius: 3, fontWeight: 600 } } },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 4 } } },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 600, textTransform: 'uppercase', fontSize: '0.6875rem', letterSpacing: '0.04em' },
        },
      },
    },
  })
}
