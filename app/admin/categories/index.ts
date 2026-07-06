// Re-exports of the categories feature for the page route. The page
// itself imports from `@features/admin/categories` directly; this
// `index.ts` is a convenience barrel for any code that prefers
// relative imports within the same route folder.

export {
  getCategoryTree,
  getCategoryStats,
  getCategoryHistory,
  CategoryStatsCards,
  CategoryTree,
  CategoriesClient,
  CategoryHistoryPanel,
} from '@features/admin/categories'
