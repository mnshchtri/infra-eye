import { test, expect } from '@playwright/test'
import { authHeaders, deleteByName } from './helpers'

const NAME = 'e2e-k8s-a'
const KUBECONFIG = `apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://192.0.2.1:6443
contexts:
- name: c
  context:
    cluster: c
    user: u
users:
- name: u
  user:
    token: abc
current-context: c
`

test.describe('kubernetes', () => {
  test.beforeEach(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-k8s') })
  test.afterAll(async ({ request }) => { await deleteByName(request, 'servers', 'e2e-k8s') })

  test('page renders and the connect-cluster dialog validates input', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/kubernetes')
    await expect(page.getByRole('heading', { name: 'Kubernetes clusters', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Connect cluster' }).first().click()
    const dialog = page.getByRole('dialog', { name: /Connect cluster/ })
    await expect(dialog).toBeVisible()

    // Submit and test stay disabled until a kubeconfig is provided
    const submit = dialog.getByRole('button', { name: 'Connect cluster' })
    await expect(submit).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Test connection' })).toBeDisabled()

    await dialog.getByLabel('Cluster name').fill(NAME)
    await dialog.getByLabel('Kubeconfig YAML').fill(KUBECONFIG)
    await expect(submit).toBeEnabled()

    // The optional SSH proxy section expands
    await dialog.getByRole('button', { name: /SSH proxy/ }).click()
    await expect(dialog.getByLabel('Node gateway IP')).toBeVisible()

    // Upload mode swaps the editor for a drop zone
    await dialog.getByRole('button', { name: 'Upload' }).click()
    await expect(dialog.getByText(/Drag a file here/)).toBeVisible()

    await dialog.getByRole('button', { name: 'Close modal' }).click()
    await expect(dialog).toBeHidden()
    expect(errors).toEqual([])
  })

  test('connect a cluster, open the explorer and delete it with confirmation', async ({ page, request }) => {
    const res = await request.post('/api/servers', {
      headers: await authHeaders(request),
      data: { name: NAME, kube_config: KUBECONFIG, auth_type: 'password', tags: 'kubernetes', is_k8s: true },
    })
    expect(res.ok()).toBeTruthy()

    await page.goto('/kubernetes')
    const card = page.locator('.MuiCard-root').filter({ hasText: NAME })
    await expect(card).toBeVisible()

    // Explorer opens with the resource navigation; Back returns to the grid
    await card.getByRole('button', { name: 'Manage cluster' }).click()
    await expect(page.getByRole('button', { name: 'Back to clusters' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Workloads' })).toBeVisible()
    await page.getByRole('button', { name: 'Pods', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Pods', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Back to clusters' }).click()
    await expect(card).toBeVisible()

    // Delete asks in a dialog (no native confirm)
    await card.getByRole('button', { name: `Delete ${NAME}` }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete cluster?' })
    await expect(confirm).toContainText(NAME)
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: `Delete ${NAME}` }).click()
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.MuiCard-root').filter({ hasText: NAME })).toHaveCount(0)
  })
})
