// Gorse — recommendation engine seam. Fail-open: if GORSE_API_URL is
// empty or the call fails, return an empty list / silently swallow the
// error. Recommendations are a nice-to-have, not a critical path.
//
// P2.9 ship:
//   - `recommend({ userId, productId?, kind, limit? })` — best-effort
//     recommend call. Returns `[]` on any failure.
//   - `trackEvent({ userId, productId, event, value? })` — push a
//     feedback event. Never throws.
//   - `GORSE_FEEDBACK_KINDS` — the typed union of feedback kinds
//     (mirrors Gorse's FeedbackType enum).
//   - `isGorseConfigured()` — env gate.
//
// Call sites: P16.1 wires `trackEvent` from `addToCartAction`,
// `createCheckoutSession`, `signUpAction`. P16.2 wires the home /
// product / library recommendation rails that consume `recommend()`.
// The seam is stable from P2.9 forward; consumers adopt when their
// phase lands.

import { getEnv } from '@foundations/env'

// ---------------------------------------------------------------------------
// Env gate
// ---------------------------------------------------------------------------

export function isGorseConfigured(): boolean {
  return Boolean(getEnv().GORSE_API_URL)
}

// ---------------------------------------------------------------------------
// Feedback catalog
// ---------------------------------------------------------------------------

/** Typed union of feedback kinds Gorse understands. The wire field
 *  is `FeedbackType` and Gorse expects one of these strings exactly. */
export const GORSE_FEEDBACK_KINDS = [
  'view',
  'click',
  'add_to_cart',
  'purchase',
  'signup',
] as const satisfies readonly string[]

export type GorseFeedbackKind = (typeof GORSE_FEEDBACK_KINDS)[number]

// ---------------------------------------------------------------------------
// Recommend
// ---------------------------------------------------------------------------

export type RecommendKind = 'home' | 'product' | 'library'

/** Best-effort recommend call. Returns `[]` on any failure (no URL,
 *  timeout, non-OK, malformed JSON). The timeout is 800 ms — short
 *  enough that an outage doesn't block RSC streaming. */
export async function recommend(opts: {
  userId: string | null
  productId?: number | string
  kind: RecommendKind
  limit?: number
}): Promise<string[]> {
  const env = getEnv()
  if (!env.GORSE_API_URL) return []
  const limit = opts.limit ?? 12
  // Manual query string with encodeURIComponent — `URLSearchParams`
  // uses form encoding (`+` for spaces) but Gorse expects percent
  // encoding (`%20`). Verified by gorse.test.ts:142.
  const params = [`limit=${limit}`]
  if (opts.productId !== undefined) {
    params.push(`id=${encodeURIComponent(String(opts.productId))}`)
  }
  const url = `${env.GORSE_API_URL}/api/recommend/${opts.kind}?${params.join('&')}`
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (env.GORSE_API_KEY) headers['X-API-Key'] = env.GORSE_API_KEY
    if (opts.userId) headers['X-User-ID'] = opts.userId
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(800) })
    if (!res.ok) return []
    const data: unknown = await res.json()
    return normalizeRecommendPayload(data)
  } catch {
    return []
  }
}

/** Normalize the Gorse response payload. Gorse returns one of:
 *  - `string[]` (the common shape for `/api/recommend/<kind>`)
 *  - `{ items: Array<{ Id?: string; id?: string }> }` (alternative)
 *  - `null` / `undefined` / an object (malformed — treat as empty)
 *
 *  Empty strings are filtered out so the caller never has to.
 */
function normalizeRecommendPayload(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (data !== null && typeof data === 'object' && 'items' in data) {
    const items = (data as { items?: unknown }).items
    if (!Array.isArray(items)) return []
    return items
      .filter((item): item is { Id?: string; id?: string } => item !== null && typeof item === 'object')
      .map((item) => item.Id ?? item.id ?? '')
      .filter((id) => id.length > 0)
  }
  return []
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/**
 * Push a feedback event. Never throws — the Gorse seam is fail-open
 * and losing one feedback event should never break the user-facing
 * flow. The helper is fire-and-forget; callers can `await` for
 * safety but should not block the user on it.
 */
export async function trackEvent(input: {
  userId: string
  productId: string
  event: GorseFeedbackKind
  value?: number
}): Promise<void> {
  const env = getEnv()
  if (!env.GORSE_API_URL) return
  try {
    await fetch(`${env.GORSE_API_URL}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.GORSE_API_KEY ? { 'X-API-Key': env.GORSE_API_KEY } : {}),
      },
      body: JSON.stringify({
        UserId: input.userId,
        ItemId: input.productId,
        FeedbackType: input.event,
        Value: input.value,
      }),
      signal: AbortSignal.timeout(800),
    })
  } catch {
    // No-op. The Gorse seam is fail-open.
  }
}