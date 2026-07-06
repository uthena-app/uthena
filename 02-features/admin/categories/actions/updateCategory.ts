// updateCategory.ts — server action. Updates an existing category
// row, with cycle + depth validation on parent_id. Writes one
// admin_audit_log row with before/after JSON.
//
// Cycle check: walking up from the new parent must not hit the node
// being updated. We do this with a recursive CTE via the service-role
// client. The DB has a trigger on display_order; we don't need to
// manage that here.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { UpdateCategoryInput } from '@foundations/data/schemas'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { writeAuditLog } from './writeAuditLog'

const log = loggerFor({ component: 'admin.categories.updateCategory' })

export type UpdateCategoryResult =
  | { ok: true; id: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function updateCategoryAction(
  raw: FormData | Record<string, unknown>,
): Promise<UpdateCategoryResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw
  if (obj.parent_id === '' || obj.parent_id === undefined) obj.parent_id = null

  const parsed = UpdateCategoryInput.safeParse(obj)
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

  // Read the existing row for `before`.
  const { data: existing, error: readErr } = await supabase
    .from('categories')
    .select('id, slug, name, description, parent_id, display_order, product_count_cache, created_at')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (readErr) return { ok: false, error: 'Could not read category.' }
  if (!existing) return { ok: false, error: 'Category not found.' }

  const before = existing as unknown as {
    id: number
    slug: string
    name: string
    description: string | null
    parent_id: number | null
    display_order: number
    product_count_cache: number
    created_at: string
  }

  // Cycle + depth check on parent_id.
  if (parsed.data.parent_id != null) {
    if (parsed.data.parent_id === before.id) {
      return {
        ok: false,
        error: 'A category cannot be its own parent.',
        fieldErrors: { parent_id: 'Self-parent is not allowed.' },
      }
    }
    // The new parent must exist and be a top-level node.
    const { data: parent, error: parentErr } = await supabase
      .from('categories')
      .select('id, parent_id')
      .eq('id', parsed.data.parent_id)
      .maybeSingle()
    if (parentErr || !parent) {
      return { ok: false, error: 'Parent category not found.' }
    }
    if ((parent as unknown as { parent_id: number | null }).parent_id != null) {
      return {
        ok: false,
        error: 'Sub-categories can only be placed under a top-level category.',
        fieldErrors: { parent_id: 'Max depth is 2 levels.' },
      }
    }
    // Cycle check: walk ancestors of new parent; if we ever see the
    // node being updated, we'd be creating a cycle.
    if (await hasAncestor(supabase, parsed.data.parent_id, before.id)) {
      return {
        ok: false,
        error: 'Cannot move: the selected parent is a descendant of this category.',
        fieldErrors: { parent_id: 'Move would create a cycle.' },
      }
    }
  }

  // Apply the update. Service-role client (we're writing through the
  // admin policy either way; service is the consistent choice for
  // mutation + audit log together).
  const service = getServiceSupabase()
  const { data: updated, error: updErr } = await service
    .from('categories')
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      parent_id: parsed.data.parent_id ?? null,
      display_order: parsed.data.display_order,
    })
    .eq('id', parsed.data.id)
    .select('id, slug, name, description, parent_id, display_order, product_count_cache, created_at')
    .single()

  if (updErr || !updated) {
    if (updErr?.code === '23505' || /duplicate key/i.test(updErr?.message ?? '')) {
      return {
        ok: false,
        error: 'A category with that slug already exists.',
        fieldErrors: { slug: 'Slug must be unique.' },
      }
    }
    log.warn(
      { code: 'cat_update_failed', msg: updErr?.message },
      'updateCategory: update failed',
    )
    return { ok: false, error: 'Could not update category. Try again.' }
  }

  await writeAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    action: 'admin.category_update',
    targetTable: 'categories',
    targetId: parsed.data.id,
    before,
    after: updated,
  })

  revalidatePath('/admin/categories')
  log.info(
    { code: 'cat_update_ok', category_id: parsed.data.id, admin_id: user.id },
    'updateCategory ok',
  )
  return { ok: true, id: parsed.data.id }
}

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/** Walk up the ancestor chain of `startId`; return true if `targetId` is
 *  an ancestor (i.e. would create a cycle if startId became a child of
 *  targetId). Bounded by the depth limit (max 2 in v1, so this is fast). */
async function hasAncestor(
  supabase: Supabase,
  startId: number,
  targetId: number,
): Promise<boolean> {
  let current: number | null = startId
  let hops = 0
  while (current != null && hops < 5) {
    if (current === targetId) return true
    const row = await fetchParentRow(supabase, current)
    if (!row) return false
    current = row.parent_id
    hops += 1
  }
  return false
}

async function fetchParentRow(
  supabase: Supabase,
  id: number,
): Promise<{ parent_id: number | null } | null> {
  const { data, error } = await supabase
    .from('categories')
    .select('parent_id')
    .eq('id', id)
    .maybeSingle()
  if (error) return null
  return (data ?? null) as unknown as { parent_id: number | null } | null
}
