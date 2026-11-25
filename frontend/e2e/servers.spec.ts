import { test, expect } from '@playwright/test'
import { deleteByName } from './helpers'

const NAME = 'e2e-server-a'
const RENAMED = 'e2e-server-b'

test.describe('servers', () => {
  test.beforeEach(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-server') })
  test.afterAll(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-server') })

  test('add, search, edit and delete a server', async ({ page }) => {
    await page.goto('/servers')
    await expect(page.getByRole('heading', { name: 'Servers', level: 1 })).toBeVisible()

    // Add
    await page.getByRole('button', { name: 'Add Server' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(NAME)
    await dialog.getByLabel('Host').fill('192.0.2.200')
    await dialog.getByLabel('Description').fill('created by e2e')
    await dialog.getByRole('button', { name: 'Add Server' }).click()
    await expect(dialog).toBeHidden()
    const grid = page.getByRole('grid')
    await expect(grid.getByText(NAME)).toBeVisible()
    await expect(grid.getByText('created by e2e')).toBeVisible()

    // Search narrows the grid
    await page.getByPlaceholder('Search...').fill(NAME)
    await expect(grid.getByText(NAME)).toBeVisible()
    await page.getByPlaceholder('Search...').fill('no-such-server-xyz')
    await expect(page.getByText('No matching servers found')).toBeVisible()
    await page.getByRole('button', { name: 'Clear Search', exact: true }).click()
    await expect(grid.getByText(NAME)).toBeVisible()

    // Edit
    const row = grid.getByRole('row').filter({ hasText: NAME })
    await row.getByRole('button', { name: 'Edit' }).click()
    await dialog.getByLabel('Name').fill(RENAMED)
    await dialog.getByRole('button', { name: 'Update Server' }).click()
    await expect(dialog).toBeHidden()
    await expect(grid.getByText(RENAMED)).toBeVisible()
    await expect(grid.getByText(NAME, { exact: true })).toHaveCount(0)

    // Delete needs confirmation
    const row2 = grid.getByRole('row').filter({ hasText: RENAMED })
    await row2.getByRole('button', { name: 'Delete' }).click()
    await row2.getByRole('button', { name: 'Cancel' }).click()
    await expect(grid.getByText(RENAMED)).toBeVisible()
    await row2.getByRole('button', { name: 'Delete' }).click()
    await row2.getByRole('button', { name: 'Confirm' }).click()
    await expect(grid.getByText(RENAMED)).toHaveCount(0)
  })

  test('add dialog switches between key and password auth', async ({ page }) => {
    await page.goto('/servers')
    await page.getByRole('button', { name: 'Add Server' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('SSH private key')).toBeVisible()
    await dialog.getByRole('button', { name: 'Password' }).click()
    await expect(dialog.getByLabel('SSH password')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })

  test('opens the server detail page from the grid', async ({ page, request }) => {
    const { authHeaders } = await import('./helpers')
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, host: '192.0.2.201', port: 22, ssh_user: 'root', auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa' },
    })
    expect(res.ok()).toBeTruthy()
    await page.goto('/servers')
    await page.getByRole('grid').getByRole('button', { name: NAME }).click()
    await expect(page).toHaveURL(/\/servers\/\d+$/)
  })
})
