import { test, expect } from '@playwright/test'

// Desktop-only UI. Requires the bundle to be built/served with VITE_DESKTOP=true;
// skipped otherwise (the web build shows a plain version label instead).
const desktop = process.env.VITE_DESKTOP === 'true'

test.describe('desktop shell', () => {
  test.skip(!desktop, 'needs VITE_DESKTOP=true')

  test('sidebar offers update check and confirms update with an MUI dialog', async ({ page }) => {
    await page.route('**/api/desktop/update/check', r =>
      r.fulfill({ json: { available: true, latest_version: '9.9.9', download_url: 'http://example.invalid/x' } }))
    let applied = false
    await page.route('**/api/desktop/update/apply', r => { applied = true; return r.fulfill({ json: { success: true } }) })

    await page.goto('/')
    const btn = page.getByRole('button', { name: /Update to v9\.9\.9/ })
    await expect(btn).toBeVisible()
    await btn.click()
    const dialog = page.getByRole('dialog', { name: 'Update InfraEye' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(applied).toBe(false)

    await btn.click()
    await page.getByRole('dialog').getByRole('button', { name: /Update & Restart/ }).click()
    await expect.poll(() => applied).toBe(true)
  })

  test('up-to-date state shows Check for Updates', async ({ page }) => {
    await page.route('**/api/desktop/update/check', r => r.fulfill({ json: { available: false } }))
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Check for Updates' })).toBeVisible()
  })
})
