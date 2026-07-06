// GET /api/search?q=...&limit=...
//
// Instant-search backend for the global ⌘K overlay (P0.4) and the
// future /search?q= results page (P0.19). Returns up to `limit`
// published products matching the query, sorted newest-first.
//
// Public — no auth required. SEC-3 interim guard: 60/min/hashed-IP via
// the shared in-process limiter (see the `ponytail:` comment below for
// the durable-store upgrade path). Gateway-level protection (DDoS,
// abusive IPs) still lives at the edge on top of this.
//
// Zod-validates input (length-bounded, type-checked) before the DB
// call. No secrets, no PII in the response.

import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { searchPublishedProducts } from '@features/search/queries'
import { checkAndRecordSlidingWindow } from '@foundations/files/rate-limit-shared'

export const dynamic = 'force-dynamic'

// ponytail: SEC-3 interim guard — 60 requests/min per-instance, keyed on
// a hashed IP (never the raw IP). In-process Map — a multi-instance
// deploy gets 60 x N_instances effective throughput. Durable upgrade
// path: `rate_limit_events` (04-platform/migrations/
// 0067_rate_limit_events.sql) — swap the storage inside
// `checkAndRecordSlidingWindow` (00-foundations/files/rate-limit-shared.ts)
// for that table once a second instance exists.
const SEARCH_LIMIT_PER_MINUTE = 60
const SEARCH_WINDOW_MS = 60_000

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

const SearchQuery = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
})

export async function GET(req: NextRequest) {
  const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const limiterKey = `search:${rawIp ? hashIp(rawIp) : 'unknown'}`
  const verdict = checkAndRecordSlidingWindow(limiterKey, SEARCH_LIMIT_PER_MINUTE, SEARCH_WINDOW_MS)
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many search requests. Try again shortly.' },
      {
        status: 429,
        headers: { 'Retry-After': String(verdict.retryAfterSeconds) },
      },
    )
  }

  const url = new URL(req.url)
  const parsed = SearchQuery.safeParse({
    q: url.searchParams.get('q') ?? '',
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_query', message: parsed.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const { q, limit } = parsed.data
  const products = await searchPublishedProducts(q, limit)
  return NextResponse.json(
    { q, count: products.length, products },
    {
      status: 200,
      headers: {
        // Instant-search responses are private to the user (the
        // overlay never shares its result list across users), but
        // they aren't user-personalized. A short cache lets the
        // browser dedupe identical lookups across navigation while
        // keeping results fresh enough for "did the catalog update
        // yet?" to feel current. The overlay's own debounce layer
        // ensures we don't hammer the endpoint.
        'Cache-Control': 'private, max-age=15',
      },
    },
  )
}