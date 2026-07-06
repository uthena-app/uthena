// toggleBookmark.ts — add/remove a per-lesson bookmark.
//
// The bookmark has an optional free-form note (≤ 1000 chars).
// Idempotent: toggling the same state is a no-op write.

'use server'

import 'server-only'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'lms.toggleBookmark' })

const InputSchema = z.object({
  lessonId: z.number().int().positive(),
  productId: z.number().int().positive(),
  note: z.string().max(1000).optional(),
})

export type ToggleBookmarkInput = z.infer<typeof InputSchema>

export type ToggleBookmarkResult =
  | { ok: true; bookmarked: boolean }
  | { ok: false; code: ToggleBookmarkErrorCode; error: string }

export type ToggleBookmarkErrorCode =
  | 'not_authenticated'
  | 'not_owner'
  | 'bad_input'
  | 'unknown'

export async function toggleBookmarkAction(
  input: ToggleBookmarkInput,
): Promise<ToggleBookmarkResult> {
  const user = await getSessionUser()
  if (!user) {
    return { ok: false, code: 'not_authenticated', error: 'Sign in to bookmark lessons.' }
  }

  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    log.warn(
      { code: 'bookmark_bad_input', issues: parsed.error.issues.length },
      'toggleBookmark: invalid input',
    )
    return { ok: false, code: 'bad_input', error: 'Invalid request.' }
  }
  const { lessonId, productId, note } = parsed.data

  const supabase = await getServerSupabase()

  // Access check (same shape as progress).
  const { data: accessCheck, error: accessErr } = await supabase.rpc(
    'user_accessible_products',
    { p_user_id: user.id, p_product_ids: [productId] },
  )
  if (accessErr) {
    return { ok: false, code: 'unknown', error: 'Could not verify access. Try again.' }
  }
  if (
    !(accessCheck as Array<{ product_id: number }> | null)?.some?.((p) => p.product_id === productId)
  ) {
    return { ok: false, code: 'not_owner', error: 'You do not have access to this course.' }
  }

  // Look up the current row to decide INSERT vs DELETE.
  const { data: existing, error: existingErr } = await supabase
    .from('bookmarks')
    .select('id')
    .eq('user_id', user.id)
    .eq('lesson_id', lessonId)
    .maybeSingle()

  if (existingErr) {
    log.warn(
      { code: 'bookmark_lookup_failed', msg: existingErr.message },
      'toggleBookmark: lookup failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not check bookmarks. Try again.' }
  }

  if (existing) {
    const { error: delErr } = await supabase
      .from('bookmarks')
      .delete()
      .eq('id', (existing as { id: number }).id)
    if (delErr) {
      log.warn(
        { code: 'bookmark_delete_failed', msg: delErr.message },
        'toggleBookmark: delete failed',
      )
      return { ok: false, code: 'unknown', error: 'Could not remove bookmark.' }
    }
    return { ok: true, bookmarked: false }
  }

  const { error: insErr } = await supabase.from('bookmarks').insert({
    user_id: user.id,
    lesson_id: lessonId,
    note: note ?? null,
  } as never)
  if (insErr) {
    log.warn(
      { code: 'bookmark_insert_failed', msg: insErr.message },
      'toggleBookmark: insert failed',
    )
    return { ok: false, code: 'unknown', error: 'Could not save bookmark.' }
  }
  return { ok: true, bookmarked: true }
}
