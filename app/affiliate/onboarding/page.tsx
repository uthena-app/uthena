// /affiliate/onboarding — RSC.
//
// P13.1 Slice 1 — wizard route shell. Authenticates the user, then
// dispatches to one of four rendering paths based on the affiliate
// application state:
//
//   1. anon → redirect to /signup?next=/affiliate/onboarding
//      (per spec acceptance criterion 1: anon visitors are redirected
//      to /signup, NOT /login — the wizard is the canonical entry for
//      new affiliates).
//   2. approved → redirect to /affiliate (the dashboard, per spec
//      acceptance criterion 4).
//   3. pending → render <PendingReview> (per spec acceptance criterion 3).
//   4. default (no affiliate row yet OR suspended) → render the wizard
//      from `?step=<name>` (URL) or the draft's currentStep (DB),
//      defaulting to step 1 ('welcome') when both are missing.
//
// The page is intentionally thin: it owns the auth gate + state
// dispatch + URL parsing + the per-user page rate-limit. The shell
// component owns the wizard UI. All per-step form logic lives in
// 02-features/affiliate-onboarding/.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  getMyOnboardingDraft,
} from '@features/affiliate-onboarding/queries/getMyOnboardingDraft'
import { getMyAffiliateApplicationStatus } from '@features/affiliate-onboarding/queries/getMyAffiliateApplicationStatus'
import { AffiliateOnboardingShell } from '@features/affiliate-onboarding/components/AffiliateOnboardingShell'
import { PendingReview } from '@features/affiliate-onboarding/components/PendingReview'
import { parseRequestedStep } from '@features/affiliate-onboarding/lib/parseStep'
import { pageRateLimitVerdict } from '@features/affiliate-onboarding/lib/page-rate-limit'
import styles from './onboarding.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Affiliate onboarding',
  description:
    'Apply to promote Uthena — 6 steps to your affiliate dashboard, public mini-shop, and PayPal payouts.',
  path: '/affiliate/onboarding',
})

// Onboarding is user-specific and has zero shared cache: every visit
// reads the user's draft + affiliate row. RSC + force-dynamic is the
// cheapest correct combination.
export const dynamic = 'force-dynamic'

const NEXT_PATH = '/affiliate/onboarding'

export default async function AffiliateOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | undefined }>
}) {
  const user = await getSessionUser()

  // Auth gate (spec acceptance criterion 1: anon → /signup, not
  // /login). Per QWEN.md §2 "auth required by default" + the spec
  // line 36 — signup is the canonical entry for new affiliates.
  if (!user) {
    redirect(`/signup?next=${encodeURIComponent(NEXT_PATH)}`)
  }

  // Per-user page rate-limit (60/min/user). Denied requests bounce
  // to /429 — keeps a misbehaving client from hammering the wizard's
  // redirect logic.
  const verdict = pageRateLimitVerdict(user.id, Date.now())
  if (!verdict.allowed) {
    redirect('/429')
  }

  const sp = await searchParams

  // Read draft + application status in parallel — they're two
  // independent queries against the same user_id. RLS keeps both
  // self-scoped, no service-role escalation.
  const [draft, appState] = await Promise.all([
    getMyOnboardingDraft(),
    getMyAffiliateApplicationStatus(),
  ])

  // Spec criterion 4: approved affiliates skip the wizard entirely.
  if (appState.kind === 'approved') {
    redirect('/affiliate')
  }

  // Spec criterion 3: pending affiliates see the review state.
  if (appState.kind === 'pending') {
    return (
      <main className={styles.page}>
        <PendingReview state={appState} />
      </main>
    )
  }

  // Default: render the wizard.
  // suspended affiliates fall through here too — re-apply is a
  // Slice 2+ concern (the affiliates.user_id UNIQUE constraint
  // blocks re-submit today; spec open question deferred).
  const currentStep = parseRequestedStep(sp.step, draft)
  return (
    <main className={styles.page}>
      <AffiliateOnboardingShell currentStep={currentStep} draft={draft} />
    </main>
  )
}