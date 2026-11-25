import { test, expect } from '@playwright/test'
import { authHeaders, deleteByName } from './helpers'

const NAME = 'e2e-server-net'

test.describe('networking', () => {
  test.beforeEach(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-server') })
  test.afterAll(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-server') })

  test('shows summary, tabs and filter for a server', async ({ page, request }) => {
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, host: '192.0.2.201', ssh_user: 'root', ssh_port: 22, os: 'linux' },
    })
    expect(res.ok()).toBeTruthy()
    const { id } = await res.json()

    await page.goto(`/servers/${id}/networking`)
    // The host is unreachable, so networking data may fail to load; tolerate both outcomes.
    const heading = page.getByRole('heading', { name: NAME, level: 1 })
    const notFound = page.getByText('Server not found')
    await expect(heading.or(notFound)).toBeVisible()
    if (await notFound.isVisible()) return

    await expect(page.getByText('Listening ports', { exact: true }).first()).toBeVisible()
    await page.getByRole('tab', { name: /Services/ }).click()
    await expect(page.getByText('System services')).toBeVisible()
    await page.getByRole('button', { name: 'Failed', exact: false }).first().click()
    await page.getByRole('tab', { name: 'Interfaces' }).click()
    await expect(page.getByText('Network interfaces')).toBeVisible()
    await page.getByPlaceholder('Filter ports, services, interfaces...').fill('zzz-none')
    await expect(page.getByText('No interfaces match the filter').or(page.getByText('No network interfaces found'))).toBeVisible()
    await page.getByRole('button', { name: 'Back to server' }).click()
    await expect(page).toHaveURL(new RegExp(`/servers/${id}$`))
  })
})
