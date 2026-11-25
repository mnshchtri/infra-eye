import {
  LayoutDashboard, Server, Bot, Bell, Settings, Code2, Shield, Database,
  ShieldAlert, Lock, Network, KeyRound, GitBranch, Workflow, Map, FileCode2, Radar,
} from 'lucide-react'
import type { PermissionAction } from '../../hooks/usePermission'
import { KubernetesIcon } from '../OSIcons'
import type { IconComponent } from '../../types/k8s'

export type NavItem = {
  to: string
  icon: IconComponent
  label: string
  action?: PermissionAction
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/servers',    icon: Server,          label: 'Servers' },
    ]
  },
  {
    label: 'Infrastructure',
    items: [
      { to: '/infra-map',  icon: Map,             label: 'Infra Map' },
      { to: '/kubernetes', icon: KubernetesIcon,  label: 'Kubernetes',  action: 'use-kubectl' },
      { to: '/resources',  icon: Database,        label: 'Resources',   action: 'manage-resources' },
      { to: '/alerts',     icon: Bell,            label: 'Alert Rules', action: 'view-alerts' },
      { to: '/vpn',        icon: Shield,          label: 'VPN Tunnel' },
    ]
  },
  {
    label: 'Operations',
    items: [
      { to: '/ai',         icon: Bot,             label: 'AI Assistant', action: 'use-ai' },
      { to: '/agent',      icon: Workflow,        label: 'Agent',        action: 'use-agent' },
    ]
  },
  {
    label: 'Audit',
    items: [
      { to: '/audit/kernel',    icon: ShieldAlert, label: 'Kernel Scanner',    action: 'view-audit' },
      { to: '/audit/hardening', icon: Lock,        label: 'Server Hardening', action: 'view-audit' },
      { to: '/audit/cluster',   icon: Network,     label: 'Cluster Security', action: 'view-audit' },
      { to: '/audit/resources', icon: KeyRound,    label: 'Resource Security', action: 'view-audit' },
      { to: '/audit/code',      icon: FileCode2,   label: 'Code Security',    action: 'view-audit' },
      { to: '/audit/dast',      icon: Radar,       label: 'DAST Scanner',     action: 'view-audit' },
    ]
  },
  {
    label: 'Engineering',
    items: [
      { to: '/devtools',   icon: Code2,           label: 'Developer Hub', action: 'manage-users' },
      { to: '/iac-sync',   icon: GitBranch,       label: 'IaC Sync',      action: 'manage-gitsync' },
      { to: '/settings',   icon: Settings,        label: 'System Settings' },
    ]
  },
]

