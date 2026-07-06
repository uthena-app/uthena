// app/partner/error.tsx — per-route error boundary for the
// partner portal. Renders INSIDE the partner layout (the auth
// gate + partner chrome stay visible). A crash in /partner/*
// shouldn't kick the partner to a generic 500 — they lose
// context on what they were doing.
//
// Same PII-safety contract as app/error.tsx. Sentry seam (P2.11)
// writes the structured event with surface='app.partner.error'.

'use client'

import { RouteError } from '@foundations/ui/error'

export default function PartnerError({
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
        surface: 'app.partner.error',
        headline: 'We couldn’t load your partner dashboard.',
        lede: 'The partner data failed to load. Try again — your course catalog, payouts, and settings are unaffected.',
        helperText:
          'If this keeps happening, share the reference above with partner support and we’ll investigate.',
      }}
    />
  )
}