import { test, expect } from '@playwright/test'
import { authHeaders, deleteByName } from './helpers'

const NAME = 'e2e-resource-a'

test.describe('resources', () => {
  test.beforeEach(async ({ request }) => { await deleteByName(request, 'resources', 'e2e-resource') })
  test.afterAll(async ({ request }) => { await deleteByName(request, 'resources', 'e2e-resource') })

  test('add, search, edit and delete a resource', async ({ page }) => {
    await page.goto('/resources')
    await page.getByRole('button', { name: 'Add Resource' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill(NAME)
    await dialog.getByLabel('Host', { exact: true }).fill('192.0.2.150')
    await dialog.getByRole('button', { name: 'Add resource' }).click()
    await expect(dialog).toBeHidden()

    const card = page.locator('.MuiCard-root').filter({ hasText: NAME })
    await expect(card).toBeVisible()
    await expect(card).toContainText('192.0.2.150:5432') // postgres default port

    await page.getByPlaceholder('Search resources...').fill('no-such-resource-xyz')
    await expect(page.getByText('No resources yet')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search', exact: true }).first().click()
    await expect(card).toBeVisible()

    // Changing the type auto-fills the default port
    await card.getByRole('button', { name: 'Edit' }).click()
    await dialog.getByLabel('Type', { exact: true }).click()
    await page.getByRole('option', { name: 'Redis' }).click()
    await expect(dialog.getByLabel('Port', { exact: true })).toHaveValue('6379')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toContainText('redis://')

    // Delete asks for confirmation in a dialog (no native confirm)
    await card.getByRole('button', { name: 'Delete' }).click()
    const confirm = page.getByRole('dialog', { name: /Delete resource/ })
    await expect(confirm).toContainText(NAME)
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Delete' }).click()
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.MuiCard-root').filter({ hasText: NAME })).toHaveCount(0)
  })

  test('detail page shows tabs and the access list', async ({ page, request }) => {
    const res = await request.post('/api/resources', {
      headers: await authHeaders(request),
      data: { name: NAME, resource_type: 'cache', protocol: 'redis', host: '192.0.2.151', port: 6379, auth_type: 'none', use_gateway: false },
    })
    expect(res.ok()).toBeTruthy()
    await page.goto('/resources')
    await page.locator('.MuiCard-root').filter({ hasText: NAME }).getByRole('button', { name: 'Open' }).click()
    await expect(page).toHaveURL(/\/resources\/\d+$/)
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible()

    await page.getByRole('tab', { name: 'Overview' }).click()
    await expect(page.getByText('Configuration')).toBeVisible()
    await expect(page.getByText('Timeline')).toBeVisible()

    await page.getByRole('tab', { name: 'Access' }).click()
    await expect(page.getByText('Access control')).toBeVisible()
    await expect(page.getByLabel('Access level')).toBeVisible()

    await page.getByRole('tab', { name: 'Audit Log' }).click()
    await expect(page.getByRole('table')).toBeVisible()

    await page.getByRole('button', { name: 'Back to resources' }).click()
    await expect(page).toHaveURL(/\/resources$/)
  })
})
