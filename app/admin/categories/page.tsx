// /admin/categories — the category tree management page. Server
// component. Auth-gated by the parent /admin layout (which calls
// requireRole). Fetches the tree, stats, and history in parallel
// and hands them to the client composition root.

import {
  getCategoryTree,
  getCategoryStats,
  getCategoryHistory,
  CategoriesClient,
  CategoryStatsCards,
  CategoryHistoryPanel,
} from '@features/admin/categories'
import { AdminShell } from '@features/admin'
import { sensitivePageMetadata } from '@foundations/metadata'

// P0.21 — `noindex` (also inherited from /admin layout).
export const metadata = sensitivePageMetadata({
  title: 'Categories · Admin',
  description: 'Admin categories management.',
  path: '/admin/categories',
})

type SearchParams = { q?: string; hideEmpty?: string }

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const initialQuery = (sp.q ?? '').toString()
  const initialHideEmpty = sp.hideEmpty === '1'

  // Fetch tree, stats, and history in parallel.
  const [tree, stats, history] = await Promise.all([
    getCategoryTree(),
    getCategoryStats(),
    getCategoryHistory(20),
  ])

  return (
    <AdminShell title="Categories">
      <CategoryStatsCards stats={stats} />
      <CategoriesClient
        nodes={tree}
        initialQuery={initialQuery}
        initialHideEmpty={initialHideEmpty}
      />
      <CategoryHistoryPanel entries={history} />
    </AdminShell>
  )
}
