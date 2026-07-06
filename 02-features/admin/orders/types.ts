// Types for the admin orders list page (P14.7).
//
// These shapes mirror the SECURITY DEFINER RPCs in
// `04-platform/migrations/0057_admin_orders_query.sql`. The PostgREST
// driver coerces bigint to string (defense-in-depth per P2.3 +
// `coerceBigint` pattern).
//
// Spec reference: `01-specs/pages/admin-orders.md`. The page is the
// admin's view of every order in the system — paginated, filterable,
// date-desc sort only in v1 (per spec OQ line 49 — column-header sort
// is v2).

import { z } from 'zod'
import { ORDER_STATUSES, type OrderStatus } from '@foundations/data/enums'

/** Mirrors the Postgres `order_status` enum for filter validation.
 *  Built as a fresh `as const` tuple (not re-exported from the
 *  foundation) so z.enum accepts it without the readonly-array
 *  mismatch — Zod 3's enum overload requires a non-readonly tuple. */
export const ORDER_FILTER_STATUSES = [
  'pending',
  'awaiting_payment',
  'paid',
  'fulfilled',
  'refunded',
  'partially_refunded',
  'failed',
  'canceled',
  'fraudulent',
] as const

export type OrderFilterStatus = (typeof ORDER_FILTER_STATUSES)[number] | OrderStatus

/** Stats row shape (5 cards, spec line 21). */
export type OrderStats = {
  total: number
  paid: number
  refunded: number
  paidRevenueMtdCents: number
  failed: number
}

export const EMPTY_ORDER_STATS: OrderStats = {
  total: 0,
  paid: 0,
  refunded: 0,
  paidRevenueMtdCents: 0,
  failed: 0,
}

/** One order row as returned by `get_admin_orders_list`. */
export type OrderRow = {
  order_id: number
  created_at: string
  customer_user_id: string
  customer_display_name: string
  customer_email: string
  status: OrderStatus
  total_cents: number
  subtotal_cents: number
  tax_cents: number
  currency: string
  items_count: number
  partner_share_cents: number
  affiliate_handle: string | null
  paid_at: string | null
  total_count: number
}

/**
 * Zod schema for the page-level URL filter bag. All fields optional;
 * unknown values fall back to "no filter" (graceful degradation).
 */
export const OrderFiltersSchema = z.object({
  /** One of the 9 `order_status` enum values. */
  status: z.enum(ORDER_FILTER_STATUSES).optional(),
  /** ISO date string YYYY-MM-DD — `orders.created_at >= from`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** ISO date string YYYY-MM-DD — `orders.created_at <= to`. */
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Free-text substring search matches `profiles.email` via ILIKE. */
  customerEmail: z.string().min(1).max(100).optional(),
  /** Exact affiliate_id (the URL renders from an admin dropdown in Slice 2). */
  affiliateId: z.coerce.number().int().positive().optional(),
  /** Exact product_id (orders that have at least one line for this product). */
  productId: z.coerce.number().int().positive().optional(),
  /** Exact partner_id (orders that have at least one line for this partner). */
  partnerId: z.coerce.number().int().positive().optional(),
})

export type OrderFiltersInput = z.infer<typeof OrderFiltersSchema>

/** Filter URL shape after parsing. */
export type ParsedOrderFilters = {
  status: OrderFilterStatus | null
  from: string | null
  to: string | null
  customerEmail: string | null
  affiliateId: number | null
  productId: number | null
  partnerId: number | null
}

/**
 * Parses the URL search params into a typed filter bag. Each
 * field is independently validated; a malformed value drops that
 * single filter rather than rejecting the whole request.
 *
 * Pure function — no I/O, easy to test.
 */
export function parseOrderFilters(
  sp: Record<string, string | string[] | undefined> | null | undefined,
): ParsedOrderFilters {
  const out: ParsedOrderFilters = {
    status: null,
    from: null,
    to: null,
    customerEmail: null,
    affiliateId: null,
    productId: null,
    partnerId: null,
  }
  if (!sp) return out

  const first = (v: string | string[] | undefined): string | null => {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  const status = first(sp.status)
  if (status && (ORDER_FILTER_STATUSES as readonly string[]).includes(status)) {
    out.status = status as OrderFilterStatus
  }

  const from = first(sp.from)
  if (from && isValidIsoDate(from)) out.from = from

  const to = first(sp.to)
  if (to && isValidIsoDate(to)) out.to = to

  const email = first(sp.customerEmail)
  if (email) {
    const trimmed = email.trim().slice(0, 100)
    if (trimmed.length > 0) out.customerEmail = trimmed
  }

  const affiliateId = first(sp.affiliateId)
  if (affiliateId && /^\d+$/.test(affiliateId)) {
    const n = Number(affiliateId)
    if (Number.isFinite(n) && n > 0) out.affiliateId = Math.floor(n)
  }

  const productId = first(sp.productId)
  if (productId && /^\d+$/.test(productId)) {
    const n = Number(productId)
    if (Number.isFinite(n) && n > 0) out.productId = Math.floor(n)
  }

  const partnerId = first(sp.partnerId)
  if (partnerId && /^\d+$/.test(partnerId)) {
    const n = Number(partnerId)
    if (Number.isFinite(n) && n > 0) out.partnerId = Math.floor(n)
  }

  return out
}

/** Builds the JSONB shape expected by the RPC. */
export function orderFiltersToRpcPayload(p: ParsedOrderFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.status) out.status = p.status
  if (p.from) out.from = p.from
  if (p.to) out.to = p.to
  if (p.customerEmail) out.customerEmail = p.customerEmail
  if (p.affiliateId !== null) out.affiliateId = p.affiliateId
  if (p.productId !== null) out.productId = p.productId
  if (p.partnerId !== null) out.partnerId = p.partnerId
  return out
}

/** Human-readable label for an order status. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
  failed: 'Failed',
  canceled: 'Canceled',
  fraudulent: 'Fraudulent',
}

/** Status → CSS data attr for the badge. */
export const ORDER_STATUS_KIND: Record<OrderStatus, string> = {
  pending: 'blue',
  awaiting_payment: 'blue',
  paid: 'green',
  fulfilled: 'green',
  refunded: 'gray',
  partially_refunded: 'amber',
  failed: 'red',
  canceled: 'gray',
  fraudulent: 'red',
}

/** YYYY-MM-DD regex (catches malformed strings like '2026-13-01'). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map((n) => Number.parseInt(n, 10))
  if (!y || !m || !d) return false
  if (m < 1 || m > 12) return false
  if (d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  // Round-trip check: catches things like 2026-02-30 (Feb has 28/29 days).
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
