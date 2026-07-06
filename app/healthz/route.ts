// Convenience redirect — /healthz → /api/health. Matches the path the
// container healthcheck (and humans) reach for. Returns 200 + JSON
// because both /api/health and /healthz are public-no-auth probes.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.redirect(new URL('/api/health', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'))
}
