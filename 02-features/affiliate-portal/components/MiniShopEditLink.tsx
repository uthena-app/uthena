// MiniShopEditLink — P13.8 public mini-shop affiliate-edit affordance.
//
// Renders the "Edit your shop" link INSIDE the top bar of
// /[handle], per the spec at affiliate-minishop.md:34 ("Affiliate
// edits their shop ... Navigate to /affiliate/shop (the edit
// page) | affiliate (self)"). The link only appears when the
// logged-in user IS the affiliate whose shop is being visited —
// anon visitors + other affiliates never see it.
//
// The page itself is always public (per acceptance #1), but
// this top-bar CTA is the single bit of per-visitor context
// that's allowed in a public RSC: read the auth session, gate
// the link to the matching user_id, render conditionally.
//
// RSC, zero client JS. The session check uses the same
// `getServerSupabase().auth.getUser()` pattern as the rest of
// the affiliate-portal surface.

import 'server-only'
import Link from 'next/link'
import { getServerSupabase } from '@foundations/data/supabase'
import styles from './MiniShopEditLink.module.css'

export async function MiniShopEditLink({
  affiliateUserId,
  handle,
}: {
  affiliateUserId: string
  handle: string
}) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || user.id !== affiliateUserId) return null
  return (
    <Link
      href="/affiliate/shop"
      className={styles.link}
      aria-label={`Edit your mini-shop (handle: @${handle})`}
    >
      <svg
        viewBox="0 0 16 16"
        className={styles.icon}
        aria-hidden
        focusable="false"
      >
        <path
          d="M11.5 1l3.5 3.5-9.8 9.8L1 15l.7-4.2L11.5 1zm0 2L3.2 11.3l-.3 2 2-.3L13.3 4.9 11.5 3z"
          fill="currentColor"
        />
      </svg>
      Edit your shop
    </Link>
  )
}
