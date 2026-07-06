// /affiliate/links — error boundary. Same shape as the dashboard
// boundary — the affiliate shell persists so the affiliate can
// keep navigating to other surfaces. PII-safe per
// `app/error.tsx`.
//
// Sentry seam (P2.11) writes the structured event with
// `surface='app.affiliate.links.error'`.

'use client'

import { RouteError } from '@foundations/ui/error'

export default function AffiliateLinksError({
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
        surface: 'app.affiliate.links.error',
        headline: 'We couldn’t load your affiliate links.',
        lede: 'The link data failed to load. Try again — your links, clicks, and conversions are unaffected.',
        helperText:
          'If this keeps happening, share the reference above with affiliate support and we’ll investigate.',
      }}
    />
  )
}
