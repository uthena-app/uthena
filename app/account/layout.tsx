// /account — layout. Auth-gates every account route. The visible
// shell (sidebar + content) is delegated to the `AccountShell`
// feature module so the visual contract lives outside the route
// file. The layout itself only does the redirect guard (the shell
// does its own auth check via `getSessionUser()`; the layout's
// guard is a belt-and-suspenders defense so an unauthenticated
// request never even reaches the shell).

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { AccountShell } from '@features/account'
import { sensitivePageMetadata } from '@foundations/metadata'

// P0.21 — every page in /account/* inherits `noindex` from the
// layout's metadata (overridden per-page when the page wants a
// more specific title). The auth gate (getSessionUser → redirect)
// ensures only authenticated users see these pages; the noindex
// is defense in depth so URLs don't leak via search.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'My account',
  description: 'Your Uthena account — orders, library, profile, settings.',
  path: '/account',
})

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  // Belt-and-suspenders guard. AccountShell does its own check via
  // getSessionUser() + redirect(); this layout-level check means
  // an unauthenticated request returns before the shell even
  // renders (saves a tree walk for a request that's already
  // guaranteed to redirect).
  const user = await getSessionUser()
  if (!user) {
    redirect('/login?next=/account')
  }

  return <AccountShell>{children}</AccountShell>
}