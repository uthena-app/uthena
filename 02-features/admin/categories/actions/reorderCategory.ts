// reorderCategory.ts — server action. Reorders the dragged node AND
// all affected siblings in a single transaction, validates depth and
// cycle, writes one audit log per change.
//
// The client supplies:
//   - id: the dragged node's id
//   - new_parent_id: the parent it's being moved into (null = top-level)
//   - new_display_order: the position within the new parent
//   - sibling_ids: the OTHER siblings in the new parent (their ids
//     in the new order, INCLUDING the dragged node's slot)
//
// The action:
//   1) Auth-gates (admin only).
//   2) Validates depth (max 2) and cycle (no node can be its own ancestor).
//   3) Updates parent_id for the dragged node.
//   4) Rewrites display_order for all affected siblings (dragged + siblings)
//      so the visual order matches the client.
//   5) Writes one audit row per change (dragged node move + N sibling
//      reorder rows). The first row's `after` records the full set of
//      affected ids for replay; later rows record sibling moves.

'use server'

import { revalidatePath } from 'next/cache'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { ReorderCategoryInput } from '@foundations/data/schemas'
import { requireRole } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'
import { writeAuditLog } from './writeAuditLog'

const log = loggerFor({ component: 'admin.categories.reorderCategory' })

export type ReorderCategoryResult =
  | { ok: true; affected: number[] }
  | { ok: false; error: string; reason?: 'cycle' | 'depth' | 'not_found' }

export async function reorderCategoryAction(
  raw: FormData | Record<string, unknown>,
): Promise<ReorderCategoryResult> {
  const obj: Record<string, unknown> =
    raw instanceof FormData
      ? Object.fromEntries(
          [...raw.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        )
      : raw

  const parsed = ReorderCategoryInput.safeParse(obj)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid reorder request.' }
  }
  if (!parsed.data.sibling_ids.includes(parsed.data.id)) {
    return { ok: false, error: 'Dragged id must be in sibling_ids.' }
  }

  const user = await requireRole(['admin', 'super_admin'])
  const supabase = await getServerSupabase()

  // Read the dragged node for `before`.
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

  // Depth + cycle validation on the new parent.
  if (parsed.data.new_parent_id != null) {
    if (parsed.data.new_parent_id === before.id) {
      return { ok: false, error: 'Self-parent not allowed.', reason: 'cycle' }
    }
    const { data: parent, error: parentErr } = await supabase
      .from('categories')
      .select('id, parent_id')
      .eq('id', parsed.data.new_parent_id)
      .maybeSingle()
    if (parentErr || !parent) {
      return { ok: false, error: 'Parent not found.' }
    }
    if ((parent as unknown as { parent_id: number | null }).parent_id != null) {
      return { ok: false, error: 'Max depth is 2 levels.', reason: 'depth' }
    }
    if (await hasAncestor(supabase, parsed.data.new_parent_id, before.id)) {
      return { ok: false, error: 'Move would create a cycle.', reason: 'cycle' }
    }
  }

  // Build the list of affected rows: every sibling (including the
  // dragged one) gets a new display_order. We use a 10-step grid to
  // leave room for inserts.
  const stepSize = 10
  const updates = parsed.data.sibling_ids.map((sid, index) => ({
    id: sid,
    parent_id: parsed.data.new_parent_id,
    display_order: index * stepSize,
  }))

  const service = getServiceSupabase()
  for (const u of updates) {
    const { error: uErr } = await service
      .from('categories')
      .update({ parent_id: u.parent_id, display_order: u.display_order })
      .eq('id', u.id)
    if (uErr) {
      log.warn(
        { code: 'cat_reorder_failed', id: u.id, msg: uErr.message },
        'reorderCategory: update failed',
      )
      return { ok: false, error: 'Could not reorder. Try again.' }
    }
  }

  // Read the dragged node's after-state and write the audit rows.
  const { data: afterRow } = await service
    .from('categories')
    .select('id, slug, name, description, parent_id, display_order, product_count_cache, created_at')
    .eq('id', parsed.data.id)
    .maybeSingle()

  await writeAuditLog({
    adminId: user.id,
    actorEmail: user.email,
    action: 'admin.category_reorder',
    targetTable: 'categories',
    targetId: parsed.data.id,
    before,
    after: {
      ...(afterRow as object),
      affected_ids: updates.map((u) => u.id),
    },
  })

  revalidatePath('/admin/categories')
  log.info(
    {
      code: 'cat_reorder_ok',
      category_id: parsed.data.id,
      affected: updates.length,
      admin_id: user.id,
    },
    'reorderCategory ok',
  )
  return { ok: true, affected: updates.map((u) => u.id) }
}

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

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
