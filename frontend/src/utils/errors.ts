/**
 * Helpers for turning a caught `unknown` into something displayable.
 *
 * The backend passes real errors through verbatim (see docs/DESIGN_PRINCIPLES.md)
 * in a `{ error: string }` body, so that field is almost always the most useful
 * thing to show. These exist so call sites can catch `unknown` — which is what
 * a `catch` binding actually is — instead of widening to `any` just to reach
 * `.response.data.error`.
 */

/** The backend's raw error body, for the rare caller that needs more than the message. */
export function apiErrorBody(e: unknown): { error?: string; details?: string } | undefined {
  return (e as { response?: { data?: { error?: string; details?: string } } })?.response?.data
}

/** The backend's own error string, if the failure carried an API response. */
export function apiError(e: unknown): string | undefined {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error
}

/**
 * The best available message: the backend's error, else the thrown Error's
 * message, else `fallback`. Use `apiError(e) || '…'` instead when a specific
 * fallback should win over a generic transport message like
 * "Request failed with status code 500".
 */
export function errMessage(e: unknown, fallback = 'Unknown error'): string {
  const api = apiError(e)
  if (api) return api
  if (e instanceof Error && e.message) return e.message
  return fallback
}
