import { test, expect } from '@playwright/test'
import { uiLogin } from './helpers'

test('rejects a wrong password and stays on the login page', async ({ page }) => {
  await uiLogin(page, 'admin', 'definitely-wrong')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
})

test('signs in with the seeded admin and can sign out', async ({ page }) => {
  await uiLogin(page)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
})

test('unauthenticated visit to a private route redirects to login', async ({ page }) => {
  await page.goto('/servers')
  await expect(page).toHaveURL(/\/login/)
})
