import { memo } from 'react'
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
    <div className="card stat-card">
      <div className="stat-icon-wrapper">
        <Icon size={16} color={color} />
      </div>
      <div className="stat-val-group">
        <div className="stat-label">{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="stat-value">
            {value}
            {unit && <span className="stat-value-unit">{unit}</span>}
          </div>
          {delta && (
            <span className="stat-delta" style={{ color }}>
              <DeltaIcon size={12} />
              {delta}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
