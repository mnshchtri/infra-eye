import { test, expect } from '@playwright/test'
import { authHeaders, deleteByName } from './helpers'

const NAME = 'e2e-detail-a'

test.describe('server detail', () => {
  test.beforeEach(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-detail') })
  test.afterAll(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-detail') })

  test('renders the header and every tab without page errors', async ({ page, request }) => {
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, host: '192.0.2.220', port: 22, ssh_user: 'root', auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa', os: 'linux' },
    })
    expect(res.ok()).toBeTruthy()
    const { id } = await res.json()

    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    await page.goto(`/servers/${id}`)
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible()
    await expect(page.getByText('root@192.0.2.220')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to servers' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect SSH' })).toBeVisible()

    for (const tab of ['Overview', 'Networking', 'Storage', 'Accounts', 'Logs', 'Terminal', 'Settings']) {
      const t = page.getByRole('tab', { name: tab })
      await expect(t).toBeVisible()
      await t.click()
      await expect(t).toHaveAttribute('aria-selected', 'true')
      await page.waitForTimeout(300)
    }
    expect(errors).toEqual([])
  })

  test('overview shows stat tiles and system information', async ({ page, request }) => {
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, host: '192.0.2.221', port: 22, ssh_user: 'root', auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa', os: 'linux' },
    })
    const { id } = await res.json()
    await page.goto(`/servers/${id}`)
    await expect(page.getByText('CPU load')).toBeVisible()
    await expect(page.getByText('System information')).toBeVisible()
    await expect(page.getByText('192.0.2.221:22')).toBeVisible()
  })

  test('settings tab saves preferences and gates delete behind a confirmation', async ({ page, request }) => {
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, host: '192.0.2.222', port: 22, ssh_user: 'root', auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa', os: 'linux' },
    })
    const { id } = await res.json()
    await page.goto(`/servers/${id}?tab=Settings`)

    await page.getByLabel('Description').fill('edited by e2e')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Preferences saved')).toBeVisible()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/cannot be undone/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete server' }).click()
    await expect(page).toHaveURL(/\/servers$/)
  })

  test('logs tab has search and refresh controls', async ({ page, request }) => {
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, host: '192.0.2.223', port: 22, ssh_user: 'root', auth_type: 'key', ssh_key_path: '~/.ssh/id_rsa', os: 'linux' },
    })
    const { id } = await res.json()
    await page.goto(`/servers/${id}?tab=Logs`)
    await expect(page.getByPlaceholder('Search logs…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh logs' })).toBeVisible()
    await page.getByRole('button', { name: 'Toggle fullscreen' }).click()
    await page.getByRole('button', { name: 'Toggle fullscreen' }).click()
  })
})
