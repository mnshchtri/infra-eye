import React, { memo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'

interface ResNavLinkProps {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  isSub?: boolean;
}

export const ResNavLink = memo(({ active, onClick, icon: Icon, label, isSub }: ResNavLinkProps) => {
  return (
    <ButtonBase
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      sx={{
        width: '100%', justifyContent: 'flex-start', gap: 1.25, borderRadius: 1,
        px: 1.25, py: 0.75, pl: isSub ? 3 : 1.25, textAlign: 'left',
        color: active ? 'primary.main' : 'text.secondary',
        bgcolor: active ? 'action.selected' : 'transparent',
        fontWeight: active ? 600 : 400,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Icon size={isSub ? 13 : 15} />
      <Typography variant="body2" noWrap sx={{ color: 'inherit', fontWeight: 'inherit' }}>{label}</Typography>
    </ButtonBase>
  )
})

ResNavLink.displayName = 'ResNavLink'

interface NavCategoryProps {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}

export const NavCategory = memo(({ label, icon: Icon, children, isOpen, onToggle }: NavCategoryProps) => {
  return (
    <Box sx={{ mb: 0.5 }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={isOpen}
        sx={{ width: '100%', justifyContent: 'space-between', px: 1.25, py: 0.75, borderRadius: 1, color: 'text.primary', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Icon size={15} />
          <Typography variant="subtitle2" component="span">{label}</Typography>
        </Box>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </ButtonBase>
      {isOpen && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.25 }}>{children}</Box>}
    </Box>
  )
})

NavCategory.displayName = 'NavCategory'
