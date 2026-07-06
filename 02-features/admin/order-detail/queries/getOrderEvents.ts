// getOrderEvents.ts — server query wrapping the SECURITY DEFINER RPC
// `get_order_events(p_order_id bigint, p_limit int)` shipped in
// migration 0058.
//
// Returns the chronological event log for the order: admin_audit_log
// rows + processed_webhooks rows, unioned and timestamp-desc sorted,
// capped at p_limit (default 50, max 200).
//
// Defensive mapping: action strings are short — capped at 200 chars.
// Metadata jsonb is preserved in full for the UI to render — the
// UI surface ships in Slice 2, but we already persist the union so
// the data seam is ready.

import 'server-only'
import { requireAdmin } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { parseOrderDetailId } from './parseOrderDetailId'

const log = loggerFor({ component: 'admin.order-detail.getOrderEvents' })

export const DEFAULT_ORDER_EVENTS_LIMIT = 50
export const MAX_ORDER_EVENTS_LIMIT = 200

export type OrderEventRow = {
  event_id: string
  event_kind: 'audit_log' | 'stripe_webhook'
  event_at: string
  actor_id: string | null
  actor_email: string | null
  action: string
  target_kind: string
  target_id: string
  summary: string
  metadata: Record<string, unknown> | null
}

type RawRpcRow = {
  event_id: string
  event_kind: string
  event_at: string
  actor_id: string | null
  actor_email: string | null
  action: string
  target_kind: string
  target_id: string
  summary: string
  metadata: Record<string, unknown> | null
}

function coerceString(v: string | null | undefined, maxLen = 200): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'string') return ''
  return v.slice(0, maxLen)
}

function coerceKind(v: string | null | undefined): 'audit_log' | 'stripe_webhook' {
  return v === 'stripe_webhook' ? 'stripe_webhook' : 'audit_log'
}

function clampLimit(v: number | null | undefined): number {
  if (v === null || v === undefined) return DEFAULT_ORDER_EVENTS_LIMIT
  if (!Number.isFinite(v)) return DEFAULT_ORDER_EVENTS_LIMIT
  return Math.max(1, Math.min(MAX_ORDER_EVENTS_LIMIT, Math.floor(v)))
}

function mapRow(raw: RawRpcRow): OrderEventRow {
  return {
    event_id: raw.event_id,
    event_kind: coerceKind(raw.event_kind),
    event_at: raw.event_at,
    actor_id: raw.actor_id,
    actor_email: coerceString(raw.actor_email, 200) || null,
    action: coerceString(raw.action, 200),
    target_kind: coerceString(raw.target_kind, 100),
    target_id: coerceString(raw.target_id, 100),
    summary: coerceString(raw.summary, 300),
    metadata: raw.metadata && typeof raw.metadata === 'object'
      ? (raw.metadata as Record<string, unknown>)
      : null,
  }
}

export type GetOrderEventsInput = {
  rawOrderId: string | null | undefined
  limit?: number | null
}

export async function getOrderEvents(
  input: GetOrderEventsInput,
): Promise<OrderEventRow[]> {
  await requireAdmin()

  const orderId = parseOrderDetailId(input.rawOrderId)
  if (!orderId) return []

  const limit = clampLimit(input.limit ?? null)

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('get_order_events' as never, {
    p_order_id: orderId,
    p_limit: limit,
  } as never)

  if (error) {
    log.warn(
      { code: 'order_events_rpc_failed', msg: error.message },
      'getOrderEvents: RPC error',
    )
    return []
  }

  const rawRows = (data ?? []) as unknown as RawRpcRow[]
  return rawRows.map(mapRow)
}
