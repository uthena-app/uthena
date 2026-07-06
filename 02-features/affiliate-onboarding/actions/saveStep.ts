'use server'

// saveStep — persist the current user's affiliate-onboarding draft
// (and reserve the chosen handle at step 2).
//
// P13.1 — affiliate onboarding wizard draft persistence. Per the
// spec at `01-specs/pages/affiliate-onboarding.md` §"Server actions":
//
//   saveStep(userId, step, payload)
//     — upserts an `affiliate_onboarding_drafts` row.
//     — At step 2 (handle_bio), reserves the handle in
//       `handle_reservations` inside the same transaction. The DB
//       PRIMARY KEY on `handle_reservations.handle` is the race-safety
//       arbiter — two concurrent users picking the same handle race in
//       the DB; exactly one INSERT succeeds; the other gets SQLSTATE
//       23505 (unique_violation) which we map to `{ handleConflict: true }`.
//     — Validates payload with the per-step Zod schema from
//       `saveStepSchema.ts`.
//     — Returns `{ ok, savedAt, currentStep }` on success or
//       `{ ok: false, code, ... }` on every documented failure path.
//
// The userId is ALWAYS derived from the session server-side; the
// client only supplies `{ step, payload }`. RLS on
// `affiliate_onboarding_drafts` (`affiliate_onboarding_drafts_self_write`)
// is the second line of defense — even a forged client payload
// cannot target another user's row.
//
// On a submitted draft, the action refuses further writes (the
// wizard is frozen). Spec §"What this page does NOT do" + §"Save step"
// row in the User actions table makes the freeze contract explicit.
//
// Rate-limited to 60/min/user (matches the partner onboarding pattern).
// The counter lives in `saveStep.rate-limit.ts` (split out so this
// file can stay a clean `'use server'` async-only module).

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServerSupabase } from '@foundations/data/supabase'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import { validateHandle } from '@foundations/auth/reserved-handles'
import {
  ALL_STEPS,
  FIRST_STEP,
  type AffiliateOnboardingStep,
} from '../queries/getMyOnboardingDraft'
import {
  SaveStepInput,
  type SaveStepInputT,
  type SaveStepResult,
  payloadForStep,
} from '../lib/saveStepSchema'
import { rateLimitVerdict } from './saveStep.rate-limit'

const log = loggerFor({ component: 'affiliate-onboarding.saveStep' })

/** Postgres unique-violation SQLSTATE — the DB's race-safety signal
 *  for the handle_reservations PRIMARY KEY collision. */
const PG_UNIQUE_VIOLATION = '23505'

/** Coerce the wire-format `FormData` (or JSON) into the Zod input.
 *  Server actions receive FormData when invoked from a `<form>` and
 *  a plain object when invoked from a client component — both are
 *  handled here so the wizard's `Next` button can use either
 *  transport. */
function parseInput(raw: unknown): SaveStepInputT | null {
  if (raw && typeof raw === 'object' && !(raw instanceof FormData)) {
    const obj = raw as Record<string, unknown>
    return SaveStepInput.safeParse({ step: obj.step, payload: obj.payload }).data ?? null
  }
  if (raw instanceof FormData) {
    const stepRaw = raw.get('step')
    const step = typeof stepRaw === 'string' ? stepRaw : null
    const payloadRaw = raw.get('payload')
    let payload: unknown
    if (typeof payloadRaw === 'string' && payloadRaw.length > 0) {
      try {
        payload = JSON.parse(payloadRaw)
      } catch {
        payload = undefined
      }
    }
    return SaveStepInput.safeParse({ step, payload }).data ?? null
  }
  return null
}

/** Resolve the next currentStep — never regress. Saving an earlier
 *  step should not push the user back; we take the MAX of the
 *  existing step and the new step in the canonical wizard order.
 *
 *  Because we use named enum values (not ints), "MAX" maps to
 *  `indexOf` in the canonical `ONBOARDING_STEPS` array. The named
 *  enum provides the comparison ordering — same source of truth as
 *  the URL ?step= value + the DB current_step value. */
function maxStep(
  existing: AffiliateOnboardingStep,
  next: AffiliateOnboardingStep,
): AffiliateOnboardingStep {
  // Re-import the canonical step list (lazy to avoid circular deps).
  const ORDER: AffiliateOnboardingStep[] = [
    'welcome',
    'handle_bio',
    'payout',
    'promo_methods',
    'agreement',
    'submit',
  ]
  return ORDER.indexOf(existing) >= ORDER.indexOf(next) ? existing : next
}

/** Map a step id to its jsonb column name. The mapping is
 *  schema-truthful (matches migration 0045) and is the single
 *  source of truth used by the upsert payload below. */
function columnForStep(step: AffiliateOnboardingStep): string | null {
  switch (step) {
    case 'handle_bio':
      return 'handle_bio'
    case 'payout':
      return 'payout'
    case 'promo_methods':
      return 'promo_methods'
    case 'agreement':
      return 'agreement'
    case 'welcome':
    case 'submit':
      // Steps with no payload — current_step alone advances.
      return null
    default:
      return null
  }
}

/** Server action — persist the current onboarding step + payload.
 *  Returns a typed result; the caller (form / client component)
 *  branches on `ok`. */
export async function saveStepAction(input: unknown): Promise<SaveStepResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in', code: 'unauthenticated' }

  // Rate limit — keyed by the session user id (stable, never changes).
  const verdict = rateLimitVerdict(user.id, Date.now())
  if (!verdict.allowed) {
    log.warn(
      { code: 'affiliate_onboarding_rate_limited', count: verdict.count },
      'saveStep rate-limited',
    )
    return {
      ok: false,
      error: 'You are saving too quickly. Please wait a moment and try again.',
      code: 'rate_limited',
      retryAfterSeconds: verdict.retryAfterSeconds,
    }
  }

  const parsed = parseInput(input)
  if (!parsed) {
    return { ok: false, error: 'Invalid input.', code: 'invalid_input' }
  }

  // Sanity — the Zod input already pins step to the enum, but the
  // shape is enforced at the type level too (defense in depth).
  if (!ALL_STEPS.has(parsed.step as AffiliateOnboardingStep)) {
    return { ok: false, error: 'Invalid step.', code: 'invalid_input' }
  }
  const step = parsed.step as AffiliateOnboardingStep

  // Validate the per-step payload shape. Steps without payloads
  // accept `undefined` (or no payload key) so the wizard can
  // advance from step 1 → step 2 (welcome → handle_bio) without
  // requiring form data.
  const payloadSchema = payloadForStep(parsed.step)
  const payloadParse = payloadSchema.safeParse(parsed.payload)
  if (!payloadParse.success) {
    const firstIssue = payloadParse.error.issues[0]
    const friendlyMessage =
      firstIssue?.message ?? 'Invalid step payload.'
    return {
      ok: false,
      error: friendlyMessage,
      code: 'invalid_input',
    }
  }
  const stepPayload = (payloadParse.data ?? {}) as Record<string, unknown>

  // Handle-specific validation for step 2: run the reserved-list
  // check on top of the Zod shape check. The Zod schema accepts
  // ANY well-formed lowercase handle; the reserved-list is the
  // proactive block on top of that.
  if (step === 'handle_bio') {
    const rawHandle = (stepPayload as { handle?: unknown }).handle
    const handleCheck = validateHandle(rawHandle)
    if (!handleCheck.ok) {
      const message =
        handleCheck.reason === 'reserved'
          ? 'That handle is reserved. Please pick a different one.'
          : 'That handle is not valid. Use 3-30 lowercase letters, digits, or hyphens (cannot start or end with a hyphen).'
      return {
        ok: false,
        error: message,
        code: handleCheck.reason === 'reserved' ? 'handle_reserved' : 'invalid_input',
      }
    }
  }

  // Read the existing draft to merge per-step payloads + enforce the
  // "never regress currentStep" invariant. The row is upserted on
  // user_id (UNIQUE), so a brand-new user gets a fresh default
  // current_step on first save.
  const { data: existing, error: readError } = await supabase
    .from('affiliate_onboarding_drafts')
    .select('id, current_step, handle_bio, payout, promo_methods, agreement, submitted_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (readError) {
    log.warn(
      { code: 'affiliate_onboarding_draft_read_failed', msg: readError.message },
      'saveStep: draft read failed',
    )
    return { ok: false, error: 'Could not save your progress. Please try again.', code: 'save_failed' }
  }

  // Block saves on a submitted draft — the wizard is frozen.
  if (existing && existing.submitted_at) {
    return {
      ok: false,
      error: 'Your application has already been submitted.',
      code: 'submitted',
    }
  }

  // The handle reservation at step 2 is the spec's race-safe
  // contract. Two concurrent users picking "alice" race in the DB;
  // exactly one INSERT succeeds, the other gets SQLSTATE 23505.
  //
  // We INSERT the reservation BEFORE the draft upsert so a
  // reservation failure (taken handle) blocks the entire save —
  // better than reserving first then discovering the draft upsert
  // fails for an unrelated reason (the draft stays clean).
  //
  // Uses service-role client because the user-self RLS on
  // `handle_reservations` is FOR ALL (USING + WITH CHECK both on
  // user_id = auth.uid()) — and the policy is satisfiable from the
  // request session, but the service-role client keeps the path
  // uniform with other reserved-handles writes (and simplifies the
  // 23505 error mapping because we never accidentally satisfy the
  // user's own session in a way that masks the violation).
  if (step === 'handle_bio') {
    const desiredHandle = (stepPayload as { handle: string }).handle
    const serviceSupabase = getServiceSupabase()
    // Idempotency: if a prior draft save already reserved this
    // exact (user, handle) pair, the upsert is a no-op. We check
    // first to avoid a spurious 23505 if the user is just editing
    // the bio while keeping the same handle.
    const { data: priorReservation } = await serviceSupabase
      .from('handle_reservations')
      .select('handle')
      .eq('handle', desiredHandle)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!priorReservation) {
      const { error: reservationError } = await serviceSupabase
        .from('handle_reservations')
        .insert({
          handle: desiredHandle,
          user_id: user.id,
          draft_id: (existing?.id as number | undefined) ?? 0,
        })

      // 23505 = unique_violation on handle_reservations.handle →
      // someone else already has this handle. The draft upsert is
      // skipped so the user can re-pick without polluting the draft.
      if (reservationError) {
        // PostgREST surfaces the Postgres SQLSTATE in `code`.
        const code = (reservationError as { code?: string }).code
        if (code === PG_UNIQUE_VIOLATION) {
          log.info(
            { code: 'affiliate_onboarding_handle_conflict' },
            'saveStep: handle already taken',
          )
          return {
            ok: false,
            error: 'That handle is already taken. Please pick a different one.',
            code: 'handle_conflict',
            handleConflict: true,
          }
        }
        log.warn(
          { code: 'affiliate_onboarding_reservation_failed', msg: reservationError.message },
          'saveStep: reservation insert failed',
        )
        return {
          ok: false,
          error: 'Could not reserve your handle. Please try again.',
          code: 'save_failed',
        }
      }
    }
  }

  // Shallow-merge at the per-column level: each step writes to its
  // OWN jsonb column, so overwriting by column is safe and
  // idempotent. A `handle_bio` save never clobbers a prior `payout`
  // save because they live in separate columns.
  const col = columnForStep(step)
  const nextHandleBio =
    col === 'handle_bio' ? stepPayload : (existing?.handle_bio ?? {}) as Record<string, unknown>
  const nextPayout =
    col === 'payout' ? stepPayload : (existing?.payout ?? {}) as Record<string, unknown>
  const nextPromoMethods =
    col === 'promo_methods'
      ? stepPayload
      : (existing?.promo_methods ?? {}) as Record<string, unknown>
  const nextAgreement =
    col === 'agreement'
      ? { ...(stepPayload as Record<string, unknown>), accepted_at: new Date().toISOString() }
      : (existing?.agreement ?? {}) as Record<string, unknown>

  // Never regress current_step — take the MAX of the existing step
  // and the new step.
  const existingStep =
    existing && typeof existing.current_step === 'string' && ALL_STEPS.has(existing.current_step as AffiliateOnboardingStep)
      ? (existing.current_step as AffiliateOnboardingStep)
      : FIRST_STEP
  const nextStep = maxStep(existingStep, step)

  // Upsert by user_id (UNIQUE). The trigger `set_updated_at` fires
  // automatically on UPDATE. The per-step jsonb columns are
  // shallow-merged above.
  const { data: upserted, error: upsertError } = await supabase
    .from('affiliate_onboarding_drafts')
    .upsert(
      {
        user_id: user.id,
        current_step: nextStep,
        handle_bio: nextHandleBio,
        payout: nextPayout,
        promo_methods: nextPromoMethods,
        agreement: nextAgreement,
      },
      { onConflict: 'user_id' },
    )
    .select('updated_at, current_step')
    .single()

  if (upsertError || !upserted) {
    log.warn(
      { code: 'affiliate_onboarding_draft_upsert_failed', msg: upsertError?.message },
      'saveStep: draft upsert failed',
    )
    return { ok: false, error: 'Could not save your progress. Please try again.', code: 'save_failed' }
  }

  // Audit log — never includes the payload body (the handle_bio
  // payload has the user's handle + bio, and the payout payload has
  // the PayPal email — both PII). Only the step number is recorded.
  const hdrs = await headers()
  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email ?? '',
    action: 'affiliate_onboarding.step_saved',
    targetKind: 'affiliate_onboarding_drafts',
    targetId: user.id,
    metadata: {
      step,
      next_step: nextStep,
    },
    ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent') ?? null,
  })

  // Revalidate the onboarding page so a same-tab return renders
  // the new currentStep immediately. The wizard is
  // `dynamic = 'force-dynamic'` so this is belt-and-braces; included
  // for cross-tab freshness too.
  revalidatePath('/affiliate/onboarding')

  const savedAt =
    typeof upserted.updated_at === 'string' ? upserted.updated_at : new Date().toISOString()

  // Always return `nextStep` (the canonical computed value — MAX of
  // existing + new). The DB echoes `current_step` in the upsert
  // response, but trusting our local computation is safer for tests
  // (the mock's static response can't reflect the actual advance)
  // AND for production (a race where another tab wrote between our
  // SELECT and our UPSERT would still be resolved by the DB; we
  // surface the value WE wrote, which the user just acted on).
  return { ok: true, savedAt, currentStep: nextStep }
}