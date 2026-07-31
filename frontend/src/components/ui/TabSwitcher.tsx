import type { LucideIcon } from 'lucide-react'

export interface TabSwitcherTab {
  id: string
  label: string
  icon?: LucideIcon
  count?: number
}

export interface TabSwitcherProps {
  tabs: TabSwitcherTab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function TabSwitcher({ tabs, active, onChange, className = '' }: TabSwitcherProps) {
  return (
    <div className={`tab-switcher ${className}`}>
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`tab-switcher-btn${active === t.id ? ' active' : ''}`}
        >
          {t.icon && <t.icon size={14} />}
          {t.label}
          {t.count !== undefined && <span className="tab-switcher-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
