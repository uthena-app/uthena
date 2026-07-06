// CategoriesClient.tsx — the page's client-side composition root.
// Lifts filter state, derives the visible tree from the server-supplied
// nodes, and composes the toolbar (filter + add + export) and tree.

'use client'

import { useMemo, useState } from 'react'
import { CategoryTree } from './CategoryTree'
import { CategoryTreeFilter } from './CategoryTreeFilter'
import { AddCategoryButton } from './AddCategoryButton'
import { CategoryExportButton } from './CategoryExportButton'
import type { CategoryNode, ParentOption } from '../types'
import styles from './CategoriesClient.module.css'

function filterTree(
  nodes: CategoryNode[],
  query: string,
  hideEmpty: boolean,
): CategoryNode[] {
  // If a query is set, we keep the node if it (or any descendant) matches.
  // If hideEmpty is set, we drop leaves with product_count_cache=0 unless
  // a descendant is kept by the query.
  function matchesQuery(n: CategoryNode): boolean {
    if (!query) return true
    if (n.name.toLowerCase().includes(query)) return true
    if (n.slug.toLowerCase().includes(query)) return true
    return n.children.some(matchesQuery)
  }
  function isEmpty(n: CategoryNode): boolean {
    if ((n.product_count_cache ?? 0) > 0) return false
    return n.children.every(isEmpty)
  }
  function prune(n: CategoryNode): CategoryNode | null {
    const filteredChildren = n.children
      .map(prune)
      .filter((c): c is CategoryNode => c != null)
    const visible: CategoryNode = { ...n, children: filteredChildren }
    const q = matchesQuery(visible)
    const empty = isEmpty(visible)
    if (q && (!hideEmpty || !empty)) return visible
    if (filteredChildren.length > 0) return visible
    return null
  }
  return nodes.map(prune).filter((n): n is CategoryNode => n != null)
}

export function CategoriesClient({
  nodes,
  initialQuery,
  initialHideEmpty,
}: {
  nodes: CategoryNode[]
  initialQuery: string
  initialHideEmpty: boolean
}) {
  const [filter, setFilter] = useState({ query: initialQuery, hideEmpty: initialHideEmpty })

  const visibleNodes = useMemo(
    () => filterTree(nodes, filter.query, filter.hideEmpty),
    [nodes, filter],
  )

  const parents: ParentOption[] = useMemo(() => {
    // Top-level only (depth 0). The add modal parent-select is for
    // new sub-categories; new top-level categories use the main
    // "Add top-level category" button which doesn't open this list.
    return nodes
      .filter((n) => n.parent_id == null)
      .map((n) => ({ id: n.id, name: n.name, slug: n.slug }))
  }, [nodes])

  return (
    <>
      <div className={styles.toolbar}>
        <CategoryTreeFilter
          initialQuery={initialQuery}
          initialHideEmpty={initialHideEmpty}
          onChange={setFilter}
        />
        <div className={styles.actions}>
          <CategoryExportButton />
          <AddCategoryButton parents={parents} />
        </div>
      </div>
      <CategoryTree nodes={visibleNodes} parents={parents} />
    </>
  )
}
