'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { RefundRequestInput } from '@foundations/data/schemas'
import {
  REFUND_PROOF_PATH_PREFIX,
  sanitizeRefundProofFilename,
} from '@foundations/files/refund-proof-upload'
import { loggerFor } from '@foundations/log/pino'
import { _refundTimestamps } from './createRefundRequest.rate-limit'

const log = loggerFor({ component: 'account.profile.refund' })

export type RefundRequestResult =
  | { ok: true; refundId: number; idempotentReplay?: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Test-only — reset the in-process refund-rate-limit bucket. Lives
 * in the sibling `createRefundRequest.rate-limit.ts` module (not
 * re-exported from this `'use server'` file because Next.js requires
 * every export from a `'use server'` file to be async). Test code
 * imports `_resetRefundRateLimitForTests` directly from the sibling
 * module — same pattern as `logInvoiceDownload.rate-limit.ts`.
 */

/**
 * Idempotency contract (P9.12 acceptance criterion #8):
 *
 * The client generates a `clientRequestId` (UUID) on mount and re-sends
 * the same key on every retry of the same form submission. The action
 * MUST NOT create a duplicate `refunds` row when the same key is seen
 * twice (e.g. the user double-clicks Submit, the browser reconnects
 * mid-flight, etc.). The defense is two-layered:
 *
 *   1. Pre-check: before inserting, look up any existing refund with
 *      this `client_request_id`. If found, return that refund's id
 *      (with `idempotentReplay: true` so the caller can choose to
 *      suppress a success toast if it wants to).
 *   2. Safety net: the unique partial index on
 *      `refunds.client_request_id` (migration 0035) catches the race
 *      where two parallel requests with the same key slip past the
 *      pre-check. On a unique-violation insert, the action looks up
 *      the winner and returns its id.
 *
 * The action NEVER auto-creates a refund row for admin-issued refunds
 * (those are the P14.9 admin surface and use the service-role client
 * directly). Admin refunds have `client_request_id IS NULL`, which is
 * exactly why the index is partial — admin rows don't compete for the
 * user's idempotency key.
 */
export async function createRefundRequestAction(input: unknown): Promise<RefundRequestResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // Map camelCase caller's field names → the snake_case schema field
  // names. The shared schema uses snake_case (matches the DB columns);
  // the call site (the refund form) uses camelCase. The proof fields
  // are also mapped here.
  const raw = input as Record<string, unknown> | undefined
  const mapped = {
    order_id: raw?.orderId,
    reason: raw?.reason,
    notes: raw?.notes ?? '',
    amount_cents: raw?.amountCents,
    // Idempotency + proof fields — all optional. The Zod schema
    // enforces per-field constraints (length, charset, etc.).
    client_request_id: raw?.clientRequestId || undefined,
    proof_path: raw?.proofPath || undefined,
    proof_filename: raw?.proofFilename || undefined,
  }
  const parsed = RefundRequestInput.safeParse(mapped)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  // Defense-in-depth on the proof path — the schema accepts any
  // string ≤500 chars, but the action only honors proof_paths that
  // start with the canonical `refund-proofs/{userId}/` prefix. This
  // catches a tampered form submission that tries to point admins at
  // a user-controlled path (e.g. an avatar in `avatars/{userId}/...`
  // — admins should never read those via the refund surface).
  if (parsed.data.proof_path) {
    const expectedPrefix = `${REFUND_PROOF_PATH_PREFIX}/${user.id}/`
    if (!parsed.data.proof_path.startsWith(expectedPrefix)) {
      log.warn(
        {
          code: 'refund_proof_path_prefix_mismatch',
          // Never log the user id directly (PII-safety); the redact
          // list catches `*.user_id` paths as a defense-in-depth
          // gate. We log the prefix mismatch shape only.
          storagePath: parsed.data.proof_path.replace(user.id, '<redacted>'),
        },
        'createRefundRequestAction: proof_path prefix mismatch — rejecting',
      )
      return {
        ok: false,
        error: 'The proof attachment is invalid. Please re-upload the file.',
      }
    }
  }

  // Sanitize the filename server-side too (defense in depth — the
  // mint action already returns a server-sanitized filename, but a
  // tampered form could submit a different one). The same
  // `sanitizeRefundProofFilename` helper runs.
  const sanitizedProofFilename = parsed.data.proof_filename
    ? sanitizeRefundProofFilename(parsed.data.proof_filename)
    : undefined

  const now = Date.now()
  const userTimestamps = (_refundTimestamps.get(user.id) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  )
  if (userTimestamps.length >= RATE_LIMIT_MAX) {
    log.warn({ code: 'refund_rate_limit', user_id: user.id }, 'refund request rate-limited')
    return {
      ok: false,
      error: 'You have submitted the maximum number of refund requests today. Please try again tomorrow.',
    }
  }

  // Idempotency pre-check. If the client_request_id was already
  // used (a retry from the same submission), return the existing
  // refund id with `idempotentReplay: true`. This is the primary
  // defense against duplicate inserts on retry.
  if (parsed.data.client_request_id) {
    const { data: existingRefund } = await supabase
      .from('refunds')
      .select('id, status')
      .eq('client_request_id', parsed.data.client_request_id)
      .maybeSingle()
    if (existingRefund && typeof (existingRefund as { id: number }).id === 'number') {
      log.info(
        {
          refund_id: (existingRefund as { id: number }).id,
          order_id: parsed.data.order_id,
          idempotent_replay: true,
        },
        'refund request idempotent replay (returning existing refundId)',
      )
      // No revalidatePath — the page state didn't change. No new
      // rate-limit charge — the retry counts as the same attempt
      // from the user's perspective.
      return {
        ok: true,
        refundId: (existingRefund as { id: number }).id,
        idempotentReplay: true,
      }
    }
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, user_id, status, total_cents, refunded_cents')
    .eq('id', parsed.data.order_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!order) return { ok: false, error: 'Order not found.' }
  if (order.status !== 'paid') {
    return { ok: false, error: 'This order is not eligible for a refund.' }
  }
  const remaining = (order.total_cents as number) - ((order.refunded_cents as number) ?? 0)
  if (parsed.data.amount_cents > remaining) {
    return { ok: false, error: 'Refund amount exceeds the remaining refundable balance.' }
  }

  const insertPayload: Record<string, unknown> = {
    order_id: parsed.data.order_id,
    amount_cents: parsed.data.amount_cents,
    reason: parsed.data.reason,
    notes: parsed.data.notes === '' ? null : parsed.data.notes,
    status: 'pending',
    requested_by: user.id,
  }
  // Attach the idempotency + proof fields only when present. Storing
  // NULL for missing client_request_id keeps the partial index
  // happy (NULL values are excluded from the index entirely, so
  // admin-issued refunds can coexist with user retries).
  if (parsed.data.client_request_id) {
    insertPayload.client_request_id = parsed.data.client_request_id
  }
  if (parsed.data.proof_path) {
    insertPayload.proof_path = parsed.data.proof_path
  }
  if (sanitizedProofFilename) {
    insertPayload.proof_filename = sanitizedProofFilename
  }

  const { data: insertRes, error: insertErr } = await supabase
    .from('refunds')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insertErr || !insertRes) {
    // Race-condition safety net: the unique partial index on
    // `client_request_id` rejects a second insert with the same key
    // if two parallel requests slipped past the pre-check. The
    // error code 23505 is Postgres's "unique_violation". The
    // action recovers by looking up the winning row and returning
    // its id — same contract as a pre-check hit, just a different
    // timing.
    const pgCode = (insertErr as { code?: string } | null)?.code
    if (
      pgCode === '23505' &&
      parsed.data.client_request_id
    ) {
      const { data: raceWinner } = await supabase
        .from('refunds')
        .select('id, status')
        .eq('client_request_id', parsed.data.client_request_id)
        .maybeSingle()
      if (raceWinner && typeof (raceWinner as { id: number }).id === 'number') {
        log.info(
          {
            refund_id: (raceWinner as { id: number }).id,
            order_id: parsed.data.order_id,
            idempotent_replay: true,
            recovered_from: 'unique_violation',
          },
          'refund request idempotent replay (recovered from unique-violation race)',
        )
        return {
          ok: true,
          refundId: (raceWinner as { id: number }).id,
          idempotentReplay: true,
        }
      }
    }
    log.warn({ code: 'refund_insert_failed', msg: insertErr?.message }, 'refund insert failed')
    return { ok: false, error: 'Could not submit your refund request. Please try again.' }
  }

  userTimestamps.push(now)
  _refundTimestamps.set(user.id, userTimestamps)

  log.info(
    { refund_id: (insertRes as { id: number }).id, order_id: parsed.data.order_id },
    'refund request submitted (emails not yet wired — PH18)',
  )

  revalidatePath(`/account/orders/${parsed.data.order_id}`)
  return { ok: true, refundId: (insertRes as { id: number }).id }
}