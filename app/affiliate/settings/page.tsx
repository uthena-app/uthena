// /affiliate/settings — P13.11 Slice 1 surface.
//
// RSC. Auth-gated to the affiliate role via the parent
// AffiliateShell layout (which wraps every /affiliate/* route in
// requireRole(['affiliate', 'admin', 'super_admin'])). The route
// reads the SettingsAggregator and passes it to the SettingsHub
// orchestrator.

import { getMyAffiliateSettings } from '@features/affiliate-portal/queries/getMyAffiliateSettings'
import { SettingsHub } from '@features/affiliate-portal/components/SettingsHub'
import { requireRole } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import settingsStyles from './settings.module.css'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Settings · Affiliate · Uthena',
  robots: { index: false, follow: false },
}

export default async function AffiliateSettingsPage() {
  // Defense-in-depth role check (the parent AffiliateShell already
  // gates; this is the spec's "redirects anon to
  // /login?next=/affiliate/settings; non-affiliates to /library"
  // contract, expressed as a return-type-redirect rather than a
  // thrown redirect).
  await requireRole(['affiliate', 'admin', 'super_admin'])

  const settings = await getMyAffiliateSettings()

  // If the user has no affiliates row, redirect to onboarding per
  // the spec's "non-affiliates to /library" pattern. We can't
  // distinguish anon (already redirected) from non-affiliate from
  // an authenticated user with no affiliate row — both look like
  // "no row" in the aggregator. We send them to /library (the
  // spec's non-affiliate redirect target).
  if (!settings.status.hasRow) {
    redirect('/library')
  }

  // We need the affiliate's handle to render the MiniShopPreview
  // link. Fetch it here (the aggregator doesn't carry it because
  // the Settings surface doesn't need it for the editable fields).
  // RLS: affiliates_self_read — the user can read their own row.
  const supabase = await getServerSupabase()
  const { data: affiliateRow } = await supabase
    .from('affiliates')
    .select('handle')
    .eq('user_id', settings.userId)
    .maybeSingle()

  const handle =
    typeof affiliateRow?.handle === 'string' && affiliateRow.handle.length > 0
      ? affiliateRow.handle
      : 'unknown'

  return (
    <main className={settingsStyles.page}>
      <SettingsHub settings={settings} handle={handle} />
    </main>
  )
}