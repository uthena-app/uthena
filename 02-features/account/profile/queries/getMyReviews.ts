import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

export type MyReview = {
  id: number
  product_id: number
  product_title: string
  product_slug: string | null
  rating: number
  title: string | null
  body: string
  status: 'pending' | 'published' | 'hidden' | 'flagged'
  created_at: string
  updated_at: string
}

export type ReviewableProduct = {
  product_id: number
  product_title: string
  product_slug: string | null
  partner_name: string | null
  grant_source: 'purchase' | 'subscription' | 'admin_grant' | 'free_promo'
  granted_at: string
  license: string | null
}

/** Read the signed-in user's reviews (any status). RLS allows
 *  self-read. */
export async function getMyReviews(): Promise<MyReview[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('reviews')
    .select('id, product_id, rating, title, body, status, created_at, updated_at, products(title, slug)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error || !data) return []
  return data.map((r) => {
    const p = (r as unknown as { products: { title: string; slug: string } | null }).products
    return {
      id: r.id as number,
      product_id: r.product_id as number,
      product_title: p?.title ?? '(removed product)',
      product_slug: p?.slug ?? null,
      rating: r.rating as number,
      title: (r.title as string | null) ?? null,
      body: r.body as string,
      status: r.status as MyReview['status'],
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    }
  })
}

/** Read the user's library grants that have NO existing review
 *  (any status). The user can review products they own. */
export async function getReviewableProducts(): Promise<ReviewableProduct[]> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: grants, error: grantsErr } = await supabase
    .from('library_grants')
    .select('product_id, source, license, created_at, products(title, slug, partners!products_partner_id_fkey(display_name))')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (grantsErr || !grants) return []

  const { data: reviews } = await supabase
    .from('reviews')
    .select('product_id')
    .eq('user_id', user.id)

  const reviewedIds = new Set((reviews ?? []).map((r) => r.product_id as number))

  return grants
    .filter((g) => !reviewedIds.has(g.product_id as number))
    .map((g) => {
      const p = (g as unknown as {
        products: { title: string; slug: string; partners: { display_name: string } | null } | null
      }).products
      return {
        product_id: g.product_id as number,
        product_title: p?.title ?? '(removed product)',
        product_slug: p?.slug ?? null,
        partner_name: p?.partners?.display_name ?? null,
        grant_source: g.source as ReviewableProduct['grant_source'],
        granted_at: g.created_at as string,
        license: (g.license as string | null) ?? null,
      }
    })
}
