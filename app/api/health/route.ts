// Healthcheck endpoint — used by Docker HEALTHCHECK and uptime monitors.
// Returns 200 + JSON. Never exposes secrets. Safe to hit from anywhere
// (no auth required) — this is a public, unauthenticated probe, so it
// must not leak which third-party integrations are configured.
//
// D14 [decided: strip] — this route used to return a `features: {...}`
// object with a boolean per integration (stripe/bunny/ses/sentry/...).
// Any anonymous caller could fingerprint the deployment's configuration
// state from that (e.g. "Stripe isn't wired up yet" or "Sentry is off").
// Stripped down to overall status + basic app identity; still a valid
// load-balancer probe (200 + JSON, no DB round-trip, no auth).
import { NextResponse } from 'next/server'
import { getEnv } from '@foundations/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  const env = getEnv()
  return NextResponse.json(
    {
      ok: true,
      app: env.NEXT_PUBLIC_APP_NAME,
      env: env.NODE_ENV,
      version: process.env.npm_package_version ?? '0.0.0',
      time: new Date().toISOString(),
    },
    { status: 200 },
  )
}
