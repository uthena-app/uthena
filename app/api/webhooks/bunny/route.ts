// /api/webhooks/bunny — Bunny.net webhook mount point.
//
// The actual handler lives at 04-platform/webhooks/bunny/handleBunnyWebhook.ts.
// This file is the thin Next.js route that adapts the
// request/response. Per AGENTS.md, this is the only place the route
// is mounted.

import { handleBunnyWebhook } from '@platform/webhooks/bunny/handleBunnyWebhook'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const raw = await req.text()
  const res = await handleBunnyWebhook(raw, req.headers)
  return new NextResponse(res.body, { status: res.status })
}
