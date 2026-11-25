import { test, expect } from '@playwright/test'

test.describe('iac sync', () => {
  test('shows repository form, stats and history section', async ({ page }) => {
    await page.goto('/iac-sync')
    await expect(page.getByRole('heading', { name: 'Infrastructure-as-Code Sync', level: 1 })).toBeVisible()
    await expect(page.getByLabel('Repository URL')).toBeVisible()
    await expect(page.getByLabel('Branch', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Sync interval (minutes)')).toBeVisible()
    await expect(page.getByText('Sync history')).toBeVisible()
    // Sync/Test need a repository URL
    const url = page.getByLabel('Repository URL')
    if (!(await url.inputValue())) {
      await expect(page.getByRole('button', { name: 'Sync Now' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Test Connection' })).toBeDisabled()
    }
  })

  test('token visibility can be toggled', async ({ page }) => {
    await page.goto('/iac-sync')
    const token = page.getByLabel('Personal access token (private repos only)')
    await expect(token).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show token' }).click()
    await expect(token).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Hide token' }).click()
    await expect(token).toHaveAttribute('type', 'password')
  })
})
