import type { ReactNode } from 'react'
import type { IconComponent } from '../../types/k8s'

export interface SectionHeaderProps {
  icon?: IconComponent
  iconColor?: string
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
}

export function SectionHeader({ icon: Icon, iconColor, title, subtitle, action, className = '' }: SectionHeaderProps) {
  return (
    <div className={`section-header ${className}`}>
      <div className="section-header-heading">
        {Icon && <Icon size={16} className="section-header-icon" color={iconColor} />}
        <div className="section-header-text">
          <h3 className="section-header-title">{title}</h3>
          {subtitle && <p className="section-header-subtitle">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="section-header-action">{action}</div>}
    </div>
  )
}
