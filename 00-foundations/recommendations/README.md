# 00-foundations/recommendations/

The Gorse recommendation seam. Fail-open: if `GORSE_API_URL` is empty or any call fails, return an empty list / silently swallow the error. Recommendations are a nice-to-have, not a critical path.

## Files

- **`gorse.ts`** — server-side helpers. Exports:
  - `isGorseConfigured()` — env gate (true when `GORSE_API_URL` is set).
  - `recommend({ userId, productId?, kind, limit? })` — best-effort recommend call. Returns `[]` on any failure (network, timeout, non-2xx, JSON parse).
  - `trackEvent({ userId, productId, event, value? })` — push a feedback event. Never throws.
  - `GORSE_FEEDBACK_KINDS` — typed union: `view | click | add_to_cart | purchase | signup`.
- **`gorse.test.ts`** — 23 unit tests covering env-gated behavior, response-shape parsing, URL encoding, auth headers, error paths, and the feedback catalog.

## Event shapes

### recommend()
- Input: `{ userId: string | null, productId?: number | string, kind: 'home' | 'product' | 'library', limit?: number }`
- Output: `string[]` — the item IDs Gorse returned (empty on any failure).
- Wire format: `GET {GORSE_API_URL}/api/recommend/{kind}?limit={limit}&id={productId}` with headers `X-API-Key` (if configured) + `X-User-ID` (if userId present).
- Timeout: 800 ms via `AbortSignal.timeout`.

### trackEvent()
- Input: `{ userId, productId, event: GorseFeedbackKind, value?: number }`
- Output: `void` — never throws.
- Wire format: `POST {GORSE_API_URL}/api/feedback` with JSON body `{ UserId, ItemId, FeedbackType, Value }`. Gorse's API uses capitalized field names; the function does the mapping.
- Timeout: 800 ms via `AbortSignal.timeout`.

### GORSE_FEEDBACK_KINDS
The 5 feedback kinds Gorse understands, mapped per PHASES.md P16.1:
- `view` — passive catalog browsing; the cheapest signal
- `click` — explicit product-page click from a list
- `add_to_cart` — high-intent mid-funnel signal
- `purchase` — the strongest positive signal; what we optimize for
- `signup` — onboarding event (signed up → started browsing)

Adding a new kind: edit `GORSE_FEEDBACK_KINDS` + the matching recommendation logic in the Gorse deployment.

## Why fail-open?

Recommendations are a "would be nice" feature, not a critical path. If Gorse is down, the page renders without the rail — better than failing the entire page render. The seam's contract is "return `[]` or void, never throw". Tested explicitly in `gorse.test.ts`.

## Why timeout-bounded?

A recommendation call shouldn't ever block a page render. The 800 ms ceiling is generous enough to cover a healthy Gorse deployment + cold cache; tight enough to fall through to the empty-state branch before the user notices a hang.

## Server-only

This module is server-side (no `'use client'`). The recommended way to use it is from RSCs (`app/page.tsx` → `recommend()` for the home rail) and from server actions (`trackEvent` from `addToCartAction`). Avoid calling it from client islands — the `GORSE_API_URL` is server-side and shouldn't ship to the client.