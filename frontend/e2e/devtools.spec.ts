import { test, expect } from '@playwright/test'

// DevTools is entirely client-side: type input, read rendered output.
test.describe('developer tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/devtools')
    await expect(page.getByRole('heading', { level: 1, name: 'Developer Tools' })).toBeVisible()
  })

  test('JSON formatter formats, reports errors and clears', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Input' }).fill('{"a":1,"b":[1,2]}')
    await page.getByRole('button', { name: 'Format', exact: true }).click()
    const out = page.getByRole('textbox', { name: 'Output' })
    await expect(out).toHaveValue(/"a": 1/)

    await page.getByRole('button', { name: 'Minify', exact: true }).click()
    await expect(out).toHaveValue('{"a":1,"b":[1,2]}')

    await page.getByRole('textbox', { name: 'Input' }).fill('{ not json')
    await page.getByRole('button', { name: 'Format', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()

    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Input' })).toHaveValue('')
  })

  test('category and tool tabs switch the active tool', async ({ page }) => {
    await page.getByRole('tab', { name: 'Time', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Epoch Converter' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Cron Parser' })).toBeVisible()
    await page.getByRole('tab', { name: 'Cron Parser' }).click()
    await expect(page.getByRole('heading', { name: 'Cron Parser' })).toBeVisible()
  })

  test('epoch converter renders a known timestamp', async ({ page }) => {
    await page.getByRole('tab', { name: 'Time', exact: true }).click()
    await page.getByLabel('Timestamp', { exact: true }).fill('0')
    await expect(page.getByText('1970-01-01T00:00:00.000Z')).toBeVisible()
  })

  test('CIDR calculator shows network details and rejects bad input', async ({ page }) => {
    await page.getByRole('tab', { name: 'Networking' }).click()
    await page.getByRole('tab', { name: 'CIDR Calculator' }).click()
    await page.getByLabel('IPv4 CIDR block').fill('10.0.0.0/24')
    await expect(page.getByText('255.255.255.0')).toBeVisible()
    await expect(page.getByText('10.0.0.255').first()).toBeVisible()

    await page.getByLabel('IPv4 CIDR block').fill('not-a-cidr')
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('subnet splitter lists subnets', async ({ page }) => {
    await page.getByRole('tab', { name: 'Networking' }).click()
    await page.getByRole('tab', { name: 'Subnet Splitter' }).click()
    await page.getByLabel('Block to split').fill('10.0.0.0/16')
    await page.getByLabel('Target prefix').fill('18')
    await expect(page.getByRole('cell', { name: '10.0.64.0/18' })).toBeVisible()
  })

  test('base64 encodes and decodes', async ({ page }) => {
    await page.getByRole('tab', { name: 'Base64 Encoder' }).click()
    await page.getByRole('textbox', { name: 'Input' }).fill('infra-eye')
    await page.getByRole('button', { name: 'Encode', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Output' })).toHaveValue('aW5mcmEtZXll')
    await page.getByRole('textbox', { name: 'Input' }).fill('aW5mcmEtZXll')
    await page.getByRole('button', { name: 'Decode', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Output' })).toHaveValue('infra-eye')
  })

  test('JWT decoder shows header and payload', async ({ page }) => {
    await page.getByRole('tab', { name: 'Security' }).click()
    await page.getByRole('tab', { name: 'JWT Decoder' }).click()
    // {"alg":"HS256","typ":"JWT"} . {"sub":"e2e-user"}
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMmUtdXNlciJ9.sig'
    await page.getByRole('textbox', { name: 'Input' }).fill(token)
    await expect(page.getByText('"alg": "HS256"')).toBeVisible()
    await expect(page.getByText('"sub": "e2e-user"')).toBeVisible()
  })

  test('UUID generator and image parser', async ({ page }) => {
    await page.getByRole('tab', { name: 'Utilities' }).click()
    await expect(page.getByRole('heading', { name: 'UUID / Secret Generator' })).toBeVisible()
    await page.getByRole('tab', { name: 'Image Reference Parser' }).click()
    await page.getByLabel('Image reference').fill('ghcr.io/org/app:v1.2.3')
    await expect(page.getByText('ghcr.io').first()).toBeVisible()
    await expect(page.getByText('v1.2.3').first()).toBeVisible()
  })
})
