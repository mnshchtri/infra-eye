import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { IconComponent } from '../../types/k8s'

export interface SectionHeaderProps {
  icon?: IconComponent
  iconColor?: string
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
}

export function SectionHeader({ icon: Icon, iconColor, title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <Box className={className} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {Icon && <Icon size={16} color={iconColor} />}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h3">{title}</Typography>
          {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
        </Box>
      </Box>
      {action && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>{action}</Box>}
    </Box>
  )
}
