import { test, expect } from '@playwright/test'

test.describe('infra map', () => {
  test('renders the toolbar and canvas without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/infra-map')
    await expect(page.getByRole('heading', { name: 'Infra map', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Networks' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Folders' })).toBeVisible()

    // Either the empty state or the SVG blueprint is shown, never a blank canvas
    const canvas = page.locator('svg:has(#inframap-viewport)')
    const empty = page.getByText('No infrastructure yet')
    await expect(canvas.or(empty).first()).toBeVisible()
    expect(errors).toEqual([])
  })

  test('group mode, search and zoom controls work', async ({ page }) => {
    await page.goto('/infra-map')
    await expect(page.getByRole('heading', { name: 'Infra map', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Folders' }).click()
    await expect(page.getByRole('button', { name: 'Folders' })).toHaveAttribute('aria-pressed', 'true')

    const search = page.getByLabel('Find a server')
    await search.fill('zzz-no-match')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(search).toHaveValue('')

    // Zoom controls only exist when there is infrastructure to draw
    const zoomIn = page.getByRole('button', { name: 'Zoom in' })
    if (await zoomIn.count()) {
      const label = page.locator('text=/^\\d+%$/')
      const before = await label.first().innerText()
      await zoomIn.click()
      await expect(label.first()).not.toHaveText(before)
      await page.getByRole('button', { name: 'Fit to view' }).click()
    }
  })
})
