// /partner/settings — RSC. Partner settings form.
//
// P12.18 sub-slice (Slices 2+ owed — see PROGRESS.md): the page now
// fetches the partner ledger summary alongside the partner profile
// (both single-row RLS-gated reads) and computes the read-only
// "next payout preview" block — the 3 spec fields that weren't in
// the P6.5 Slice 1 PayPal-encryption pass (P12.18 spec rows:
// `minimum_payout_cleared`, `next_payout_date`, `next_payout_amount_cents`).
// The result is plumbed down to the client form as a typed prop.
//
// P12.18 Slice 1 stays env-gated: the bank + Stripe Connect surface
// ships when the live creds land (gated on STUB-053 + Doppler).

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requirePartner } from '@foundations/auth/guards'
import { getMyPartnerProfile } from '@features/partner-portal/queries/getMyPartnerProfile'
import { getPartnerLedger } from '@features/payouts/queries/getPartnerLedger'
import { computePayoutNext, type PayoutNext } from '@features/partner-portal/lib/computePayoutNext'
import { PartnerSettingsForm } from '@features/partner-portal/components/PartnerSettingsForm'
import { PartnerShell } from '@features/partner-portal/PartnerShell'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './settings.module.css'

// P0.21 — `noindex` so the partner settings surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Partner settings',
  description: 'Your Uthena partner settings — bio, payout method, tax info.',
  path: '/partner/settings',
})

export default async function PartnerSettingsPage() {
  await requirePartner()
  const partner = await getMyPartnerProfile()
  if (!partner) redirect('/partner/onboarding')

  // P12.18 — read-only payout-preview block. Pulled from the same
  // `getPartnerLedger` query that powers `/partner/payouts`; only
  // the `summary` field is consumed here (we don't need the entry
  // list or filters on this page). The query returns null for
  // non-partner users + RLS failure; we coerce to a zero summary so
  // the form never has to defend against null.
  const ledger = await getPartnerLedger({ limit: 1 })
  const summary =
    ledger?.summary ?? {
      available_cents: 0,
      locked_cents: 0,
      paid_cents: 0,
      lifetime_earned_cents: 0,
      next_release_at: null,
      pending_payout_cents: 0,
    }
  // The pure formatter runs server-side so the displayed "next
  // payout date" is anchored to the server clock (matches what the
  // cron-driven `partner-payouts` page would compute). Passing the
  // result down as a typed prop keeps the client bundle free of
  // date-math logic that would otherwise drift between server
  // renders + client hydration.
  const payoutNext: PayoutNext = computePayoutNext({
    available_cents: summary.available_cents,
    locked_cents: summary.locked_cents,
    next_release_at: summary.next_release_at,
  })

  return (
    <PartnerShell>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.h1}>Settings</h1>
          <p className={styles.lede}>
            Bio, website, payout method, and tax information. We keep this private except
            for the public bio + website.
          </p>
        </header>
        <PartnerSettingsForm partner={partner} payoutNext={payoutNext} />
      </div>
    </PartnerShell>
  )
}
