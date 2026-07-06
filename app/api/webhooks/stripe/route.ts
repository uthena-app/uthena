// /api/webhooks/stripe — Stripe webhook mount point.
//
// The actual handler lives at 04-platform/webhooks/stripe/handleStripeWebhook.ts.
// This file is the thin Next.js route that adapts the request/response.
//
// Per AGENTS.md: this is the only place the route is mounted. Signature
// verification + idempotency + dispatch are all in the platform handler.

import { handleStripeWebhook } from '@platform/webhooks/stripe/handleStripeWebhook'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')
  const raw = await req.text()
  const res = await handleStripeWebhook(raw, sig)
  return new NextResponse(res.body, { status: res.status })
}
