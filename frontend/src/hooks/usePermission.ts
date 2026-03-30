import { useCallback } from 'react'
import { useAuthStore } from '../store/authStore'

export type PermissionAction =
  | 'manage-servers'
  | 'delete-server'
  | 'use-terminal'
  | 'use-kubectl'
  | 'use-ai'
  | 'manage-alerts'
  | 'manage-users'
  | 'view-alerts'
  | 'view-settings'

export function usePermission() {
  const { user } = useAuthStore()

  const can = useCallback((action: PermissionAction): boolean => {
    if (!user) return false
    const role = user.role

    switch (action) {
      case 'manage-servers':
        return ['admin', 'devops'].includes(role)
      case 'delete-server':
        return ['admin'].includes(role)
      case 'use-terminal':
        return ['admin', 'devops'].includes(role)
      case 'use-kubectl':
        return ['admin', 'devops'].includes(role)
      case 'use-ai':
        return ['admin', 'devops'].includes(role)
      case 'manage-alerts':
        return ['admin', 'devops'].includes(role)
      case 'view-alerts':
        return ['admin', 'devops', 'trainee'].includes(role)
      case 'manage-users':
        return ['admin'].includes(role)
      case 'view-settings':
        return true
      default:
        return false
    }
  }, [user])

  return { can }
}
