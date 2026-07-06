// app/library/error.tsx — per-route error boundary for the
// user library (purchased + subscription content). Critical
// surface — users hit this every time they want to access what
// they bought, so an error here has high support cost. The
// library chrome (LibraryNav) stays visible so the user can
// navigate between Purchased / Personal Access / File Vault
// even if one section failed to load.
//
// Same PII-safety contract as app/error.tsx. Sentry seam (P2.11)
// writes the structured event with surface='app.library.error'.

'use client'

import { RouteError } from '@foundations/ui/error'

export default function LibraryError({
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
        surface: 'app.library.error',
        headline: 'We couldn’t load your library.',
        lede: 'The library data failed to load. Try again — your purchased and subscription content is unaffected.',
        helperText:
          'You can still browse the catalog and reach support from the top nav. If this keeps happening, share the reference above and we’ll dig in.',
      }}
    />
  )
}