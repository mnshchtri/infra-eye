import { test, expect } from '@playwright/test'

test.describe('ai assistant', () => {
  test('shows the welcome message, suggestions and header controls', async ({ page }) => {
    await page.goto('/ai')
    // The page reopens the last conversation; start from a fresh one so the welcome state is shown.
    await page.getByRole('button', { name: /New conversation/ }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Netra')
    await expect(page.getByText('Where do you want to start?')).toBeVisible()
    await expect(page.getByText('online — your DevSecOps copilot')).toBeVisible()
    await expect(page.getByRole('button', { name: /Run a post-mortem/ })).toBeVisible()

    // Scope and model selects are real MUI selects
    await page.getByLabel('Model', { exact: true }).click()
    await expect(page.getByRole('option', { name: 'Claude' })).toBeVisible()
    await page.getByRole('option', { name: 'Claude' }).click()
    await page.getByLabel('Scope', { exact: true }).click()
    await expect(page.getByRole('option', { name: 'All infrastructure' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('send button follows the input and attach / sidebar controls exist', async ({ page }) => {
    await page.goto('/ai')
    // The page reopens the last conversation; start from a fresh one so the welcome state is shown.
    await page.getByRole('button', { name: /New conversation/ }).first().click()
    const input = page.getByRole('textbox', { name: 'Message Netra' })
    const send = page.getByRole('button', { name: 'Send message' })
    await expect(send).toBeDisabled()
    await input.fill('hello netra')
    await expect(send).toBeEnabled()
    await input.fill('')
    await expect(send).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Attach image' })).toBeVisible()

    // Collapse and expand the conversation sidebar
    await page.getByRole('button', { name: 'Collapse conversations' }).click()
    await expect(page.getByRole('button', { name: 'Expand conversations' })).toBeVisible()
    await page.getByRole('button', { name: 'Expand conversations' }).click()
    await expect(page.getByRole('button', { name: 'New conversation' })).toBeVisible()
  })

  test('clear history asks for confirmation in a dialog', async ({ page }) => {
    await page.goto('/ai')
    // The page reopens the last conversation; start from a fresh one so the welcome state is shown.
    await page.getByRole('button', { name: /New conversation/ }).first().click()
    await page.getByRole('button', { name: 'Clear history' }).click()
    const dialog = page.getByRole('dialog', { name: 'Clear history' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })
})
