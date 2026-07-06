import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'partner-portal.categories' })

export type CategoryOption = {
  id: number
  name: string
  slug: string
  display_order: number
}

/** List every category for the Settings-tab category dropdown.
 *  Reads through the `categories_public_read` policy (true for
 *  everyone, including anon). The partner sees every category —
 *  category choice is a product-level decision, not a partner-
 *  scoped one.
 *
 *  Sorted by `display_order` (then `name` for stability when two
 *  categories share an order — e.g. the 17 seeded root categories
 *  all have distinct orders, but custom categories added later
 *  might collide).
 *
 *  Returns an empty array on error (logged warn). The form handles
 *  the empty state with a friendly "no categories available"
 *  message — never blocks the page render.
 */
export async function listPartnerCategories(): Promise<CategoryOption[]> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, display_order')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    log.warn({ code: 'partner_categories_read_failed', msg: error.message }, 'partner categories list read failed')
    return []
  }
  return (data ?? []) as CategoryOption[]
}