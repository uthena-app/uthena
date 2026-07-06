'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@foundations/data/supabase'
import { CreateReviewInput, UpdateReviewInput, DeleteReviewInput } from '@foundations/data/schemas'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'account.reviews' })

export type ReviewSubmitResult =
  | { ok: true; reviewId: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function createReviewAction(input: unknown): Promise<ReviewSubmitResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // camelCase → snake_case field rename so the shared schema (which
  // mirrors the DB column names) accepts the caller's payload.
  const raw = input as Record<string, unknown> | undefined
  const mapped = {
    productId: raw?.productId ?? raw?.product_id,
    rating: raw?.rating,
    title: raw?.title ?? '',
    body: raw?.body,
  }
  const parsed = CreateReviewInput.safeParse(mapped)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  // Verify the user has an active grant for this product (server-side
  // enforcement of the "you can only review products you own" rule).
  const { count: grantCount } = await supabase
    .from('library_grants')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('product_id', parsed.data.productId)
    .is('revoked_at', null)
  if ((grantCount ?? 0) === 0) {
    return { ok: false, error: 'You can only review products you own.' }
  }

  // The unique (user_id, product_id) constraint enforces one
  // review per product. If the user has already reviewed, the
  // insert fails with a 23505; we map it to a typed error.
  const { data: insertRes, error: insertErr } = await supabase
    .from('reviews')
    .insert({
      user_id: user.id,
      product_id: parsed.data.productId,
      rating: parsed.data.rating,
      title: parsed.data.title === '' ? null : parsed.data.title,
      body: parsed.data.body,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertErr || !insertRes) {
    if (insertErr?.code === '23505') {
      return {
        ok: false,
        error: "You've already reviewed this product. Edit your existing review instead.",
      }
    }
    log.warn({ code: 'review_insert_failed', msg: insertErr?.message }, 'review insert failed')
    return { ok: false, error: 'Could not submit your review. Please try again.' }
  }

  log.info(
    { review_id: (insertRes as { id: number }).id, product_id: parsed.data.productId },
    'review submitted (confirmation email not yet wired — PH18)',
  )

  revalidatePath('/account/reviews')
  return { ok: true, reviewId: (insertRes as { id: number }).id }
}

export type ReviewUpdateResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function updateReviewAction(input: unknown): Promise<ReviewUpdateResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const parsed = UpdateReviewInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const { error } = await supabase
    .from('reviews')
    .update({
      rating: parsed.data.rating,
      title: parsed.data.title === '' ? null : parsed.data.title,
      body: parsed.data.body,
      // Re-moderate on edit; admin re-reviews.
      status: 'pending',
    })
    .eq('id', parsed.data.reviewId)
    .eq('user_id', user.id)

  if (error) {
    log.warn({ code: 'review_update_failed', msg: error.message }, 'review update failed')
    return { ok: false, error: 'Could not save your changes. Please try again.' }
  }

  revalidatePath('/account/reviews')
  return { ok: true }
}

export async function deleteReviewAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const parsed = DeleteReviewInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid request.' }

  // Soft-delete: status → 'hidden' (the schema has no 'rejected' so
  // we use 'hidden' to mark user-deleted). Body is wiped. Row
  // preserved for audit. The unique (user_id, product_id)
  // constraint blocks resubmission for the same product.
  const { error } = await supabase
    .from('reviews')
    .update({ status: 'hidden', body: '[deleted]' })
    .eq('id', parsed.data.reviewId)
    .eq('user_id', user.id)

  if (error) {
    log.warn({ code: 'review_delete_failed', msg: error.message }, 'review soft-delete failed')
    return { ok: false, error: 'Could not delete your review. Please try again.' }
  }

  revalidatePath('/account/reviews')
  return { ok: true }
}
