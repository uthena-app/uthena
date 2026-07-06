// POST /api/errors/report — the client-side boundary's seam.
//
// Every error.tsx (app/error.tsx + 6 per-route files) calls
// reportError() from a 'use client' useEffect. reportError() does a
// best-effort fetch() to this route handler. The handler validates the
// body with Zod, calls the server-only captureError seam, and returns
// 204. The client treats 4xx/5xx the same as network failure — the
// boundary must never break because the capture endpoint is unreachable.
//
// Why a route handler (not a direct server-side call):
//   - Next.js error boundaries are required to be 'use client'. The
//     seam in 00-foundations/observability/sentry.ts is server-only
//     (pino + zod). Importing it from a client component breaks the
//     build (the server-only directive fires).
//   - The route handler is the same pattern as production Sentry —
//     the browser SDK POSTs to /api/<store>/envelope/ and the server
//     SDK or a route handler does the actual capture. Net-new
//     infrastructure is zero; we own the path instead of Sentry's.
//
// Security:
//   - Public route (no auth). The body is PII-safe by construction:
//     the typed SentryActor union rejects emails; tags are
//     flat-string-only. error.message + error.stack are NEVER sent
//     client-side (the spec contract). Only error.name + error.digest
//     are forwarded.
//   - Rate-limited via the standard edge layer (DDoS / flood). The
//     seam's own `recordAuthFailure` pattern is auth-specific; the
//     error-report path doesn't need an in-DB counter (the volume
//     isn't the threat — a stuck retry loop is, and the client
//     idempotency is enforced by errId + the seam's `skipped` path
//     for duplicates via the caller not retrying).
//   - Audit-logged: captureError emits `event: 'server.error'` to
//     pino, which is the source of truth. The PH18 SDK wiring flips
//     the same payload to Sentry + admin_audit_log.

import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { captureError, type SentryContext } from '@foundations/observability/sentry'
import { checkAndRecordSlidingWindow } from '@foundations/files/rate-limit-shared'

export const dynamic = 'force-dynamic'

// ponytail: SEC-3 interim guard — 30 requests/min per-instance, keyed on
// a hashed IP (never the raw IP). This is an in-process Map, so a
// multi-instance deploy gets 30 x N_instances effective throughput; the
// durable upgrade path is `rate_limit_events`
// (04-platform/migrations/0067_rate_limit_events.sql) — swap the storage
// inside `checkAndRecordSlidingWindow` (00-foundations/files/
// rate-limit-shared.ts) for that table once a second instance exists.
const ERRORS_REPORT_LIMIT_PER_MINUTE = 30
const ERRORS_REPORT_WINDOW_MS = 60_000

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

// The body shape the client wrapper sends. Mirrors `SentryContext`
// (the seam's input) but as a request body — every field is
// PII-safe by construction (no email, no stack, no message).
const ReportErrorBody = z.object({
  surface: z.string().min(1).max(120),
  errId: z.string().regex(/^ERR-[A-Z0-9]{10,12}$/, 'invalid errId format'),
  errorName: z.string().min(1).max(120),
  errorDigest: z.string().max(120).optional(),
  // The typed Actor union enforced server-side is also enforced
  // client-side via a discriminated union — defense in depth so a
  // caller can't smuggle an email into the `user_id` field (the type
  // allows only `user_id: string`, but a malicious caller could try).
  // Server-side, `captureError` re-validates via the SentryActor type
  // + the pino redact list as a third gate.
  actor: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('anon') }),
      z.object({ kind: z.literal('user'), user_id: z.string().uuid() }),
      z.object({
        kind: z.literal('admin'),
        user_id: z.string().uuid(),
        role: z.enum(['admin', 'super_admin']),
      }),
      z.object({ kind: z.literal('system') }),
    ])
    .optional(),
  tags: z.record(z.string(), z.string()).optional(),
})

export async function POST(req: NextRequest) {
  // Rate limit BEFORE parsing the body — a flood should cost as little
  // work as possible. Still returns 204 on denial: the client wrapper
  // treats any non-throw the same (best-effort, boundary always renders).
  const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const limiterKey = `errors_report:${rawIp ? hashIp(rawIp) : 'unknown'}`
  const verdict = checkAndRecordSlidingWindow(
    limiterKey,
    ERRORS_REPORT_LIMIT_PER_MINUTE,
    ERRORS_REPORT_WINDOW_MS,
  )
  if (!verdict.allowed) {
    return new NextResponse(null, { status: 204 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    // Body parse failure — return 400. The client wrapper treats any
    // non-204 as a no-op, so this just means the capture is silently
    // dropped (the boundary still renders).
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 })
  }

  const parsed = ReportErrorBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { surface, errId, errorName, errorDigest, actor, tags } = parsed.data

  // Rebuild an Error-shaped object from the PII-safe payload. The
  // message is intentionally a generic placeholder — the client
  // wrapper never forwards error.message (per the AGENTS.md §2
  // contract). The server-side seam only reads `error.name` +
  // `error.digest`; the message is never logged.
  // Rebuild an Error-shaped object from the PII-safe payload. The
  // message is intentionally a generic placeholder — the client
  // wrapper never forwards error.message (per the AGENTS.md §2
  // contract). The server-side seam only reads `error.name` +
  // `error.digest`; the message is never logged.
  const error: Error & { digest?: string } = Object.assign(new Error(errorName), {
    name: errorName,
    ...(errorDigest ? { digest: errorDigest } : {}),
  })

  const ctx: SentryContext = {
    surface,
    errId,
    ...(actor ? { actor } : {}),
    ...(tags ? { tags } : {}),
  }

  const result = captureError(error, ctx)

  // Always 204 — the client doesn't care about the outcome (best
  // effort). Failure modes (skipped / capture threw) are logged
  // server-side via the seam; the boundary still renders fine.
  if (!result.ok) {
    return new NextResponse(null, { status: 204 })
  }
  return new NextResponse(null, { status: 204 })
}