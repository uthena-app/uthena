// app/affiliate/error.tsx — per-route error boundary for the
// affiliate portal. Same shape as the partner boundary — the
// affiliate shell (sidebar + chrome) stays visible so the
// affiliate can keep navigating. PII-safe per app/error.tsx.
//
// Sentry seam (P2.11) writes the structured event with
// surface='app.affiliate.error'.

'use client'

import { RouteError } from '@foundations/ui/error'

export default function AffiliateError({
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
        surface: 'app.affiliate.error',
        headline: 'We couldn’t load your affiliate dashboard.',
        lede: 'The affiliate data failed to load. Try again — your links, clicks, and earnings are unaffected.',
        helperText:
          'If this keeps happening, share the reference above with affiliate support and we’ll investigate.',
      }}
    />
  )
}