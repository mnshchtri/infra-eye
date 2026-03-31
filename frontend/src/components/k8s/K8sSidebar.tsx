import React, { memo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface ResNavLinkProps {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
  isSub?: boolean;
}

export const ResNavLink = memo(({ active, onClick, icon: Icon, label, isSub }: ResNavLinkProps) => {
  return (
    <div className={`res-nav-link ${active ? 'active' : ''} ${isSub ? 'sub' : ''}`} onClick={onClick}>
      <Icon size={isSub ? 13 : 15} strokeWidth={active ? 2.5 : 1.5} />
      <span>{label}</span>
    </div>
  )
})

ResNavLink.displayName = 'ResNavLink'

interface NavCategoryProps {
  label: string;
  icon: any;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}

export const NavCategory = memo(({ label, icon: Icon, children, isOpen, onToggle }: NavCategoryProps) => {
  return (
    <div className="nav-cat">
      <div className={`nav-cat-header ${isOpen ? 'open' : ''}`} onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 16, display: 'flex', justifyContent: 'center' }}>
            <Icon size={14} strokeWidth={1.5} color="var(--text-muted)" />
          </div>
          <span>{label}</span>
        </div>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </div>
      {isOpen && (
        <div className="nav-cat-body">
          {children}
        </div>
      )}
    </div>
  )
})

NavCategory.displayName = 'NavCategory'
