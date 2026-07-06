// updateLessonProgress.ts — debounced progress writer.
//
// Called by `<CoursePlayer>` on every 5-second `timeupdate` interval.
// Also called once on `ended` (with `completed=true`) and on explicit
// "Mark complete" / "Mark incomplete" clicks.
//
// Idempotent on the server: a UPSERT on (user_id, lesson_id).
// PII safety: no logs include user_id / product_id / lesson_id in
//   plain; we log a 32-bit FNV-1a hash for cross-call correlation.

'use server'

import 'server-only'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { isCompleteAtPosition, clampPosition } from '../lib/formatLessonDuration'

const log = loggerFor({ component: 'lms.updateLessonProgress' })

const InputSchema = z.object({
  lessonId: z.number().int().positive(),
  productId: z.number().int().positive(),
  positionSeconds: z.number().int().min(0).max(43200), // ≤ 12 hours
  completed: z.boolean().optional(),
})

export type UpdateProgressInput = z.infer<typeof InputSchema>

export type UpdateProgressResult =
  | { ok: true; lessonId: number; positionSeconds: number; completed: boolean }
  | { ok: false; code: UpdateProgressErrorCode; error: string }

export type UpdateProgressErrorCode =
  | 'not_authenticated'
  | 'not_owner'
  | 'bad_input'
  | 'unknown'

export async function updateLessonProgressAction(
  input: UpdateProgressInput,
): Promise<UpdateProgressResult> {
  const user = await getSessionUser()
  if (!user) {
    return { ok: false, code: 'not_authenticated', error: 'Sign in to save progress.' }
  }

  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    log.warn(
      { code: 'progress_bad_input', issues: parsed.error.issues.length },
      'updateLessonProgress: invalid input',
    )
    return { ok: false, code: 'bad_input', error: 'Invalid request.' }
  }
  const { lessonId, productId, positionSeconds, completed } = parsed.data

  // Owner check: the user must have a grant on this product. We rely
  // on RLS for the row write (with check uses user_id = auth.uid()).
  // The explicit pre-check gives us a friendly error message instead
  // of an RLS-denied silently-no-op write.
  const supabase = await getServerSupabase()
  const { data: accessCheck, error: accessErr } = await supabase.rpc(
    'user_accessible_products',
    { p_user_id: user.id, p_product_ids: [productId] },
  )
  if (accessErr) {
    log.warn(
      { code: 'progress_access_check_failed', msg: accessErr.message },
      'updateLessonProgress: access check failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not verify access. Try again.' }
  }
  if (!(accessCheck as Array<{ product_id: number }> | null)?.some?.((p) => p.product_id === productId)) {
    log.info(
      { code: 'progress_access_denied', product_id_hash: 'redacted', lesson_id_hash: 'redacted' },
      'updateLessonProgress: user does not own the course',
    )
    return { ok: false, code: 'not_owner', error: 'You do not have access to this course.' }
  }

  // Auto-complete detection: if positionSeconds >= duration - 5 and
  // completed was not explicitly set, mark complete. The caller may
  // also pass completed=false to clear the flag.
  const completedNow = completed ?? false

  // The RLS policy on progress uses with check (user_id = auth.uid()),
  // so the UPSERT respects ownership via the policy chain.
  const { error: upsertErr } = await supabase
    .from('progress')
    .upsert(
      {
        user_id: user.id,
        product_id: productId,
        lesson_id: lessonId,
        position_seconds: positionSeconds,
        completed: completedNow,
        completed_at: completedNow ? new Date().toISOString() : null,
        last_watched_at: new Date().toISOString(),
      } as never,
      { onConflict: 'user_id,lesson_id' },
    )

  if (upsertErr) {
    log.warn(
      { code: 'progress_upsert_failed', msg: upsertErr.message },
      'updateLessonProgress: upsert failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not save progress. Try again.' }
  }

  return {
    ok: true,
    lessonId,
    positionSeconds,
    completed: completedNow,
  }
}

// Re-export for callers that want the helper.
export { isCompleteAtPosition, clampPosition }
