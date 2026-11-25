import { test, expect } from '@playwright/test'
import { deleteByName } from './helpers'

const NAME = 'e2e-rule-cpu'

test.describe('alert rules', () => {
  test.beforeEach(async ({ request }) => { await deleteByName(request, 'alert-rules', 'e2e-rule') })
  test.afterAll(async ({ request }) => { await deleteByName(request, 'alert-rules', 'e2e-rule') })

  test('create, pause/resume, edit and delete a rule', async ({ page }) => {
    await page.goto('/alerts')
    await expect(page.getByRole('heading', { name: 'Alert Rules', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'New Rule' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(NAME)
    await dialog.getByLabel('Threshold').fill('77')
    await dialog.getByRole('button', { name: 'Create rule' }).click()
    await expect(dialog).toBeHidden()

    const card = page.locator('.MuiCard-root').filter({ hasText: NAME })
    await expect(card).toBeVisible()
    await expect(card).toContainText('77')
    await expect(card).toContainText('Active')

    // Pause / resume via the switch
    await card.getByRole('switch').click()
    await expect(card).toContainText('Paused')
    await card.getByRole('switch').click()
    await expect(card).toContainText('Active')

    // Edit
    await card.getByRole('button', { name: 'Edit rule' }).click()
    await dialog.getByLabel('Threshold').fill('91')
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toContainText('91')

    // Delete with confirmation
    await card.getByRole('button', { name: 'Delete rule' }).click()
    await card.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator('.MuiCard-root').filter({ hasText: NAME })).toHaveCount(0)
  })

  test('shows SSH command warning only for the SSH action', async ({ page }) => {
    await page.goto('/alerts')
    await page.getByRole('button', { name: 'New Rule' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Command')).toHaveCount(0)
    await dialog.getByLabel('Action').click()
    await page.getByRole('option', { name: 'Run SSH command' }).click()
    await expect(dialog.getByLabel('Command')).toBeVisible()
    await expect(dialog.getByText(/Runs automatically over SSH/)).toBeVisible()
  })

  test('history and import/export tabs render', async ({ page }) => {
    await page.goto('/alerts')
    await page.getByRole('tab', { name: /History/ }).click()
    await expect(page.getByPlaceholder(/Search history/)).toBeVisible()
    await page.getByRole('tab', { name: /Import \/ Export/ }).click()
    await expect(page.getByText('Rules as XML')).toBeVisible()
  })
})
