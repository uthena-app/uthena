// Public surface of the admin/categories page. The app/admin/categories
// route imports from `@features/admin/categories` to consume these.

export { getCategoryTree } from './queries/getCategoryTree'
export { getCategoryStats } from './queries/getCategoryStats'
export { getCategoryHistory } from './queries/getCategoryHistory'

export { addCategoryAction } from './actions/addCategory'
export { updateCategoryAction } from './actions/updateCategory'
export { deleteCategoryAction } from './actions/deleteCategory'
export { reorderCategoryAction } from './actions/reorderCategory'
export { exportCategoriesAction } from './actions/exportCategories'

export { CategoryStatsCards } from './components/CategoryStatsCards'
export { CategoryTree } from './components/CategoryTree'
export { CategoriesClient } from './components/CategoriesClient'
export { CategoryHistoryPanel } from './components/CategoryHistoryPanel'

export type {
  CategoryNode,
  CategoryStats,
  CategoryAuditEntry,
  CategoryTreeProps,
  AddCategoryFormValues,
  EditCategoryFormValues,
  ParentOption,
} from './types'
