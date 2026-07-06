'use server'

// saveStep — persist the current user's partner-onboarding draft.
//
// P12.2 — draft persistence server action. Per the spec at
// `01-specs/pages/partner-onboarding.md` §"Server actions":
//
//   saveStep(userId, step, payload)
//     — upserts a `partner_onboarding_drafts` row.
//     — Validates payload with Zod.
//     — Returns `{ ok, savedAt }`.
//
// The userId is ALWAYS derived from the session server-side; the
// client only supplies `{ step, payload }`. RLS on
// `partner_onboarding_drafts` (`partner_onboarding_drafts_self_write`)
// is the second line of defense — even a forged client payload
// cannot target another user's row.
//
// Per-step payload Zod schemas will plug into `payloadForStep()`
// in their own slices (Slices 2-7). For P12.2 we accept any object
// — the action only validates the SHAPE (object + step in range)
// because no per-step form fields are wired yet. The shallow-merge
// into the row's `payload` jsonb means each future slice's payload
// key (`profile` / `payout` / `tax` / `kyc` / `agreement`) will
// overwrite cleanly without touching the others.
//
// Idempotency: the upsert is by `user_id` (UNIQUE on the table), so
// concurrent saves race-safe via Postgres's implicit row lock —
// whichever lands last wins on the merged payload.
//
// Rate-limited to 60/min/user per spec §Security line 112. The
// counter lives in `saveStep.rate-limit.ts` (split out so this
// file can stay a clean `'use server'` async-only module).

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import { ONBOARDING_FIRST_STEP } from '../queries/getMyOnboardingDraft'
import {
  SaveStepInput,
  type SaveStepInputT,
  type SaveStepResult,
  payloadForStep,
} from '../lib/saveStepSchema'
import { rateLimitVerdict } from './saveStep.rate-limit'

const log = loggerFor({ component: 'partner-onboarding.saveStep' })

/** Coerce the wire-format `FormData` (or JSON) into the Zod input.
 *  Server actions receive FormData when invoked from a `<form>` and
 *  a plain object when invoked from a client component — both are
 *  handled here so the wizard's `Continue` button can use either
 *  transport. */
function parseInput(raw: unknown): SaveStepInputT | null {
  // Plain object (client component path).
  if (raw && typeof raw === 'object' && !(raw instanceof FormData)) {
    const obj = raw as Record<string, unknown>
    return SaveStepInput.safeParse({
      step: typeof obj.step === 'string' ? Number.parseInt(obj.step, 10) : obj.step,
      payload: obj.payload,
    }).data ?? null
  }
  // FormData (progressive-enhancement / no-JS path).
  if (raw instanceof FormData) {
    const stepRaw = raw.get('step')
    const step = typeof stepRaw === 'string' ? Number.parseInt(stepRaw, 10) : NaN
    // The payload is JSON-encoded in a single hidden field so the
    // client can ship arbitrary objects without field-name collisions.
    const payloadRaw = raw.get('payload')
    let payload: Record<string, unknown> | undefined
    if (typeof payloadRaw === 'string' && payloadRaw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(payloadRaw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>
        }
      } catch {
        // Malformed JSON → leave payload undefined; Zod will accept.
      }
    }
    return SaveStepInput.safeParse({ step, payload }).data ?? null
  }
  return null
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
      { code: 'partner_onboarding_rate_limited', count: verdict.count },
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

  // Validate the per-step payload shape (currently permissive; future
  // slices tighten here).
  const payloadSchema = payloadForStep(parsed.step)
  const payloadParse = payloadSchema.safeParse(parsed.payload)
  if (!payloadParse.success) {
    return {
      ok: false,
      error: 'Invalid step payload.',
      code: 'invalid_input',
    }
  }
  const stepPayload = (payloadParse.data ?? {}) as Record<string, unknown>

  // Read the existing draft to merge payloads — we don't want a
  // `profile` save to clobber a prior `payout` save. The row is
  // upserted on user_id (UNIQUE), so a brand-new user gets a fresh
  // empty payload on first save.
  const { data: existing, error: readError } = await supabase
    .from('partner_onboarding_drafts')
    .select('payload, current_step, submitted_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (readError) {
    log.warn(
      { code: 'partner_onboarding_draft_read_failed', msg: readError.message },
      'saveStep: draft read failed',
    )
    return { ok: false, error: 'Could not save your progress. Please try again.', code: 'save_failed' }
  }

  // Block saves on a submitted draft — the wizard is finished.
  if (existing && existing.submitted_at) {
    return {
      ok: false,
      error: 'Your application has already been submitted.',
      code: 'save_failed',
    }
  }

  // Shallow-merge at the top level: each step owns its own key
  // (e.g. step 2 writes `profile`, step 3 writes `payout`), so
  // overwriting by key is safe and idempotent.
  const basePayload =
    existing && existing.payload && typeof existing.payload === 'object' && !Array.isArray(existing.payload)
      ? (existing.payload as Record<string, unknown>)
      : {}
  const mergedPayload: Record<string, unknown> = {
    ...basePayload,
    ...stepPayload,
  }

  // Never regress current_step — saving an earlier step should not
  // send the user back. We take the MAX of the existing step and
  // the new step.
  const existingStep =
    existing && typeof existing.current_step === 'number' && Number.isInteger(existing.current_step)
      ? existing.current_step
      : ONBOARDING_FIRST_STEP
  const nextStep = Math.max(existingStep, parsed.step)

  // Upsert by user_id (UNIQUE). The trigger `set_updated_at` fires
  // automatically on UPDATE.
  const { data: upserted, error: upsertError } = await supabase
    .from('partner_onboarding_drafts')
    .upsert(
      {
        user_id: user.id,
        current_step: nextStep,
        payload: mergedPayload,
      },
      { onConflict: 'user_id' },
    )
    .select('updated_at, current_step')
    .single()

  if (upsertError || !upserted) {
    log.warn(
      { code: 'partner_onboarding_draft_upsert_failed', msg: upsertError?.message },
      'saveStep: draft upsert failed',
    )
    return { ok: false, error: 'Could not save your progress. Please try again.', code: 'save_failed' }
  }

  // Audit log — never includes the payload body (it has PII like
  // tax_id, gov_id storage paths). Only the step number is recorded.
  const hdrs = await headers()
  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email ?? '',
    action: 'partner_onboarding.step_saved',
    targetKind: 'partner_onboarding_drafts',
    targetId: user.id,
    metadata: {
      step: parsed.step,
      next_step: nextStep,
    },
    ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent') ?? null,
  })

  // Revalidate the onboarding page so a same-tab return renders the
  // new currentStep immediately. The wizard is `dynamic = 'force-dynamic'`
  // so this is belt-and-braces; included for cross-tab freshness too.
  revalidatePath('/partner/onboarding')

  const savedAt =
    typeof upserted.updated_at === 'string' ? upserted.updated_at : new Date().toISOString()
  const currentStep =
    typeof upserted.current_step === 'number' && Number.isInteger(upserted.current_step)
      ? upserted.current_step
      : nextStep

  return { ok: true, savedAt, currentStep }
}