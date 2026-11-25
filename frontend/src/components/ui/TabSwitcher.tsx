import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Chip from '@mui/material/Chip'
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

export function TabSwitcher({ tabs, active, onChange, className }: TabSwitcherProps) {
  return (
    <Tabs
      className={className}
      value={tabs.some(t => t.id === active) ? active : false}
      onChange={(_, id: string) => onChange(id)}
      variant="scrollable"
      scrollButtons="auto"
      sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}
    >
      {tabs.map(t => (
        <Tab
          key={t.id}
          value={t.id}
          icon={t.icon ? <t.icon size={14} /> : undefined}
          iconPosition="start"
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {t.label}
              {t.count !== undefined && <Chip label={t.count} size="small" sx={{ height: 16, fontSize: '0.625rem' }} />}
            </span>
          }
        />
      ))}
    </Tabs>
  )
}
