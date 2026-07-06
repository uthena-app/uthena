// Types for the admin categories feature. These are the shapes the
// queries return and the components consume. They are local to the
// admin feature because the rest of the app doesn't need them — the
// storefront renders a slimmer view from `getActiveCategories` in the
// catalog feature.

/** A category as it appears in the admin tree. */
export type CategoryNode = {
  id: number
  slug: string
  name: string
  description: string | null
  parent_id: number | null
  display_order: number
  product_count_cache: number
  created_at: string
  /** Sales in the last 30 days (count of order_items in this category). */
  sales_30d: number
  /** Revenue in the last 30 days (sum of unit_price_cents - refunded_cents,
   *  in cents). */
  revenue_30d: number
  /** Children of this node (empty array for leaves). Max depth = 2. */
  children: CategoryNode[]
}

/** Flat lookup table for the tree (id → node). */
export type CategoryLookup = Record<number, CategoryNode>

/** Top-level stats for the page header. */
export type CategoryStats = {
  total: number
  topLevel: number
  sub: number
  totalProducts: number
  totalRevenue30d: number
}

/** Audit-log entry shown in the history panel. Maps the live
 *  `04-platform/migrations/0001_initial.sql` columns to a slim
 *  shape for the UI. */
export type CategoryAuditEntry = {
  id: number
  action: string
  /** The admin's email (snapshotted in `actor_email` at write time). */
  actor_email: string
  /** The admin's user_id (snapshotted in `actor_id`). */
  actor_id: string
  target_id: string | null
  before: unknown
  after: unknown
  /** ISO timestamp; the live column is `created_at`. */
  created_at: string
}

/** Type for the categories page's tree (the props of CategoryTree). */
export type CategoryTreeProps = {
  nodes: CategoryNode[]
}

/** Form values for the AddCategory modal. */
export type AddCategoryFormValues = {
  name: string
  slug: string
  description: string
  parent_id: number | null
}

/** Form values for the EditCategory modal. */
export type EditCategoryFormValues = {
  id: number
  name: string
  slug: string
  description: string
  parent_id: number | null
  display_order: number
}

/** A single option in the "parent" select. */
export type ParentOption = {
  id: number
  name: string
  slug: string
}
