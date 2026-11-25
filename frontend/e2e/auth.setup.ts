import { test as setup, expect } from '@playwright/test'
import { uiLogin } from './helpers'

setup('authenticate as admin', async ({ page }) => {
  await uiLogin(page)
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  await page.context().storageState({ path: 'e2e/.auth/admin.json' })
})
