import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h4" component="h1">{title}</Typography>
        {subtitle && (
          <Typography variant="body1" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>{actions}</Box>}
    </Box>
  )
}
