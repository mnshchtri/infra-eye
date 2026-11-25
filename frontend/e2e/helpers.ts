import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const ADMIN = { username: 'admin', password: process.env.E2E_ADMIN_PASSWORD || 'infra123' }

/** Log in through the UI form (used by the setup project and login tests). */
export async function uiLogin(page: Page, username = ADMIN.username, password = ADMIN.password) {
  await page.goto('/login')
  await page.locator('#login-username').fill(username)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button', { name: /sign in|log in|login/i }).click()
}

/** Authenticated API context bound to the browser's stored token. */
export async function apiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', { data: ADMIN })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).token
}

export async function authHeaders(request: APIRequestContext) {
  return { Authorization: `Bearer ${await apiToken(request)}` }
}

/** Remove any leftovers from earlier runs so tests are repeatable. */
export async function deleteByName(request: APIRequestContext, path: 'servers' | 'alert-rules' | 'resources', prefix: string) {
  const headers = await authHeaders(request)
  const res = await request.get(`/api/${path}`, { headers })
  if (!res.ok()) return
  const list: { id: number; name: string }[] = await res.json()
  for (const item of list.filter(i => i.name.startsWith(prefix))) {
    await request.delete(`/api/${path}/${item.id}`, { headers })
  }
}
