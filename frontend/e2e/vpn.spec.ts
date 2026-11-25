import { test, expect } from '@playwright/test'

test.describe('vpn', () => {
  test('switches provider and updates the provisioning command', async ({ page }) => {
    await page.goto('/vpn')
    await expect(page.getByRole('heading', { name: 'VPN & Networking', level: 1 })).toBeVisible()
    await expect(page.getByLabel('Auth key')).toBeVisible()
    await expect(page.getByText('tailscale up')).toBeVisible()

    await page.getByRole('button', { name: 'ZeroTier' }).click()
    await expect(page.getByLabel('Network ID')).toBeVisible()
    await expect(page.getByText('zerotier-cli join')).toBeVisible()

    await page.getByRole('button', { name: 'OpenVPN' }).click()
    await expect(page.getByLabel('OpenVPN configuration')).toBeVisible()
    await expect(page.getByText('Upload .ovpn file')).toBeVisible()
  })

  test('saving without a key shows a validation toast', async ({ page }) => {
    await page.goto('/vpn')
    await page.getByRole('button', { name: 'Save Configuration' }).click()
    await expect(page.getByText('Auth Key required')).toBeVisible()
    await page.getByLabel('Auth key').fill('tskey-auth-e2e')
    await page.getByRole('button', { name: 'Save Configuration' }).click()
    await expect(page.getByText('VPN Configured')).toBeVisible()
  })
})
