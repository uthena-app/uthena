import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'

export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'paid'
  | 'fulfilled'
  | 'refunded'
  | 'partially_refunded'
  | 'failed'
  | 'canceled'
  | 'fraudulent'

export type OrderRow = {
  id: number
  created_at: string
  status: OrderStatus
  total_cents: number
  currency: string
  item_count: number
}

export type OrderListFilters = {
  status?: OrderStatus[]
  from?: string
  to?: string
  page: number
  pageSize: number
}

export type OrderListResult = {
  rows: OrderRow[]
  totalCount: number
  page: number
  pageSize: number
  pageCount: number
}

/** Read the signed-in user's orders, paginated, with optional
 *  filters. Server-only. RLS on `orders` limits to the user's
 *  own rows. */
export async function getMyOrders(filters: OrderListFilters): Promise<OrderListResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { rows: [], totalCount: 0, page: 1, pageSize: filters.pageSize, pageCount: 0 }
  }

  const page = Math.max(1, filters.page)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let q = supabase
    .from('orders')
    .select(
      'id, created_at, status, total_cents, currency, order_items!order_items_order_id_fkey(id)',
      { count: 'exact' },
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (filters.status && filters.status.length > 0) {
    q = q.in('status', filters.status as string[])
  }
  if (filters.from) {
    q = q.gte('created_at', `${filters.from}T00:00:00Z`)
  }
  if (filters.to) {
    q = q.lte('created_at', `${filters.to}T23:59:59Z`)
  }

  const { data, count, error } = await q
  if (error) {
    return { rows: [], totalCount: 0, page, pageSize, pageCount: 0 }
  }

  const rows: OrderRow[] = (data ?? []).map((o) => {
    const items = (o as unknown as { order_items: { id: number }[] }).order_items ?? []
    return {
      id: o.id as number,
      created_at: o.created_at as string,
      status: o.status as OrderStatus,
      total_cents: o.total_cents as number,
      currency: o.currency as string,
      item_count: items.length,
    }
  })

  return {
    rows,
    totalCount: count ?? 0,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  }
}
