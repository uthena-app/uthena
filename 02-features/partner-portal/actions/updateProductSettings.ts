'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import { tiptapDocToText } from '../lib/tiptapDocToText'

const log = loggerFor({ component: 'partner.courseDetail.settings' })

// Zod schema for the Settings tab save. Field-by-field constraints
// match `01-specs/pages/partner-courses-detail.md` §"Settings tab":
//   - title: text, max 200
//   - short_description: textarea, max 280
//   - long_description: textarea (markdown in the UI), max 10000
//     — stored as a minimal TipTap doc on save (see `buildLongDescriptionDoc`).
//   - category_id: select from categories
//   - kind: select from product_kind enum
//
// All fields required — the form always sends the full current state.
// This keeps the action idempotent (resubmitting the same payload is
// a no-op audit-wise) and avoids partial-update drift where a
// missing field could be interpreted as "leave unchanged".
const UpdateProductSettingsSchema = z.object({
  productId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long (max 200)'),
  shortDescription: z
    .string()
    .trim()
    .min(1, 'Short description is required')
    .max(280, 'Short description is too long (max 280)'),
  longDescription: z.string().max(10_000, 'Long description is too long (max 10,000 chars)').default(''),
  categoryId: z.coerce.number().int().positive('Pick a category'),
  kind: z.enum(['video_course', 'ebook', 'template_pack', 'audio_course', 'bundle', 'asset_pack']),
})

export type UpdateProductSettingsInput = z.infer<typeof UpdateProductSettingsSchema>

export type UpdateProductSettingsResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/** Wrap the plain-text `long_description` from the textarea into a
 *  minimal TipTap doc. The schema column is `jsonb` not text — the
 *  storefront's renderer (`renderTipTap`) expects a TipTap doc tree.
 *
 *  We wrap every non-empty line into its own paragraph node so the
 *  blank lines the partner types map to paragraph breaks, which is
 *  the closest plain-text-equivalent rendering. Empty input → empty
 *  doc (rendered as nothing on the storefront, same UX as the
 *  products.curriculum JSONB null-or-empty semantics).
 *
 *  Why a plain textarea (not TipTap) for v1: the spec says "markdown
 *  in v1, rich text in v2". The textarea ships the v1 surface;
 *  this wrapper is the minimal adapter that keeps the schema's
 *  TipTap invariant intact without forcing the partner to learn
 *  a rich text editor for a v1 metadata edit.
 */
function buildLongDescriptionDoc(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { type: 'doc', content: [] }
  }
  const paragraphs = trimmed.split(/\n\s*\n/).map((para) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: para.trim() }],
  }))
  return { type: 'doc', content: paragraphs }
}

/** Update the editable Settings fields on a product the partner
 *  owns. Audit-logs every change with masked before/after JSON
 *  (no PII risk on these fields — title / descriptions / category /
 *  kind are all public-facing product metadata).
 *
 *  Authorization:
 *    1. `requirePartner` (route-level guard)
 *    2. ownership check — RLS on `products_partner_write_own` (0001)
 *       already restricts to `partner_id = current_partner_id()`,
 *       so a wrong-id update returns 0 rows affected → we return
 *       an `ok: false` error rather than silently doing nothing.
 *
 *  Side effects:
 *    - writes one `admin_audit_log` row on success
 *    - revalidates `/partner/courses/[id]` so the header + Settings
 *      tab reflect the new values on next request
 *    - the public `/products/[slug]` page (ISR=60s) will see the
 *      new values on its next cache miss (up to 60s of staleness
 *      for anonymous visitors — acceptable, per spec §"Pricing
 *      change propagation")
 */
export async function updateProductSettingsAction(input: unknown): Promise<UpdateProductSettingsResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const parsed = UpdateProductSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  // Snapshot the row's editable fields so the audit log carries
  // a meaningful before/after diff. Runs in parallel with the
  // category existence check below. We include long_description
  // so we can compare and skip the audit row when nothing changed.
  const snapshotPromise = supabase
    .from('products')
    .select('id, title, short_description, long_description, kind, category_id')
    .eq('id', parsed.data.productId)
    .maybeSingle()

  // Validate the category exists + is selectable. The category
  // dropdown only lists real categories, but a stale page could
  // submit a deleted category id; we fail loud rather than letting
  // the FK violation surface as a 500.
  const categoryCheckPromise = supabase
    .from('categories')
    .select('id')
    .eq('id', parsed.data.categoryId)
    .maybeSingle()

  const [snapshotRes, categoryRes] = await Promise.all([snapshotPromise, categoryCheckPromise])

  if (snapshotRes.error || !snapshotRes.data) {
    log.warn(
      { code: 'partner_settings_snapshot_failed', msg: snapshotRes.error?.message, product_id: parsed.data.productId },
      'partner course settings snapshot failed (product not found or not owned)',
    )
    return { ok: false, error: 'Course not found.' }
  }

  if (categoryRes.error || !categoryRes.data) {
    return {
      ok: false,
      error: 'Pick a valid category.',
      fieldErrors: { categoryId: 'That category no longer exists.' },
    }
  }

  const { data, error } = await supabase
    .from('products')
    .update({
      title: parsed.data.title,
      short_description: parsed.data.shortDescription,
      long_description: buildLongDescriptionDoc(parsed.data.longDescription),
      kind: parsed.data.kind,
      category_id: parsed.data.categoryId,
    })
    .eq('id', parsed.data.productId)
    .select('id')

  // 0 rows updated = RLS blocked the write (the partner doesn't own
  // this product, or it doesn't exist). Surface as a 404-shaped
  // error — the page will treat it as "course not found."
  if (error) {
    log.warn(
      { code: 'partner_settings_update_failed', msg: error.message, product_id: parsed.data.productId },
      'partner course settings update failed',
    )
    return { ok: false, error: 'Could not save. Please try again.' }
  }
  if (!data || data.length === 0) {
    log.warn(
      { code: 'partner_settings_update_blocked', product_id: parsed.data.productId },
      'partner course settings update blocked (RLS or missing row)',
    )
    return { ok: false, error: 'Course not found.' }
  }

  // Audit log: write one row with the changed-fields diff. We log
  // the field-level diff (not the values themselves for descriptions,
  // which can be long) — the title and category_id/kind are short
  // enough to record verbatim.
  const before = snapshotRes.data as {
    title: string
    short_description: string
    long_description: unknown
    kind: string
    category_id: number
  }
  const fieldsChanged: string[] = []
  const diff: Record<string, { before: unknown; after: unknown }> = {}
  if (before.title !== parsed.data.title) {
    fieldsChanged.push('title')
    diff.title = { before: before.title, after: parsed.data.title }
  }
  if (before.short_description !== parsed.data.shortDescription) {
    fieldsChanged.push('short_description')
    diff.short_description = { before: before.short_description, after: parsed.data.shortDescription }
  }
  if (before.kind !== parsed.data.kind) {
    fieldsChanged.push('kind')
    diff.kind = { before: before.kind, after: parsed.data.kind }
  }
  if (before.category_id !== parsed.data.categoryId) {
    fieldsChanged.push('category_id')
    diff.category_id = { before: before.category_id, after: parsed.data.categoryId }
  }
  // long_description change detection — compare the existing TipTap
  // doc's text content against the new input. We don't store the
  // full new text (descriptions can be 10K chars); we note "changed"
  // + record the new char count for context. The existing doc's
  // text is reconstructed via the inverse of `buildLongDescriptionDoc`
  // (split paragraphs on `\n\n`, extract text nodes).
  const existingLongText = tiptapDocToText(before.long_description)
  const newLongText = parsed.data.longDescription.trim()
  if (existingLongText !== newLongText) {
    fieldsChanged.push('long_description')
    diff.long_description = {
      before: { length_chars: existingLongText.length },
      after: { length_chars: newLongText.length },
    }
  }

  if (fieldsChanged.length > 0) {
    try {
      await writeSelfAuditLog({
        userId: user.id,
        userEmail: user.email ?? '',
        action: 'product_settings_self_update',
        targetKind: 'products',
        targetId: String(parsed.data.productId),
        metadata: {
          target_table: 'products',
          fields_changed: fieldsChanged,
          diff,
        },
      })
    } catch (auditErr) {
      log.warn(
        { code: 'partner_settings_audit_failed', msg: (auditErr as Error).message },
        'partner course settings audit write failed (settings saved; audit dropped)',
      )
    }
  }

  revalidatePath(`/partner/courses/${parsed.data.productId}`)
  revalidatePath(`/products`) // storefront list page picks up the new title/category
  return { ok: true }
}