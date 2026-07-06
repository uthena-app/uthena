// app/admin/error.tsx — per-route error boundary for the admin
// console. Renders INSIDE the admin layout (which has its own auth
// gate via requireRole). When something inside /admin/* throws,
// the admin shell stays visible so the operator can navigate
// elsewhere in the console — better than being kicked to the root
// 500 page mid-task.
//
// Same PII-safety contract as app/error.tsx. Sentry seam (P2.11)
// writes the structured event with surface='app.admin.error'.

'use client'

import { RouteError } from '@foundations/ui/error'

export default function AdminError({
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
        surface: 'app.admin.error',
        headline: 'The admin console hit a snag.',
        lede: 'That action didn’t complete. Try again — most blips are transient.',
        helperText:
          'Admin actions are atomic — if you don’t see your change reflected, refresh the page and re-check before retrying.',
      }}
    />
  )
}