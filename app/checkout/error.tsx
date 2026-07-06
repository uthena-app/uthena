// app/checkout/error.tsx — per-route error boundary for the
// checkout flow. Critical surface — a crash here can interrupt
// a real payment. We render INSIDE the checkout layout so the
// cart summary / progress indicator stays visible, and the
// lede explicitly tells the user "you haven't been charged" so
// they don't refresh + re-enter payment data.
//
// Same PII-safety contract as app/error.tsx. Sentry seam (P2.11)
// writes the structured event with surface='app.checkout.error'.
// Per error-500.md §Security: the Sentry event is the source of
// truth for "did Stripe charge them?" — support cross-references
// the errId in Stripe dashboard / logs.

'use client'

import { RouteError } from '@foundations/ui/error'

export default function CheckoutError({
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
        surface: 'app.checkout.error',
        headline: 'Checkout hit a snag.',
        lede:
          'We didn’t complete your order. You haven’t been charged — try again, or return to your cart.',
        helperText:
          'Your cart is saved. If you were mid-payment, double-check your card hasn’t been charged before retrying. Share the reference with support and we’ll investigate the failure.',
        homeHref: '/cart',
      }}
    />
  )
}