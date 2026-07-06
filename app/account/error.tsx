// app/account/error.tsx — per-route error boundary for the
// authenticated account area. Renders INSIDE the AccountShell
// (the layout's auth gate + sidebar are still visible) so the
// user sees the familiar account chrome + a context-aware error
// surface instead of being kicked to the root error page.
//
// Same PII-safety contract as app/error.tsx: opaque ERR-{id}
// reference only, no stack/message/user_id/email/IP in the UI.
// The Sentry seam (P2.11) writes the structured event with
// surface='app.account.error' so support can filter by surface.
//
// Why per-route (per P2.11): a crash in /account/* should not
// take down the user's session or force them to navigate from a
// generic 500 — the shell + sidebar are still useful even when
// the page data fetch fails.

'use client'

import { RouteError } from '@foundations/ui/error'

export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      config={{
        surface: 'app.account.error',
        headline: 'We couldn’t load your account.',
        lede: 'The account data failed to load. Try again — your account is safe and your orders, library, and settings are unaffected.',
        helperText:
          'Your account data is intact. If the problem keeps happening, share the reference above with support and we’ll dig in.',
      }}
    />
  )
}