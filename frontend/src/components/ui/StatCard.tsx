import { memo } from 'react'
import Card from '@mui/material/Card'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color?: string
  unit?: string
  delta?: string
  deltaDirection?: 'up' | 'down'
}

export const StatCard = memo(function StatCard({
  label, value, icon: Icon, color = 'var(--brand-primary)', unit, delta, deltaDirection = 'up',
}: StatCardProps) {
  const DeltaIcon = deltaDirection === 'down' ? TrendingDown : TrendingUp
  return (
    <Card sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5 }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 1, bgcolor: 'action.hover', flexShrink: 0 }}>
        <Icon size={16} color={color} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="h4" component="div" sx={{ lineHeight: 1.2 }}>
            {value}
            {unit && <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>{unit}</Typography>}
          </Typography>
          {delta && (
            <Typography component="span" variant="caption" sx={{ color, display: 'inline-flex', alignItems: 'center', gap: 0.25, fontWeight: 600 }}>
              <DeltaIcon size={12} />{delta}
            </Typography>
          )}
        </Box>
      </Box>
    </Card>
  )
})
