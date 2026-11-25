import { test, expect } from '@playwright/test'
import { authHeaders, deleteByName } from './helpers'

const NAME = 'e2e-agent-server'

test.describe('agent', () => {
  test.beforeEach(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-agent') })
  test.afterAll(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-agent') })

  test('launcher lets you pick a server, provider and goal before launching', async ({ page, request }) => {
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, host: '192.0.2.210', port: 22, ssh_user: 'root', auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa' },
    })
    expect(res.ok()).toBeTruthy()

    await page.goto('/agent')
    await expect(page.getByRole('heading', { level: 1, name: 'New agent run' })).toBeVisible()
    const launch = page.getByRole('button', { name: 'Launch agent' })
    await expect(launch).toBeDisabled()

    await page.getByRole('combobox', { name: 'Target server' }).click()
    await page.getByRole('option', { name: NAME }).click()
    await page.getByRole('combobox', { name: 'Model provider' }).click()
    await page.getByRole('option', { name: /Local LLM/ }).click()
    await expect(launch).toBeDisabled() // goal still empty

    await page.getByRole('textbox', { name: 'Goal' }).fill('check disk usage')
    await expect(launch).toBeEnabled()
    // Not launched: that would call a real LLM provider.
  })

  test('canvas zoom controls and sidebar render', async ({ page }) => {
    await page.goto('/agent')
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fit to view' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New agent run' })).toBeVisible()
    await page.getByRole('button', { name: 'Collapse runs' }).click()
    await expect(page.getByRole('button', { name: 'Expand runs' })).toBeVisible()
  })
})
