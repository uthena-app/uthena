// addCategory.ts — server action. Creates a new category row,
// writes one admin_audit_log row, and revalidates the admin cache.
//
// Idempotency: the spec says (name, parent_id) is unique — the data
// model documents this even though the live migration does NOT yet
// have a UNIQUE constraint on (name, parent_id). We enforce the
// uniqueness at the application layer (pre-check before insert) and
// surface a typed `duplicate` error. (slug) is also globally unique
// in the live migration (`slug text not null unique`); we surface
// slug-collision as a separate fieldError.
//
// Cycle/depth validation: a new node's parent_id must reference an
// existing top-level node. The data model says max 2 levels; the
// add modal only offers top-level categories as parent options for
// sub-categories, so a depth-violation here would be a code-path
// bug. We validate anyway.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { AddCategoryInput } from '@foundations/data/schemas'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { writeAuditLog } from './writeAuditLog'

const log = loggerFor({ component: 'admin.categories.addCategory' })

export type AddCategoryResult =
  | { ok: true; id: number; slug: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function addCategoryAction(
  raw: FormData | Record<string, unknown>,
): Promise<AddCategoryResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  // Coerce empty parent_id to null.
  if (obj.parent_id === '' || obj.parent_id === undefined) obj.parent_id = null

  const parsed = AddCategoryInput.safeParse(obj)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }

  const user = await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  // Trim the name before the dup check + insert so "  AI  " and
  // "AI" are treated as the same name (the spec doesn't say
  // explicitly but UI users expect this).
  const nameTrimmed = parsed.data.name.trim()
  const slugTrimmed = parsed.data.slug.trim()

  // ---- Idempotency pre-checks (BEFORE the insert) ----------------------
  // The live migration enforces (slug) globally unique but does NOT
  // enforce (name, parent_id) unique yet. The data-model spec says
  // (name, parent_id) IS unique, so we pre-check at the application
  // layer. If we ever add a UNIQUE (name, parent_id) constraint in a
  // future migration, the pre-check still runs first and is the
  // friendlier path (typed error with fieldErrors) — the 23505 catch
  // is the belt-and-suspenders fallback.
  //
  // (a) Slug collision.
  const { data: slugClash, error: slugClashErr } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', slugTrimmed)
    .maybeSingle()
  if (slugClashErr) {
    log.warn(
      { code: 'cat_add_dup_query_failed', msg: slugClashErr.message },
      'addCategory: slug dup query failed',
    )
    return { ok: false, error: 'Could not check slug uniqueness. Try again.' }
  }
  if (slugClash) {
    return {
      ok: false,
      error: 'A category with that slug already exists.',
      fieldErrors: { slug: 'Slug must be unique.' },
    }
  }

  // (b) (name, parent_id) collision. We pass the parent_id value
  // directly to the .eq() filter, or .is('parent_id', null) when
  // creating a new top-level category.
  let nameClash: { id: number } | null = null
  if (parsed.data.parent_id == null) {
    const { data, error } = await supabase
      .from('categories')
      .select('id')
      .eq('name', nameTrimmed)
      .is('parent_id', null)
      .maybeSingle()
    if (error) {
      log.warn(
        { code: 'cat_add_dup_query_failed', msg: error.message },
        'addCategory: name dup query (top-level) failed',
      )
      return { ok: false, error: 'Could not check name uniqueness. Try again.' }
    }
    nameClash = data as { id: number } | null
  } else {
    const { data, error } = await supabase
      .from('categories')
      .select('id')
      .eq('name', nameTrimmed)
      .eq('parent_id', parsed.data.parent_id)
      .maybeSingle()
    if (error) {
      log.warn(
        { code: 'cat_add_dup_query_failed', msg: error.message },
        'addCategory: name dup query (sub-category) failed',
      )
      return { ok: false, error: 'Could not check name uniqueness. Try again.' }
    }
    nameClash = data as { id: number } | null
  }
  if (nameClash) {
    return {
      ok: false,
      error: 'duplicate',
      fieldErrors: {
        name:
          parsed.data.parent_id == null
            ? 'A top-level category with this name already exists.'
            : 'A sub-category with this name already exists under the selected parent.',
      },
    }
  }

  // ---- Validate parent (if provided) -----------------------------------
  if (parsed.data.parent_id != null) {
    const { data: parent, error: parentErr } = await supabase
      .from('categories')
      .select('id, parent_id')
      .eq('id', parsed.data.parent_id)
      .maybeSingle()
    if (parentErr) {
      return { ok: false, error: 'Could not validate parent category.' }
    }
    if (!parent) return { ok: false, error: 'Parent category not found.' }
    if ((parent as unknown as { parent_id: number | null }).parent_id != null) {
      return {
        ok: false,
        error: 'Sub-categories can only be added under a top-level category.',
        fieldErrors: { parent_id: 'Max depth is 2 levels.' },
      }
    }
  }

  // ---- Compute display_order: max+1 within the same parent -----------
  // For the seeded 17+5 rows this is fast; we fetch all rows for the
  // parent and take the max in JS. PostgREST doesn't have a unified
  // is(null) + eq pattern that composes cleanly, so we branch.
  let maxOrder = 0
  if (parsed.data.parent_id == null) {
    const { data: topRows, error: topErr } = await supabase
      .from('categories')
      .select('display_order')
      .is('parent_id', null)
    if (topErr) {
      log.warn(
        { code: 'cat_add_max_failed', msg: topErr.message },
        'addCategory: max display_order query failed',
      )
    }
    for (const r of (topRows ?? []) as Array<{ display_order: number }>) {
      if (r.display_order > maxOrder) maxOrder = r.display_order
    }
  } else {
    const { data: childRows, error: childErr } = await supabase
      .from('categories')
      .select('display_order')
      .eq('parent_id', parsed.data.parent_id)
    if (childErr) {
      log.warn(
        { code: 'cat_add_max_failed', msg: childErr.message },
        'addCategory: max display_order query failed',
      )
    }
    for (const r of (childRows ?? []) as Array<{ display_order: number }>) {
      if (r.display_order > maxOrder) maxOrder = r.display_order
    }
  }
  const nextOrder = maxOrder + 1

  // ---- Insert. Service-role so the audit log write stays in the same
  // logical operation. (categories_admin_write exists; either client
  // works for the insert. We use service for consistency with the
  // audit log writes.)
  const service = getServiceSupabase()
  const { data: inserted, error: insErr } = await service
    .from('categories')
    .insert({
      name: nameTrimmed,
      slug: slugTrimmed,
      description: parsed.data.description || null,
      parent_id: parsed.data.parent_id ?? null,
      display_order: nextOrder,
      product_count_cache: 0,
    })
    .select('id, slug, name, description, parent_id, display_order, product_count_cache, created_at')
    .single()

  if (insErr || !inserted) {
    // Belt-and-suspenders: if a race condition slipped past our pre-check
    // and a row landed between the SELECT and the INSERT, Postgres
    // returns 23505 (unique_violation). Map it to the same typed error.
    if (insErr?.code === '23505' || /duplicate key/i.test(insErr?.message ?? '')) {
      const detail = insErr?.message ?? ''
      const isSlug =
        detail.includes('slug') || detail.includes('categories_slug_key')
      return {
        ok: false,
        error: isSlug ? 'duplicate' : 'duplicate',
        fieldErrors: isSlug
          ? { slug: 'Slug must be unique.' }
          : {
              name:
                parsed.data.parent_id == null
                  ? 'A top-level category with this name already exists.'
                  : 'A sub-category with this name already exists under the selected parent.',
            },
      }
    }
    log.warn(
      { code: 'cat_add_failed', msg: insErr?.message },
      'addCategory: insert failed',
    )
    return { ok: false, error: 'Could not add category. Try again.' }
  }

  const newRow = inserted as unknown as {
    id: number
    slug: string
    name: string
    description: string | null
    parent_id: number | null
    display_order: number
    product_count_cache: number
    created_at: string
  }

  await writeAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    action: 'admin.category_create',
    targetTable: 'categories',
    targetId: newRow.id,
    before: null,
    after: newRow,
  })

  revalidatePath('/admin/categories')
  log.info(
    { code: 'cat_add_ok', category_id: newRow.id, admin_id: user.id },
    'addCategory ok',
  )
  return { ok: true, id: newRow.id, slug: newRow.slug }
}
