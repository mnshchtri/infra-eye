import { test, expect } from '@playwright/test'
import { deleteUsersByPrefix } from './helpers'

const USER = 'e2e-user-a'

test.describe('settings', () => {
  test.beforeEach(async ({ request }) => { await deleteUsersByPrefix(request, 'e2e-user') })
  test.afterAll(async ({ request }) => { await deleteUsersByPrefix(request, 'e2e-user') })

  test('admin sees all four tabs and can switch between them', async ({ page }) => {
    await page.goto('/settings')
    for (const name of ['My account', 'AI credentials', 'Notifications', 'User management']) {
      await expect(page.getByRole('tab', { name })).toBeVisible()
    }
    await expect(page.getByText('Personal information')).toBeVisible()
    await page.getByRole('tab', { name: 'AI credentials' }).click()
    await expect(page.getByText('Personal AI infrastructure')).toBeVisible()
    await page.getByRole('tab', { name: 'Notifications' }).click()
    await expect(page.getByLabel('Google Chat webhook URL')).toBeVisible()
  })

  test('API key fields are masked until revealed', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'AI credentials' }).click()
    const key = page.getByLabel('OpenRouter API key', { exact: true })
    await key.fill('sk-or-test')
    await expect(key).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show OpenRouter API key' }).click()
    await expect(key).toHaveAttribute('type', 'text')
    // Nothing is saved: leave the page without pressing "Sync AI keys".
  })

  test('create, edit and delete a user', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'User management' }).click()
    await page.getByRole('button', { name: 'Add user' }).click()
    const dialog = page.getByRole('dialog', { name: 'Provision user' })
    await dialog.getByLabel('Username').fill(USER)
    await dialog.getByLabel('Email').fill('e2e@example.test')
    await dialog.getByLabel('Password').fill('e2e-password-1')
    await dialog.getByRole('button', { name: 'Confirm' }).click()
    await expect(dialog).toBeHidden()

    const row = page.getByRole('row').filter({ hasText: USER })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Intern')
    await expect(row).toContainText('Active')

    // Edit: promote to DevOps and deactivate
    await row.getByRole('button', { name: `Edit ${USER}` }).click()
    const edit = page.getByRole('dialog', { name: 'Update user' })
    await expect(edit.getByLabel('Username')).toBeDisabled()
    await edit.getByLabel('Role').click()
    await page.getByRole('option', { name: 'DevOps tier' }).click()
    await edit.getByLabel('Authorization active').uncheck()
    await edit.getByRole('button', { name: 'Confirm' }).click()
    await expect(edit).toBeHidden()
    await expect(row).toContainText('Devops')
    await expect(row).toContainText('Inactive')

    // Delete asks first
    await row.getByRole('button', { name: `Delete ${USER}` }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete user' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Delete ${USER}` }).click()
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('row').filter({ hasText: USER })).toHaveCount(0)
  })

  test("the signed-in admin's own row has no delete button", async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'User management' }).click()
    const row = page.getByRole('row').filter({ hasText: 'admin' }).first()
    await expect(row.getByRole('button', { name: 'Edit admin' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Delete admin' })).toHaveCount(0)
  })
})
