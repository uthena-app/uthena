import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import type { PartnerProfile } from './getMyPartnerProfile'

const log = loggerFor({ component: 'partner-portal.courseDetail' })

/** Shape returned by `getMyCourseDetail`. All fields needed by the
 *  P12.6 partner course detail page header + tabs. The Curriculum
 *  tab (slice later) will join in product_modules + product_lessons
 *  here; for Slice 1 we only ship the Settings tab and the header. */
export type PartnerCourseDetail = {
  id: number
  slug: string
  title: string
  short_description: string
  long_description: unknown // TipTap JSONB; consumed by renderTipTap on the storefront, by parseTipTapDoc defensively here
  kind: 'video_course' | 'ebook' | 'template_pack' | 'audio_course' | 'bundle' | 'asset_pack'
  status: 'draft' | 'in_review' | 'published' | 'unpublished' | 'archived'
  category_id: number
  category_name: string
  category_slug: string
  thumbnail_url: string | null
  preview_video_url: string | null
  total_duration_seconds: number
  total_lesson_count: number
  created_at: string
  updated_at: string
}

/** Read the current partner's course by id. Returns `null` if:
 *    - the caller is not a partner
 *    - the product doesn't exist
 *    - the product is owned by a different partner (RLS hides it,
 *      so we can't distinguish from "doesn't exist" — same UX)
 *
 *  RLS does the heavy lifting: `products_partner_read_own` (0001)
 *  restricts the read to `partner_id = current_partner_id()`. A
 *  wrong-id request looks identical to anon from the partner's POV.
 *  The page translates `null` to a 404 (notFound()) so we don't
 *  leak which ids exist.
 *
 *  Joins `categories` for the Settings tab dropdown display label.
 *  Categories is public-read (`categories_public_read`), so the
 *  join works without an extra RLS grant.
 */
export async function getMyCourseDetail(id: number): Promise<PartnerCourseDetail | null> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Resolve the partner row once for the explicit ownership check
  // (defense in depth alongside the RLS).
  const { data: partner } = await supabase
    .from('partners')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle<Pick<PartnerProfile, 'id'>>()
  if (!partner) return null

  const { data, error } = await supabase
    .from('products')
    .select(
      'id, slug, title, short_description, long_description, kind, status, category_id, thumbnail_url, preview_video_url, total_duration_seconds, total_lesson_count, partner_id, created_at, updated_at, categories!inner(name, slug)',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    log.warn({ code: 'partner_course_detail_read_failed', msg: error.message }, 'partner course detail read failed')
    return null
  }
  if (!data) return null

  // Belt-and-suspenders ownership check: even if RLS drifted, the
  // partner can never see another partner's product row.
  const row = data as unknown as PartnerCourseDetail & {
    partner_id: number
    categories: { name: string; slug: string }
  }
  if (row.partner_id !== partner.id) {
    log.warn(
      { code: 'partner_course_detail_ownership_mismatch', product_id: id },
      'partner requested a course they do not own (RLS should have hidden this)',
    )
    return null
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    short_description: row.short_description,
    long_description: row.long_description,
    kind: row.kind,
    status: row.status,
    category_id: row.category_id,
    category_name: row.categories.name,
    category_slug: row.categories.slug,
    thumbnail_url: row.thumbnail_url,
    preview_video_url: row.preview_video_url,
    total_duration_seconds: row.total_duration_seconds,
    total_lesson_count: row.total_lesson_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Read the most-recent self-audit row for this product's settings
 *  edits. Returns `null` if there are no prior edits (or if the
 *  audit log is unreachable). The course detail page renders a
 *  small "Last edit: Xm ago" strip at the top of the Settings tab.
 *
 *  Best-effort: a missing or unreadable row never blocks the page.
 *  Admin_audit_log is partitioned (0038); queries that don't pin
 *  a partition still hit the default partition — fine for the
 *  latest row lookup because the most recent edit is almost always
 *  in the current month's partition.
 */
export async function getMyCourseLastEdit(
  productId: number,
  partnerUserId: string,
): Promise<{ at: string; action: string; fieldsChanged: string[] } | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('created_at, action, metadata')
    .eq('actor_id', partnerUserId)
    .eq('target_kind', 'products')
    .eq('target_id', String(productId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    log.warn(
      { code: 'partner_course_last_edit_read_failed', msg: error.message },
      'partner course last-edit read failed (returning null)',
    )
    return null
  }
  if (!data) return null

  const row = data as unknown as {
    created_at: string
    action: string
    metadata: { fields_changed?: string[] } | null
  }
  return {
    at: row.created_at,
    action: row.action,
    fieldsChanged: Array.isArray(row.metadata?.fields_changed) ? row.metadata!.fields_changed! : [],
  }
}