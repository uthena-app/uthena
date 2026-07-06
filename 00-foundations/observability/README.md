# 00-foundations/observability/

Monitoring, logging, metrics, alerts. The things that let us know the app is healthy and the things that help us debug when it's not.

This folder ships **early** (P2.11) with just the env-gated Sentry seam that every error boundary (`app/error.tsx`, `app/global-error.tsx`, and the per-route files in `app/{account,admin,partner,affiliate,library,checkout}/error.tsx`) wires against. The full observability stack (Sentry SDK init, Prometheus, OpenTelemetry, alerts, log schema) is documented in [`04-platform/observability/README.md`](../../04-platform/observability/README.md) and lands across PH18 (P18.1 Sentry, P18.2–18.5 the rest).

## Why ship the seam now (P2.11) and the SDK later (PH18)

The P2.11 acceptance criterion in `PHASES.md` calls for "friendly error pages, Sentry capture (once Phase 18 wires it)." The "once PH18 wires it" carve-out means the Sentry SDK is intentionally not in this tick. But the call sites (every error.tsx file) need a stable API to wire against NOW so they don't have to be rewritten when the SDK lands. The seam-first pattern matches P2.5 (Stripe), P2.9 (PostHog/Gorse/SES), and P2.4 (Bunny) — env-gated, dev-fallback, call-site contract before SDK.

## Files

- **`sentry.ts`** — the env-gated `captureError(error, ctx)` seam + `isSentryConfigured()` gate. Returns `SentryCaptureResult = { ok: true, mode: 'log' | 'sentry', id } | { ok: false, mode: 'skipped', reason }`. In dev (or when SENTRY_DSN is empty), writes the PII-safe structured event to pino. When Sentry is configured but the SDK isn't wired yet (this tick's reality), writes the same event AND logs a `sentry.configured_but_sdk_not_wired` warning so support can see when the DSN is set but the SDK hasn't shipped.
- **`sentry.test.ts`** — 12 tests covering env-gated behavior, PII safety (never logs error.message or error.stack), required payload fields (errId, surface, error.name, error.digest), defensive paths (missing errId → skipped, captureError throwing → caught).

## The PII-safety contract

Per AGENTS.md §2 ("No PII in logs. Ever."), the seam never logs:

- `error.message` — often contains URLs, user input, or PII-flavored fragments from the failing query
- `error.stack` — contains file paths + variable values that may leak internal structure
- The user's email (the `SentryActor` type intentionally has no `email` field — only IDs + roles)

It DOES log:

- `errId` — the human-quotable reference shown to the user
- `surface` — which boundary fired (`'app.error'`, `'app.account.error'`, ...)
- `error.name` — the exception class (safe — just the class name like `DatabaseConnectionError`)
- `error.digest` — Next.js's opaque hash (safe)
- Caller-supplied `tags` + `actor` (typed narrowly so PII-shaped values won't type-check)

## Usage from an error boundary

```tsx
'use client'

import { RouteError } from '@foundations/ui/error'

export default function CheckoutError({ error, reset }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      config={{
        surface: 'app.checkout.error',
        headline: 'Checkout hit a snag.',
        lede: "We didn't complete your order. You haven't been charged — try again, or return to your cart.",
      }}
    />
  )
}
```

`RouteError` calls `captureError(error, { surface: config.surface, errId })` from its `useEffect`. The seam handles the env-gated behavior and the structured event.

## When PH18 lands

The seam flips from `'log'` to `'sentry'` mode without any call-site change. The SDK init lands in `04-platform/observability/sentry.ts` (separate from this seam) and `import('@sentry/nextjs').then(({ captureException }) => captureException(...))` becomes the configured-mode transport. The call-site contract (`captureError(error, ctx) → SentryCaptureResult`) stays the same.