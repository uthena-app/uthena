// getLibraryProgress.ts — bulk completion % per owned product.
//
// Powers the library progress bars (P15.9) and the Continue-watching
// rail readiness check (P15.10). Single round-trip; the SQL does the
// aggregation per (user, product) so we don't ship N round-trips for
// a user with N courses.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'lms.getLibraryProgress' })

export type CourseProgress = {
  productId: number
  totalLessons: number
  completedLessons: number
  /** Integer percent 0..100, floor-rounded. 0 when no lessons. */
  percent: number
  lastWatchedAt: string | null
  lastWatchedLessonId: number | null
}

export async function getLibraryProgress(userId?: string): Promise<Map<number, CourseProgress>> {
  const user = await getSessionUser()
  const effectiveUserId = userId ?? user?.id
  if (!effectiveUserId) return new Map()
  const supabase = await getServerSupabase()

  // One query: every progress row for this user, slim fields.
  // The aggregation happens in JS — for ≤ 5000 lessons per user this is
  // always faster than a Postgres GROUP BY round-trip + a JS join.
  const { data: rows, error } = await supabase
    .from('progress')
    .select('product_id, lesson_id, position_seconds, completed, last_watched_at')
    .eq('user_id', effectiveUserId)

  if (error) {
    log.warn(
      { code: 'library_progress_lookup_failed', msg: error.message },
      'getLibraryProgress: query failed',
    )
    return new Map()
  }

  // Total lesson count per product (one query — covers all products).
  const productIds = [...new Set((rows ?? []).map((r) => (r as { product_id: number }).product_id))]
  const lessonCounts = new Map<number, number>()
  if (productIds.length > 0) {
    const { data: lessons, error: lessonsErr } = await supabase
      .from('product_lessons')
      .select('product_id')
      .in('product_id', productIds)
    if (!lessonsErr && lessons) {
      for (const row of lessons as Array<{ product_id: number }>) {
        lessonCounts.set(row.product_id, (lessonCounts.get(row.product_id) ?? 0) + 1)
      }
    }
  }

  // Aggregate per product.
  const agg = new Map<number, CourseProgress>()
  for (const row of rows ?? []) {
    const r = row as {
      product_id: number
      lesson_id: number
      position_seconds: number
      completed: boolean
      last_watched_at: string | null
    }
    const existing = agg.get(r.product_id)
    const totalLessons = lessonCounts.get(r.product_id) ?? 0
    if (existing) {
      if (r.completed) existing.completedLessons += 1
      if (
        !existing.lastWatchedAt ||
        (r.last_watched_at && r.last_watched_at > existing.lastWatchedAt)
      ) {
        existing.lastWatchedAt = r.last_watched_at
        existing.lastWatchedLessonId = r.lesson_id
      }
    } else {
      agg.set(r.product_id, {
        productId: r.product_id,
        totalLessons,
        completedLessons: r.completed ? 1 : 0,
        percent: 0,
        lastWatchedAt: r.last_watched_at,
        lastWatchedLessonId: r.lesson_id,
      })
    }
  }

  // Compute % after totals are known.
  for (const entry of agg.values()) {
    entry.percent = entry.totalLessons > 0
      ? Math.floor((entry.completedLessons / entry.totalLessons) * 100)
      : 0
  }
  return agg
}

/**
 * Get the N most-recently-watched NOT-completed lessons for the user.
 * Powers the Continue-watching rail (P15.10).
 *
 * Single round-trip with a window of N rows. Sorted by `last_watched_at desc`.
 * Filters to NOT completed (a "Completed" lesson is not "Continue watching").
 */
export async function getContinueWatching(
  limit: number = 5,
): Promise<
  Array<{
    productId: number
    productTitle: string
    productSlug: string
    lessonId: number
    lessonTitle: string
    positionSeconds: number
    lastWatchedAt: string
  }>
> {
  const user = await getSessionUser()
  if (!user) return []
  const supabase = await getServerSupabase()

  // Fetch recent progress rows (not completed), join products + lessons.
  const { data: rows, error } = await supabase
    .from('progress')
    .select('product_id, lesson_id, position_seconds, last_watched_at')
    .eq('user_id', user.id)
    .eq('completed', false)
    .order('last_watched_at', { ascending: false })
    .limit(limit)

  if (error || !rows || rows.length === 0) return []

  // Hydrate product titles + slugs + lesson titles in 2 parallel reads.
  const productIds = [...new Set((rows as Array<{ product_id: number }>).map((r) => r.product_id))]
  const lessonIds = [...new Set((rows as Array<{ lesson_id: number }>).map((r) => r.lesson_id))]
  const [productsRes, lessonsRes] = await Promise.all([
    supabase.from('products').select('id, title, slug').in('id', productIds),
    supabase.from('product_lessons').select('id, title').in('id', lessonIds),
  ])
  const productMap = new Map<number, { title: string; slug: string }>()
  for (const p of productsRes.data ?? []) {
    productMap.set((p as { id: number }).id, {
      title: (p as { title: string }).title,
      slug: (p as { slug: string }).slug,
    })
  }
  const lessonMap = new Map<number, string>()
  for (const l of lessonsRes.data ?? []) {
    lessonMap.set((l as { id: number }).id, (l as { title: string }).title)
  }

  return (rows as Array<{
    product_id: number
    lesson_id: number
    position_seconds: number | null
    last_watched_at: string | null
  }>)
    .filter((r) => r.last_watched_at)
    .map((r) => {
      const product = productMap.get(r.product_id)
      return {
        productId: r.product_id,
        productTitle: product?.title ?? 'Untitled course',
        productSlug: product?.slug ?? '',
        lessonId: r.lesson_id,
        lessonTitle: lessonMap.get(r.lesson_id) ?? 'Untitled lesson',
        positionSeconds: r.position_seconds ?? 0,
        lastWatchedAt: r.last_watched_at ?? new Date().toISOString(),
      }
    })
    .filter((r) => r.productSlug.length > 0)
}
