// deleteCategory.ts — server action. Deletes a category if (and only
// if) it has zero products and zero sub-categories. Writes one
// admin_audit_log row with `before` JSON.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { DeleteCategoryInput } from '@foundations/data/schemas'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { writeAuditLog } from './writeAuditLog'

const log = loggerFor({ component: 'admin.categories.deleteCategory' })

export type DeleteCategoryResult =
  | { ok: true; id: number }
  | { ok: false; error: string; reason?: 'has_products' | 'has_children' | 'not_found' }

export async function deleteCategoryAction(
  raw: FormData | Record<string, unknown>,
): Promise<DeleteCategoryResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = DeleteCategoryInput.safeParse(obj)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid category id.' }
  }

  const user = await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  // Read the row + impact counts.
  const { data: row, error: readErr } = await supabase
    .from('categories')
    .select('id, slug, name, description, parent_id, display_order, product_count_cache, created_at')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (readErr) return { ok: false, error: 'Could not read category.' }
  if (!row) return { ok: false, error: 'Category not found.', reason: 'not_found' }

  const before = row as unknown as {
    id: number
    slug: string
    name: string
    description: string | null
    parent_id: number | null
    display_order: number
    product_count_cache: number
    created_at: string
  }

  if ((before.product_count_cache ?? 0) > 0) {
    return {
      ok: false,
      error: `Cannot delete: this category has ${before.product_count_cache} products.`,
      reason: 'has_products',
    }
  }

  // Has sub-categories?
  const { count: childCount, error: childErr } = await supabase
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', parsed.data.id)
  if (childErr) {
    return { ok: false, error: 'Could not check sub-categories.' }
  }
  if ((childCount ?? 0) > 0) {
    return {
      ok: false,
      error: `Cannot delete: this category has ${childCount} sub-categor${
        childCount === 1 ? 'y' : 'ies'
      }.`,
      reason: 'has_children',
    }
  }

  // Delete via service-role (consistent with the audit write).
  const service = getServiceSupabase()
  const { error: delErr } = await service.from('categories').delete().eq('id', parsed.data.id)
  if (delErr) {
    log.warn(
      { code: 'cat_delete_failed', msg: delErr.message },
      'deleteCategory: delete failed',
    )
    return { ok: false, error: 'Could not delete category. Try again.' }
  }

  await writeAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    action: 'admin.category_delete',
    targetTable: 'categories',
    targetId: parsed.data.id,
    before,
    after: null,
  })

  revalidatePath('/admin/categories')
  log.info(
    { code: 'cat_delete_ok', category_id: parsed.data.id, admin_id: user.id },
    'deleteCategory ok',
  )
  return { ok: true, id: parsed.data.id }
}
