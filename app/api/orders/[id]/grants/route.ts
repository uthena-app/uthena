// /api/orders/[id]/grants — JSON endpoint polled by the success page
// to flip the "Library ready" badge. Auth-gated. RLS-aware.
//
// Returns { grant_count, status } for the order owned by the current
// user. The poll is the courtesy — the webhook is the source of truth.

import { NextResponse } from 'next/server'
import { getServerSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import { loggerFor } from '@foundations/log/pino'

export const dynamic = 'force-dynamic'

const log = loggerFor({ component: 'api.orders.grants' })

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const { id } = await ctx.params
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ grant_count: 0, status: 'unknown' }, { status: 200 })
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, user_id, grants:library_grants ( id )')
    .eq('id', orderId)
    .maybeSingle()
  if (error || !data) {
    log.warn({ code: 'grants_lookup_failed', msg: error?.message, order_id: orderId }, 'grants lookup failed')
    return NextResponse.json({ grant_count: 0, status: 'unknown' }, { status: 200 })
  }
  if ((data as any).user_id !== user.id) {
    return new NextResponse('not found', { status: 404 })
  }
  return NextResponse.json(
    {
      grant_count: ((data as any).grants ?? []).length,
      status: data.status,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
