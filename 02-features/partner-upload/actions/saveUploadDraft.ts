'use server'

// saveUploadDraft — persist the current user's partner-upload wizard draft.
//
// P12.7 Slice 1 — autosave server action. Per the spec at
// `01-specs/pages/instructor-upload.md` §"User actions":
//
//   Save draft | (automatic, debounced 1s after any field change)
//             | Saves draft_payload to partner_upload_drafts with status='draft'
//             | partner (own draft)
//
// The userId is ALWAYS derived from the session server-side; the client
// only supplies `{ step, payload }`. RLS on `partner_upload_drafts`
// (`partner_upload_drafts_self_write`) is the second line of defense —
// even a forged client payload cannot target another user's row.
//
// Per-step payload Zod schemas live in `payloadForStep()` (lib file).
// Slice 1 ships the Step 1 (Details) schema (title + long_description +
// category_id + kind); Steps 2-5 (Curriculum / Files / Pricing / Review)
// ship permissive open shapes that Slices 2-5 tighten in place. The
// shallow-merge into the row's `payload` jsonb means each step's payload
// key (`details` / `curriculum` / `files` / `pricing` / `review`) lives
// in its own slot, so overwriting by key is safe and idempotent.
//
// Idempotency: the upsert is by `user_id` (UNIQUE on the table), so
// concurrent saves race-safe via Postgres's implicit row lock —
// whichever lands last wins on the merged payload.
//
// Rate-limited to 60/min/user. The client-side debounce (1s) caps the
// natural cadence; the server-side cap is the floor under a
// misbehaving client. Mirrors the partner-onboarding `saveStepAction`
// (P12.2) + the export-ledger `exportLedgerCsv` (P6.3) pattern.
//
// The action also updates `current_step` and `last_saved_step`:
//   - `current_step` = MAX(existing, new) — never regresses (saving an
//     earlier step must not push the user back in the wizard)
//   - `last_saved_step` = new step — the wizard's right-rail "Saved
//     step N at..." indicator reads this
// We do NOT bump `current_step` on a save that lacks the step's
// payload shape (e.g. an empty-payload Step 1 save from the URL-only
// navigation); only well-formed payloads advance the cursor.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import {
  SaveUploadDraftInput,
  type SaveUploadDraftInputT,
  type SaveUploadDraftResult,
  payloadForStep,
  UPLOAD_FIRST_STEP,
} from '../lib/saveUploadDraftSchema'
import { rateLimitVerdict } from './saveUploadDraft.rate-limit'

const log = loggerFor({ component: 'partner-upload.saveUploadDraft' })

/** Coerce the wire-format `FormData` (or JSON) into the Zod input.
 *  Server actions receive FormData when invoked from a `<form>` and
 *  a plain object when invoked from a client component — both are
 *  handled here so the wizard's autosave can use either transport. */
function parseInput(raw: unknown): SaveUploadDraftInputT | null {
  // Plain object (client component path — the common case for the
  // debounced autosave triggered by the DetailsStep form).
  if (raw && typeof raw === 'object' && !(raw instanceof FormData)) {
    const obj = raw as Record<string, unknown>
    return SaveUploadDraftInput.safeParse({
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
    return SaveUploadDraftInput.safeParse({ step, payload }).data ?? null
  }
  return null
}

/** Server action — persist the current upload-wizard step + payload.
 *  Returns a typed result; the caller (form / client component)
 *  branches on `ok`. */
export async function saveUploadDraftAction(input: unknown): Promise<SaveUploadDraftResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in', code: 'unauthenticated' }

  // Rate limit — keyed by the session user id (stable, never changes).
  // Mirrors the partner-onboarding saveStep pattern (P12.2).
  const verdict = rateLimitVerdict(user.id, Date.now())
  if (!verdict.allowed) {
    log.warn(
      { code: 'partner_upload_save_rate_limited', count: verdict.count },
      'saveUploadDraft rate-limited',
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

  // Validate the per-step payload shape. Slice 1 ships a strict
  // Details schema for step 1; Steps 2-5 are open until their slices
  // tighten them. A failed parse = invalid_input (no DB write).
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
  // `details` save to clobber a prior `curriculum` save. The row is
  // upserted on user_id (UNIQUE), so a brand-new user gets a fresh
  // empty payload on first save.
  const { data: existing, error: readError } = await supabase
    .from('partner_upload_drafts')
    .select('payload, current_step, last_saved_step, status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (readError) {
    log.warn(
      { code: 'partner_upload_draft_read_failed', msg: readError.message },
      'saveUploadDraft: draft read failed',
    )
    return {
      ok: false,
      error: 'Could not save your progress. Please try again.',
      code: 'save_failed',
    }
  }

  // Block saves on a submitted draft — the wizard is in admin-review
  // state. A "Withdraw" click (spec line 51) transitions the row back
  // to 'draft' via a dedicated action (Slice 5); this action refuses
  // any further writes until then.
  if (existing && existing.status === 'submitted') {
    return {
      ok: false,
      error: 'Your submission is in review. Withdraw it first to make changes.',
      code: 'save_failed',
    }
  }

  // Shallow-merge at the top level: each step owns its own key
  // (step 1 → 'details', step 2 → 'curriculum', etc.), so overwriting
  // by key is safe and idempotent. The merge is one level deep — a
  // future slice that wants to mutate a nested field of `details` is
  // responsible for sending the full object for that key.
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
  // the new step. last_saved_step is the step that was just saved
  // (no MAX — the partner's last touch is what the right-rail shows).
  const existingStep =
    existing && typeof existing.current_step === 'number' && Number.isInteger(existing.current_step)
      ? existing.current_step
      : UPLOAD_FIRST_STEP
  const nextCurrentStep = Math.max(existingStep, parsed.step)
  const nextLastSavedStep = parsed.step

  // Upsert by user_id (UNIQUE). The trigger `set_updated_at` fires
  // automatically on UPDATE. We also clear `withdrawn_at` if the row
  // was previously withdrawn (the partner can re-enter editing after
  // a withdraw) — actually we don't have that column; withdraw returns
  // the row to status='draft' and resets last_saved_step.
  const { data: upserted, error: upsertError } = await supabase
    .from('partner_upload_drafts')
    .upsert(
      {
        user_id: user.id,
        current_step: nextCurrentStep,
        last_saved_step: nextLastSavedStep,
        status: 'draft',
        payload: mergedPayload,
      },
      { onConflict: 'user_id' },
    )
    .select('updated_at, current_step, last_saved_step')
    .single()

  if (upsertError || !upserted) {
    log.warn(
      { code: 'partner_upload_draft_upsert_failed', msg: upsertError?.message },
      'saveUploadDraft: draft upsert failed',
    )
    return {
      ok: false,
      error: 'Could not save your progress. Please try again.',
      code: 'save_failed',
    }
  }

  // Audit log — never includes the payload body. The Step 1 payload
  // includes `title` + `long_description` + `category_id` + `kind` —
  // none are PII by themselves but `long_description` may contain
  // personal narrative; recording the field-set (not the body) keeps
  // the audit trail honest without leaking user content. Future slices
  // will include Bunny storage paths + third-party IDs that must
  // never be logged.
  const hdrs = await headers()
  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email ?? '',
    action: 'partner_upload.step_saved',
    targetKind: 'partner_upload_drafts',
    targetId: user.id,
    metadata: {
      step: parsed.step,
      next_step: nextCurrentStep,
      fields_changed: Object.keys(stepPayload),
    },
    ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent') ?? null,
  })

  // Revalidate the upload page so a same-tab return renders the new
  // currentStep immediately. The page is `dynamic = 'force-dynamic'`
  // so this is belt-and-braces; included for cross-tab freshness too.
  revalidatePath('/partner/upload')

  const savedAt =
    typeof upserted.updated_at === 'string' ? upserted.updated_at : new Date().toISOString()
  const currentStep =
    typeof upserted.current_step === 'number' && Number.isInteger(upserted.current_step)
      ? upserted.current_step
      : nextCurrentStep
  const lastSavedStep =
    typeof upserted.last_saved_step === 'number' && Number.isInteger(upserted.last_saved_step)
      ? upserted.last_saved_step
      : nextLastSavedStep

  return { ok: true, savedAt, currentStep, lastSavedStep }
}
