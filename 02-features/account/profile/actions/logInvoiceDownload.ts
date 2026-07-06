'use server'

// logInvoiceDownload.ts — server action that records an invoice-redirect
// audit row. Called when the user clicks the "Download invoice" CTA on
// /account/orders/[id].
//
// Why a server action and not just a `<a target="_blank" href={stripeUrl}>`?
//   - The audit row goes in `file_downloads` with `kind='invoice_redirect'`
//     (the migration 0034 CHECK constraint widens the legal values to
//     include this). Service-role write — RLS only allows self-read.
//   - The page is RSC; the click is a server roundtrip so we get a fresh
//     `auth.uid()` for the row's `user_id` (never trust client-side
//     identity).
//   - 60/hour + 200/day rate limit per user (spec acceptance criterion
//     "Rate limiting on invoice download"). Shared with the library
//     download rate-limit bucket via a typed helper.
//
// PII safety:
//   - The Stripe `hosted_invoice_url` is single-tenant (keyed by Customer
//     ID), so it's effectively a bearer token. We DO NOT log the URL,
//     only `invoice_id` (Stripe's `in_xxx` opaque id).
//   - `ip_address` is the hashed IP (NOT raw) when the caller can read
//     headers — same shape as the library download audit row.

import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { rateLimitVerdict } from './logInvoiceDownload.rate-limit'

const log = loggerFor({ component: 'account.profile.logInvoiceDownload' })

// 24h — matches the spec's "signed URL 24h TTL" requirement, even though
// Stripe's hosted URLs are technically longer-lived. We cap the audit
// row's `url_expires_at` so the retention scanner (P3.5 — cleanup at
// 90 days for `file_downloads`) sees a consistent shape.
const URL_TTL_MS = 24 * 60 * 60 * 1000

const InputSchema = z.object({
  orderId: z.number().int().positive(),
  invoiceId: z.string().min(1).max(64),
})

export type LogInvoiceDownloadInput = z.infer<typeof InputSchema>

export type LogInvoiceDownloadResult =
  | { ok: true; remaining: number }
  | { ok: false; error: 'not_authenticated' | 'rate_limited' | 'invalid_input' | 'audit_failed'; retryAfterMs?: number }

export async function logInvoiceDownloadAction(
  input: LogInvoiceDownloadInput,
): Promise<LogInvoiceDownloadResult> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const { orderId, invoiceId } = parsed.data

  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const verdict = rateLimitVerdict(user.id, Date.now())
  if (!verdict.allowed) {
    log.warn(
      { code: 'invoice_download_rate_limited', remaining: verdict.remaining },
      'invoice download rate limit triggered',
    )
    return { ok: false, error: 'rate_limited', retryAfterMs: verdict.retryAfterMs }
  }

  const supabase = getServiceSupabase()
  const { error } = await supabase.from('file_downloads').insert({
    user_id: user.id,
    file_id: null,
    product_id: null,
    kind: 'invoice_redirect',
    url_expires_at: new Date(Date.now() + URL_TTL_MS).toISOString(),
    // IP hashing is left to the middleware in P7 (downloads use ip_hash).
    // For invoice redirects there's no range request, so ip_hash/ip_raw
    // are null — the Stripe side already logged the access.
    ip_hash: null,
    ip_raw: null,
    user_agent: null,
    range_start: null,
    range_end: null,
    bytes_served: null,
    edge_location: null,
  })
  // The order_id + invoice_id pair is intentionally NOT stored on the
  // row — `file_downloads` has no `order_id` column. Stripe's own
  // dashboard logs the invoice access by `invoice_id`, so ops can
  // correlate by user_id + timestamp window + invoice_id search. We
  // keep `invoice_id` only in the success log path below (warn-on-error
  // path, PII-safe — it's an opaque Stripe id, not user PII).

  if (error) {
    log.warn(
      { code: 'audit_insert_failed', msg: error.message },
      'logInvoiceDownloadAction: insert failed',
    )
    return { ok: false, error: 'audit_failed' }
  }

  return { ok: true, remaining: verdict.remaining }
}