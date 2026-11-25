import type { HTMLAttributes, ReactNode } from 'react'
import MuiCard from '@mui/material/Card'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  children: ReactNode
}

export function Card({ interactive = false, children, ...props }: CardProps) {
  return (
    <MuiCard
      {...props}
      sx={interactive ? {
        cursor: 'pointer',
        transition: 'border-color 120ms',
        '&:hover': { borderColor: 'primary.main' },
      } : undefined}
    >
      {children}
    </MuiCard>
  )
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function CardHeader({ children, ...props }: CardHeaderProps) {
  return (
    <>
      <Box
        {...props}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2, py: 1.25 }}
      >
        {children}
      </Box>
      <Divider />
    </>
  )
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode
}

export function CardTitle({ children, ...props }: CardTitleProps) {
  return <Typography variant="subtitle1" component="h3" {...props}>{children}</Typography>
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function CardBody({ children, ...props }: CardBodyProps) {
  return <Box {...props} sx={{ p: 2 }}>{children}</Box>
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function CardFooter({ children, ...props }: CardFooterProps) {
  return (
    <>
      <Divider />
      <Box {...props} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 2, py: 1.25 }}>
        {children}
      </Box>
    </>
  )
}
