// reviewModerationActions.ts — admin-only actions for the moderation
// queue: approve / reject reviews + unflag products.

'use server'

import 'server-only'
import { z } from 'zod'
import { getSessionUser } from '@foundations/auth/guards'
import { requireRole } from '@foundations/auth/guards'
import { getServiceSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'admin.reviewModerationActions' })

const ReviewStatusSchema = z.object({
  reviewId: z.number().int().positive(),
  action: z.enum(['approve', 'reject', 'clear_flag']),
})

const ProductFlagSchema = z.object({
  productId: z.number().int().positive(),
  newStatus: z.enum(['published', 'draft', 'archived']),
})

export type ReviewModerationResult =
  | { ok: true; reviewId: number; status: 'approved' | 'rejected' | 'flag_cleared' }
  | { ok: false; code: string; error: string }

export async function moderateReviewAction(input: {
  reviewId: number
  action: 'approve' | 'reject' | 'clear_flag'
}): Promise<ReviewModerationResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, code: 'not_authorized', error: 'Sign in.' }
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return { ok: false, code: 'not_authorized', error: 'Admin required.' }
  }
  const parsed = ReviewStatusSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'bad_input', error: 'Invalid request.' }

  const service = getServiceSupabase()

  // Determine the new status + flag fields.
  const update: Record<string, unknown> = {}
  let resultStatus: 'approved' | 'rejected' | 'flag_cleared'
  if (parsed.data.action === 'approve') {
    update.status = 'approved'
    update.flagged_reason = null
    update.flagged_by_user_id = null
    resultStatus = 'approved'
  } else if (parsed.data.action === 'reject') {
    update.status = 'rejected'
    update.flagged_reason = null
    update.flagged_by_user_id = null
    resultStatus = 'rejected'
  } else {
    // clear_flag: keep status as-is, just drop the flag
    update.flagged_reason = null
    update.flagged_by_user_id = null
    resultStatus = 'flag_cleared'
  }

  const { error } = await service
    .from('reviews')
    .update(update as never)
    .eq('id', parsed.data.reviewId)

  if (error) {
    log.warn({ code: 'moderate_review_failed', msg: error.message }, 'moderateReview: update failed')
    return { ok: false, code: 'unknown', error: 'Could not update review.' }
  }

  await service.from('admin_audit_log').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: `review_moderation_${parsed.data.action}`,
    target_kind: 'reviews',
    target_id: String(parsed.data.reviewId),
  } as never)

  return { ok: true, reviewId: parsed.data.reviewId, status: resultStatus }
}

export async function changeProductStatusAction(input: {
  productId: number
  newStatus: 'published' | 'draft' | 'archived'
}): Promise<ReviewModerationResult> {
  const user = await getSessionUser()
  if (!user) return { ok: false, code: 'not_authorized', error: 'Sign in.' }
  try {
    await requireRole(['admin', 'super_admin'])
  } catch {
    return { ok: false, code: 'not_authorized', error: 'Admin required.' }
  }
  const parsed = ProductFlagSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'bad_input', error: 'Invalid request.' }

  const service = getServiceSupabase()
  const { error } = await service
    .from('products')
    .update({ status: parsed.data.newStatus } as never)
    .eq('id', parsed.data.productId)

  if (error) {
    log.warn({ code: 'change_product_status_failed', msg: error.message }, 'changeProductStatus: update failed')
    return { ok: false, code: 'unknown', error: 'Could not update product.' }
  }

  await service.from('admin_audit_log').insert({
    actor_id: user.id,
    actor_email: user.email,
    action: 'product_status_changed',
    target_kind: 'products',
    target_id: String(parsed.data.productId),
    metadata: { new_status: parsed.data.newStatus },
  } as never)

  return { ok: true, reviewId: parsed.data.productId, status: 'flag_cleared' }
}
