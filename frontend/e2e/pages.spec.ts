import { test, expect } from '@playwright/test'

// Smoke test: every migrated page renders its heading without crashing, and
// reports no uncaught page errors.
const PAGES: { path: string; heading: RegExp }[] = [
  { path: '/', heading: /^Dashboard$/ },
  { path: '/servers', heading: /^Servers$/ },
  { path: '/alerts', heading: /^Alert Rules$/ },
  { path: '/resources', heading: /^Resources$/ },
  { path: '/audit/kernel', heading: /Kernel Vulnerability Scanner/ },
  { path: '/audit/hardening', heading: /^Server Hardening$/ },
  { path: '/audit/cluster', heading: /^Cluster Security$/ },
  { path: '/audit/resources', heading: /^Resource Security$/ },
  { path: '/audit/code', heading: /^Code Security$/ },
  { path: '/audit/dast', heading: /^DAST Scanner$/ },
]

for (const { path, heading } of PAGES) {
  test(`renders ${path}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('dashboard shows stat cards and the add-server shortcut', async ({ page }) => {
  await page.goto('/')
  for (const label of ['Total Servers', 'Status Online', 'Global Avg CPU']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Add Server' }).click()
  await expect(page).toHaveURL(/\/servers\?add=1/)
  await expect(page.getByRole('dialog')).toBeVisible()
})
