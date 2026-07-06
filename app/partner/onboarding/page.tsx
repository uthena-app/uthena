// /partner/onboarding — RSC.
//
// P12.1 Slice 1 — wizard route shell. Authenticates the user, then
// dispatches to one of four rendering paths based on the partner
// application state:
//
//   1. anon → redirect to /signup?next=/partner/onboarding
//      (spec line 36, AGENTS.md §1 — auth required by default).
//   2. approved → redirect to /partner (dashboard)
//      (spec line 66, criterion 5).
//   3. pending → render <PendingReview> (spec line 65, criterion 4).
//   4. default (no partner row OR suspended) → render the wizard
//      from `?step=N` (URL) or the draft's currentStep (DB),
//      defaulting to step 1 when both are missing.
//
// The page is intentionally thin: it owns the auth gate + state
// dispatch + URL parsing. The shell component owns the wizard UI.
// All per-step form logic lives in 02-features/partner-onboarding/.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  getMyOnboardingDraft,
} from '@features/partner-onboarding/queries/getMyOnboardingDraft'
import { getMyPartnerApplicationStatus } from '@features/partner-onboarding/queries/getMyPartnerApplicationStatus'
import { PartnerOnboardingShell } from '@features/partner-onboarding/components/PartnerOnboardingShell'
import { PendingReview } from '@features/partner-onboarding/components/PendingReview'
import { parseRequestedStep } from '@features/partner-onboarding/lib/parseStep'
import styles from './onboarding.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Partner onboarding',
  description:
    'Apply to teach on Uthena — 7 steps to your partner dashboard, payout method, and tax forms.',
  path: '/partner/onboarding',
})

// Onboarding is user-specific and has zero shared cache: every visit
// reads the user's draft + partner row. RSC + force-dynamic is the
// cheapest correct combination.
export const dynamic = 'force-dynamic'

const NEXT_PATH = '/partner/onboarding'

export default async function PartnerOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | undefined }>
}) {
  const user = await getSessionUser()

  // Auth gate (spec acceptance criterion 1: anon → /signup, not /login).
  // Per QWEN.md §2 "auth required by default", and the spec line 35-36
  // is explicit: signup is the canonical entry for new partners.
  if (!user) {
    redirect(`/signup?next=${encodeURIComponent(NEXT_PATH)}`)
  }

  const sp = await searchParams

  // Read draft + application status in parallel — they're two
  // independent queries against the same user_id. RLS keeps both
  // self-scoped, no service-role escalation.
  const [draft, appState] = await Promise.all([
    getMyOnboardingDraft(),
    getMyPartnerApplicationStatus(),
  ])

  // Spec criterion 5: approved partners skip the wizard entirely.
  if (appState.kind === 'approved') {
    redirect('/partner')
  }

  // Spec criterion 4: pending partners see the review state.
  if (appState.kind === 'pending') {
    return (
      <main className={styles.page}>
        <PendingReview state={appState} />
      </main>
    )
  }

  // Default: render the wizard.
  // suspended partners fall through here too — spec Open Question #3
  // recommends re-onboarding; the data-model change required lives in
  // STUB-088 (the partners.user_id UNIQUE constraint blocks the
  // re-submit flow today; Slices 7 ships the data-model change with
  // the resubmit server action).
  const currentStep = parseRequestedStep(sp.step, draft)
  return (
    <main className={styles.page}>
      <PartnerOnboardingShell currentStep={currentStep} draft={draft} />
    </main>
  )
}
