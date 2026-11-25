import { test, expect } from '@playwright/test'

test.describe('app shell', () => {
  test('sidebar navigates and breadcrumbs follow the route', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('link', { name: 'Servers', exact: true }).click()
    await expect(page).toHaveURL(/\/servers$/)
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs).toContainText('Home')
    await expect(crumbs).toContainText('Servers')

    await nav.getByRole('link', { name: 'Kernel Scanner' }).click()
    await expect(page).toHaveURL(/\/audit\/kernel$/)
    await expect(crumbs).toContainText('Kernel Scanner')
  })

  test('sidebar collapses to an icon rail and expands again', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    // Labels are hidden in the rail
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByText('Dashboard', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByText('Dashboard', { exact: true })).toBeVisible()
  })

  test('theme toggle switches dark mode and persists across reload', async ({ page }) => {
    await page.goto('/')
    const html = page.locator('html')
    const wasDark = await html.evaluate(el => el.classList.contains('dark'))
    await page.getByRole('button', { name: 'Toggle colour theme' }).click()
    await expect(html).toHaveClass(wasDark ? /^(?!.*\bdark\b)/ : /\bdark\b/)
    await page.reload()
    const afterReload = await html.evaluate(el => el.classList.contains('dark'))
    expect(afterReload).toBe(!wasDark)
    // restore
    await page.getByRole('button', { name: 'Toggle colour theme' }).click()
  })

  test('mobile width uses a temporary drawer opened from the top bar', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Servers', exact: true }).click()
    await expect(page).toHaveURL(/\/servers$/)
  })
})
