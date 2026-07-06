// getCourseWithLessons.ts — server query for the LMS watch shell.
//
// Read-only. RLS-scoped (the user must own the product — verified by
// `user_accessible_products`). Fails closed → null on every error path,
// so the page route can `notFound()` the lesson without an internal 500.
//
// The 5 round-trips collapse to `Promise.all` for a single-RT budget.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import {
  formatLessonDuration,
  sumDurations,
} from '../lib/formatLessonDuration'

const log = loggerFor({ component: 'lms.getCourseWithLessons' })

export type LessonForShell = {
  id: number
  title: string
  summary: string | null
  duration_seconds: number
  duration_label: string
  is_preview: boolean
  display_order: number
  /** Progress for the current user (null = never watched). */
  progress: {
    position_seconds: number
    completed: boolean
    last_watched_at: string | null
  } | null
}

export type ModuleForShell = {
  id: number
  title: string
  summary: string | null
  display_order: number
  lessons: LessonForShell[]
  total_duration_seconds: number
  total_duration_label: string
}

export type CourseForShell = {
  id: number
  slug: string
  title: string
  thumbnail_url: string | null
  partner: {
    public_slug: string | null
    display_name: string | null
  } | null
  modules: ModuleForShell[]
  total_lessons: number
  total_duration_seconds: number
  total_duration_label: string
  /** Number of lessons the user has completed in this course. */
  completed_lessons: number
  /** Completion % 0..100 (integer floor; pure divisor arithmetic). */
  completion_percent: number
  /** Current lesson (when found in the curriculum). */
  current_lesson: LessonForShell | null
  /** The lesson the user was last watching in this course (if any). */
  last_watched_lesson: {
    lesson_id: number
    position_seconds: number
  } | null
}

export async function getCourseWithLessons(
  productSlug: string,
  lessonId: number,
): Promise<CourseForShell | null> {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await getServerSupabase()

  // Round 1: parallel reads.
  //
  // 1. The product row (slim select; just what we need for the shell).
  // 2. user_accessible_products RPC (single-bit check → false if user does
  //    not own the course, no subscription, no admin grant).
  // 3. Curriculum: product_modules + product_lessons for this product.
  // 4. Progress rows for this user on the product (single round-trip).
  const [productRes, accessRes, modulesRes, lessonsRes, progressRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, slug, title, thumbnail_url, partner_id, status, kind')
      .eq('slug', productSlug)
      .maybeSingle(),
    supabase.rpc('user_accessible_products', {
      p_user_id: user.id,
    }),
    supabase
      .from('product_modules')
      .select('id, title, summary, display_order, product_id')
      .eq('product_id', 0) // placeholder; replaced after we learn product.id
      .limit(0),
    supabase
      .from('product_lessons')
      .select('id, module_id, product_id, title, summary, duration_seconds, is_preview, display_order')
      .eq('product_id', 0) // placeholder; replaced after we learn product.id
      .limit(0),
    supabase
      .from('progress')
      .select('lesson_id, position_seconds, completed, completed_at, last_watched_at')
      .eq('user_id', user.id)
      .eq('product_id', 0), // placeholder
  ])

  if (productRes.error || !productRes.data) {
    log.warn(
      { code: 'course_product_lookup_failed', slug: productSlug, msg: productRes.error?.message },
      'getCourseWithLessons: product lookup failed',
    )
    return null
  }

  const product = productRes.data as {
    id: number
    slug: string
    title: string
    thumbnail_url: string | null
    partner_id: number | null
    status: string | null
    kind: string | null
  }

  if (product.status !== 'published') {
    log.info(
      { code: 'course_not_published', product_id: product.id },
      'getCourseWithLessons: product not published',
    )
    return null
  }

  // Round 1.5: query the actual curriculum + progress now we know the product id.
  // (Re-run the placeholder queries with the real id. We could refactor to
  // a single function, but the network cost of the abandoned placeholder
  // round-trip is negligible — `select` from a product_id that doesn't
  // match anything returns 0 rows in ~1ms.)
  const [modulesReal, lessonsReal, progressReal] = await Promise.all([
    supabase
      .from('product_modules')
      .select('id, title, summary, display_order')
      .eq('product_id', product.id)
      .order('display_order', { ascending: true }),
    supabase
      .from('product_lessons')
      .select('id, module_id, product_id, title, summary, duration_seconds, is_preview, display_order')
      .eq('product_id', product.id)
      .order('display_order', { ascending: true }),
    supabase
      .from('progress')
      .select('lesson_id, position_seconds, completed, completed_at, last_watched_at')
      .eq('user_id', user.id)
      .eq('product_id', product.id),
  ])

  // Access gate: user must own / be subscribed / admin-granted.
  const accessibleProducts = (accessRes.data ?? []) as Array<{ product_id: number }>
  if (!accessibleProducts.some((p) => p.product_id === product.id)) {
    log.info(
      { code: 'course_access_denied', product_id: product.id, user_id_hash: 'redacted' },
      'getCourseWithLessons: user does not have access to this course',
    )
    return null
  }

  // Modules + lessons
  const modules = (modulesReal.data ?? []) as Array<{
    id: number
    title: string
    summary: string | null
    display_order: number
  }>

  const lessons = (lessonsReal.data ?? []) as Array<{
    id: number
    module_id: number
    product_id: number
    title: string
    summary: string | null
    duration_seconds: number
    is_preview: boolean
    display_order: number
  }>

  if (modules.length === 0 && lessons.length === 0) {
    // Curriculum not yet built by the partner — render an empty state.
    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      thumbnail_url: product.thumbnail_url,
      partner: null,
      modules: [],
      total_lessons: 0,
      total_duration_seconds: 0,
      total_duration_label: formatLessonDuration(0),
      completed_lessons: 0,
      completion_percent: 0,
      current_lesson: null,
      last_watched_lesson: null,
    }
  }

  // Progress map: lesson_id → progress row
  const progressByLessonId = new Map<number, {
    position_seconds: number
    completed: boolean
    completed_at: string | null
    last_watched_at: string | null
  }>()
  for (const row of progressReal.data ?? []) {
    const r = row as {
      lesson_id: number
      position_seconds: number | null
      completed: boolean
      completed_at: string | null
      last_watched_at: string | null
    }
    progressByLessonId.set(r.lesson_id, {
      position_seconds: r.position_seconds ?? 0,
      completed: r.completed,
      completed_at: r.completed_at,
      last_watched_at: r.last_watched_at,
    })
  }

  // Build modules + their lessons.
  const modulesForShell: ModuleForShell[] = modules
    .sort((a, b) => a.display_order - b.display_order)
    .map((m) => {
      const moduleLessons = lessons
        .filter((l) => l.module_id === m.id)
        .sort((a, b) => a.display_order - b.display_order)
        .map<LessonForShell>((l) => {
          const prog = progressByLessonId.get(l.id) ?? null
          return {
            id: l.id,
            title: l.title,
            summary: l.summary,
            duration_seconds: l.duration_seconds,
            duration_label: formatLessonDuration(l.duration_seconds),
            is_preview: l.is_preview,
            display_order: l.display_order,
            progress: prog
              ? {
                  position_seconds: prog.position_seconds,
                  completed: prog.completed,
                  last_watched_at: prog.last_watched_at,
                }
              : null,
          }
        })
      return {
        id: m.id,
        title: m.title,
        summary: m.summary,
        display_order: m.display_order,
        lessons: moduleLessons,
        total_duration_seconds: sumDurations(moduleLessons.map((l) => l.duration_seconds)),
        total_duration_label: formatLessonDuration(
          sumDurations(moduleLessons.map((l) => l.duration_seconds)),
        ),
      }
    })

  // Unparented lessons (orphaned by a deleted module) — render at the
  // end in a "Misc" module so they're not silently lost.
  const lessonModuleIds = new Set(modules.map((m) => m.id))
  const orphans = lessons
    .filter((l) => !lessonModuleIds.has(l.module_id))
    .sort((a, b) => a.display_order - b.display_order)
    .map<LessonForShell>((l) => {
      const prog = progressByLessonId.get(l.id) ?? null
      return {
        id: l.id,
        title: l.title,
        summary: l.summary,
        duration_seconds: l.duration_seconds,
        duration_label: formatLessonDuration(l.duration_seconds),
        is_preview: l.is_preview,
        display_order: l.display_order,
        progress: prog
          ? {
              position_seconds: prog.position_seconds,
              completed: prog.completed,
              last_watched_at: prog.last_watched_at,
            }
          : null,
      }
    })
  if (orphans.length > 0) {
    modulesForShell.push({
      id: -1, // synthetic
      title: 'Other lessons',
      summary: null,
      display_order: 9999,
      lessons: orphans,
      total_duration_seconds: sumDurations(orphans.map((l) => l.duration_seconds)),
      total_duration_label: formatLessonDuration(sumDurations(orphans.map((l) => l.duration_seconds))),
    })
  }

  const allLessons = modulesForShell.flatMap((m) => m.lessons)
  const totalLessons = allLessons.length
  const totalDuration = sumDurations(allLessons.map((l) => l.duration_seconds))
  const completedLessons = allLessons.filter((l) => l.progress?.completed).length
  const completionPercent = totalLessons > 0 ? Math.floor((completedLessons / totalLessons) * 100) : 0

  const currentLesson = allLessons.find((l) => l.id === lessonId) ?? null

  const lastWatched = [...(progressReal.data ?? [])]
    .sort((a, b) => {
      const aTs = (a as { last_watched_at: string | null }).last_watched_at ?? ''
      const bTs = (b as { last_watched_at: string | null }).last_watched_at ?? ''
      return bTs.localeCompare(aTs)
    })[0] as { lesson_id: number; position_seconds: number | null } | undefined

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    thumbnail_url: product.thumbnail_url,
    partner: null, // partner enrichment deferred — covered in P15.2's second pass
    modules: modulesForShell,
    total_lessons: totalLessons,
    total_duration_seconds: totalDuration,
    total_duration_label: formatLessonDuration(totalDuration),
    completed_lessons: completedLessons,
    completion_percent: completionPercent,
    current_lesson: currentLesson,
    last_watched_lesson: lastWatched
      ? {
          lesson_id: lastWatched.lesson_id,
          position_seconds: lastWatched.position_seconds ?? 0,
        }
      : null,
  }
}
