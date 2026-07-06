// exportCategories.ts — server action. Returns the full category
// tree as a JSON string for the admin to download. v1 has no signed
// URL or upload; the client triggers a download directly from the
// returned string.
//
// Idempotency: this is a read; no audit log row is written for the
// export action itself in v1 (the spec says "audit row" for the
// signed-URL variant, which v1 doesn't have).

'use server'

import { requireRole } from '@foundations/auth/guards'
import { getCategoryTree } from '../queries/getCategoryTree'

export type ExportCategoriesResult = { ok: true; json: string } | { ok: false; error: string }

export async function exportCategoriesAction(): Promise<ExportCategoriesResult> {
  await requireRole(['admin', 'super_admin'])
  const tree = await getCategoryTree()

  // Strip internal-only fields (sales_30d, revenue_30d) and return
  // a flat array of { id, slug, name, parent_slug, display_order,
  // product_count_cache } — the spec's "export tree" shape.
  const flat: Array<{
    id: number
    slug: string
    name: string
    parent_slug: string | null
    display_order: number
    product_count: number
  }> = []

  const parentSlugById = new Map<number, string>()
  function walk(
    nodes: ReadonlyArray<{
      id: number
      slug: string
      name: string
      parent_id: number | null
      display_order: number
      product_count_cache: number
      children: Array<{
        id: number
        slug: string
        name: string
        parent_id: number | null
        display_order: number
        product_count_cache: number
        children: unknown[]
      }>
    }>,
    parentSlug: string | null,
  ): void {
    for (const n of nodes) {
      parentSlugById.set(n.id, n.slug)
      flat.push({
        id: n.id,
        slug: n.slug,
        name: n.name,
        parent_slug: parentSlug,
        display_order: n.display_order,
        product_count: n.product_count_cache,
      })
      if (n.children.length > 0) walk(n.children as never, n.slug)
    }
  }
  walk(tree as never, null)

  const json = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      total: flat.length,
      categories: flat,
    },
    null,
    2,
  )
  return { ok: true, json }
}
