// Types for the admin refunds queue page (P14.9).
//
// These shapes mirror the SECURITY DEFINER RPCs in
// `04-platform/migrations/0059_admin_refunds_query.sql`. The PostgREST
// driver coerces bigint to string (defense-in-depth per P2.3 +
// `coerceBigint` pattern), so every numeric field uses `number` after
// server-side `coerceBigint()`.
//
// Spec reference: `01-specs/pages/admin-refunds.md`. The page is the
// admin's view of every refund request — paginated, FIFO-sorted,
// filterable, with a right-pane detail panel.
//
// Spec/DB vocabulary mapping (documented at `enums.ts#RefundStatus`):
//   spec `requested` ↔ DB `pending`
//   spec `approved` ↔ DB `approved` (added in 0059 — admin committed,
//     Stripe call in flight, webhook hasn't confirmed `succeeded` yet)
//   spec `processed` ↔ DB `succeeded`
//   spec `rejected` ↔ DB `failed`
//   DB `canceled` is legacy (predates the admin flow; surfaces in the
//     stats card for transparency).
//
// `REFUND_STATUS_LABEL` below maps the DB enum values to the spec's
// customer-visible vocabulary so the admin sees the same words the
// spec uses.

import { z } from 'zod'
import {
  REFUND_STATUSES,
  REFUND_REASONS,
  type RefundStatus,
  type RefundReason,
} from '@foundations/data/enums'

/**
 * Zod-filterable refund-status values. Built as a fresh `as const`
 * tuple (not re-exported from the foundation) so `z.enum` accepts it
 * without the readonly-array mismatch. Matches `REFUND_STATUSES` from
 * `00-foundations/data/enums.ts`.
 */
export const REFUND_FILTER_STATUSES = REFUND_STATUSES

export type RefundFilterStatus = RefundStatus

/** Stats row shape (5 cards + total). Mirrors `get_admin_refund_stats`. */
export type RefundStats = {
  total: number
  pending: number
  approved: number
  succeeded: number
  failed: number
  canceled: number
}

export const EMPTY_REFUND_STATS: RefundStats = {
  total: 0,
  pending: 0,
  approved: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
}

/**
 * One refund row as returned by `get_admin_refunds_queue`.
 *
 * The `requested_at_age_seconds` field is computed at the page layer
 * (not the RPC) so the SLA badge can render without a second round-trip.
 */
export type RefundQueueRow = {
  refund_id: number
  order_id: number
  amount_cents: number
  currency: string
  reason: RefundReason
  status: RefundStatus
  requested_at: string
  requested_by: string | null
  customer_user_id: string | null
  customer_display_name: string
  customer_email: string
  proof_path: string | null
  proof_filename: string | null
  total_count: number
}

/**
 * Full refund detail shape. Mirrors `get_admin_refund_detail`.
 *
 * The reversal preview fields are surfaced as NEGATIVE numbers (the
 * convention matches `payout_ledger.amount_cents` — positive = credit
 * to partner, negative = debit / reversal). The Detail panel formats
 * them with explicit "to partner" / "to affiliate" labels so the
 * admin sees the dollar-flow direction.
 */
export type RefundDetail = {
  // Refund row
  refund_id: number
  order_id: number
  amount_cents: number
  currency: string
  reason: RefundReason
  notes: string | null
  status: RefundStatus
  stripe_refund_id: string | null
  requested_by: string | null
  requested_at: string
  approved_by: string | null
  approved_at: string | null
  processed_at: string | null
  resolution_notes: string | null
  proof_path: string | null
  proof_filename: string | null
  // Order row
  order_status: string
  order_subtotal_cents: number
  order_total_cents: number
  order_paid_at: string | null
  order_ip_raw: string | null
  order_ip_hash: string | null
  order_stripe_payment_intent_id: string | null
  order_customer_checkout_email: string | null
  // Customer aggregates
  customer_user_id: string | null
  customer_display_name: string
  customer_email: string
  customer_since: string | null
  customer_lifetime_orders: number
  customer_lifetime_refunds: number
  customer_lifetime_refund_rate: number
  // Reversal preview
  partner_share_reversal_cents: number
  affiliate_commission_reversal_cents: number
  // Order context
  order_items_count: number
}

/**
 * Zod schema for the page-level URL filter bag. All fields optional;
 * unknown values fall back to "no filter" (graceful degradation).
 */
export const RefundFiltersSchema = z.object({
  /** One of the 5 `refund_status` enum values. Spread to mutable
   *  tuple — Zod 3's `z.enum` overload requires a non-readonly tuple. */
  status: z.enum([...REFUND_FILTER_STATUSES] as [string, ...string[]]).optional(),
  /** ISO date string YYYY-MM-DD — `refunds.requested_at >= from`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** ISO date string YYYY-MM-DD — `refunds.requested_at <= to`. */
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Free-text substring search matches `profiles.email` via ILIKE. */
  customerEmail: z.string().min(1).max(100).optional(),
  /** Exact product_id (refunds whose order has at least one line for this product). */
  productId: z.coerce.number().int().positive().optional(),
}).strict()

export type RefundFiltersInput = z.infer<typeof RefundFiltersSchema>

/** Filter URL shape after parsing. */
export type ParsedRefundFilters = {
  status: RefundFilterStatus | null
  from: string | null
  to: string | null
  customerEmail: string | null
  productId: number | null
}

/** Default filter applied on first visit — spec line 65: "Default filter is `status='requested'`". */
export const REFUND_DEFAULT_STATUS: RefundFilterStatus = 'pending'

/**
 * Parses the URL search params into a typed filter bag. Each
 * field is independently validated; a malformed value drops that
 * single filter rather than rejecting the whole request.
 *
 * Pure function — no I/O, easy to test.
 */
export function parseRefundFilters(
  sp: Record<string, string | string[] | undefined> | null | undefined,
): ParsedRefundFilters {
  const out: ParsedRefundFilters = {
    status: null,
    from: null,
    to: null,
    customerEmail: null,
    productId: null,
  }
  if (!sp) return out

  const first = (v: string | string[] | undefined): string | null => {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  const status = first(sp.status)
  if (status && (REFUND_FILTER_STATUSES as readonly string[]).includes(status)) {
    out.status = status as RefundFilterStatus
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

  const productId = first(sp.productId)
  if (productId && /^\d+$/.test(productId)) {
    const n = Number(productId)
    if (Number.isFinite(n) && n > 0) out.productId = Math.floor(n)
  }

  return out
}

/** Builds the JSONB shape expected by the queue RPC. */
export function refundFiltersToRpcPayload(p: ParsedRefundFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.status) out.status = p.status
  if (p.from) out.from = p.from
  if (p.to) out.to = p.to
  if (p.customerEmail) out.customerEmail = p.customerEmail
  if (p.productId !== null) out.productId = p.productId
  return out
}

/**
 * Spec/DB vocabulary mapping for the status badge. The admin sees
 * the spec's vocabulary (`Requested / Approved / Processed /
 * Rejected`) rather than the DB enum (`pending / approved /
 * succeeded / failed / canceled`). The DB `canceled` value is
 * legacy and renders as "Canceled" (lower-case c, matching the
 * spec's naming for that state).
 */
export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  pending: 'Requested',
  approved: 'Approved',
  succeeded: 'Processed',
  failed: 'Rejected',
  canceled: 'Canceled',
}

/** Status → CSS data attr for the badge tone. */
export const REFUND_STATUS_KIND: Record<RefundStatus, string> = {
  pending: 'amber', // awaiting admin decision
  approved: 'blue', // committed, awaiting webhook
  succeeded: 'green', // refund completed
  failed: 'red', // admin denied / Stripe failed
  canceled: 'gray', // legacy / unused
}

/**
 * Reason → human-readable label for the queue list + the detail
 * panel. The DB stores the canonical enum value (e.g.
 * `requested_by_customer`); the admin sees the friendlier copy.
 */
export const REFUND_REASON_LABEL: Record<RefundReason, string> = {
  duplicate: 'Duplicate charge',
  fraudulent: 'Fraudulent',
  requested_by_customer: 'Customer request',
  product_not_received: 'Product not received',
  product_unacceptable: 'Product unacceptable',
  other: 'Other',
}

/** Queue list default page size (matches spec line 28 — pageSize: 25). */
export const DEFAULT_REFUNDS_PAGE_SIZE = 25
export const MAX_REFUNDS_PAGE_SIZE = 200

/** SLA threshold in seconds — spec line 64: refunds > 24h old are "Overdue". */
export const REFUND_SLA_SECONDS = 24 * 60 * 60

/**
 * Returns true when a refund is past the 24h SLA window — spec line
 * 64: "SLA callout visually flags refunds with `requested_at < now() - interval '24 hours'` (amber border + 'Overdue' badge)".
 *
 * Pure function — accepts a Date (or ISO string) and the current
 * time, returns the boolean. The queue list calls this with
 * `new Date(row.requested_at)` and `new Date()`.
 */
export function isRefundOverdue(
  requestedAt: Date | string,
  now: Date | string = new Date(),
): boolean {
  const requestedMs = typeof requestedAt === 'string' ? Date.parse(requestedAt) : requestedAt.getTime()
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime()
  if (!Number.isFinite(requestedMs) || !Number.isFinite(nowMs)) return false
  return nowMs - requestedMs > REFUND_SLA_SECONDS * 1000
}

/**
 * Formats a duration in seconds as a compact "Xh ago" / "Xd ago"
 * string for the queue list. Pure function.
 */
export function formatRefundAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.floor(seconds)}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  const days = Math.floor(seconds / 86400)
  return `${days}d ago`
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

/**
 * Validates a `?refundId=<id>` URL param. Mirrors the parseRefundId
 * helper used at the route layer (positive bigint, no decimals / signed /
 * scientific / hex / oversized). Lives here so the filter parser can
 * reject malformed detail-panel URLs.
 */
export function parseRefundId(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}