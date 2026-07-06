// /affiliate/onboarding/thanks — RSC. The post-submit landing for the
// affiliate onboarding wizard.
//
// P13.2 — thanks page. The page dispatches on the user's
// (affiliates.status, affiliate_onboarding_drafts.submitted_at) state
// before rendering the static `<ThanksPage>` component:
//
//   1. anonymous → redirect to /login?next=/affiliate/onboarding/thanks
//      (spec acceptance criterion #1 — auth required).
//   2. approved (`affiliates.status = 'approved'`) → redirect to /affiliate
//      (the dashboard; spec Open Q #1).
//   3. pending + draft submitted (`affiliates.status = 'pending'` AND
//      `affiliate_onboarding_drafts.submitted_at IS NOT NULL`) → render
//      the thanks surface.
//   4. suspended (`affiliates.status = 'suspended'`) → redirect to
//      /affiliate/onboarding/welcome (re-apply entry point; per spec
//      acceptance criterion #3).
//   5. none (no affiliate row, OR pending without submitted_at) → redirect
//      to /affiliate/onboarding/welcome. The stuck-state guard handles
//      a half-finished submit where the draft was never finalized.
//
// The page is IDEMPOTENT on re-visit (spec acceptance criterion #4):
//   - No DB writes
//   - No email re-send
//   - No submit re-trigger
//
// Page-level rate limit: 60 req/min/user (spec line 77). When denied,
// the page renders a friendly "slow down" surface — not a 500 /
// redirect / blank.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  getMyOnboardingApplicationForThanks,
} from '@features/affiliate-onboarding'
import { ThanksPage } from '@features/affiliate-onboarding'
import { pageRateLimitVerdict } from '@features/affiliate-onboarding'
import styles from './page.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Application received',
  description:
    'Thanks for applying to promote Uthena — your affiliate application is being reviewed.',
  path: '/affiliate/onboarding/thanks',
})

// Thanks is user-specific: the dispatch reads the user's affiliate
// row + draft submitted_at, so no shared cache. RSC + force-dynamic.
export const dynamic = 'force-dynamic'

const NEXT_PATH = '/affiliate/onboarding/thanks'

export default async function AffiliateOnboardingThanksPage() {
  const user = await getSessionUser()

  // Auth gate — spec acceptance criterion #1.
  // Anon → /login?next=... (the thanks page assumes an account;
  // signup is not the canonical entry here).
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(NEXT_PATH)}`)
  }

  // Page-level rate limit (60 req/min/user per spec line 77).
  const rl = pageRateLimitVerdict(user.id, Date.now())
  if (!rl.allowed) {
    return (
      <main className={styles.page}>
        <div className={styles.rateLimited}>
          <p className={styles.rateLimitedEyebrow}>Slow down</p>
          <h1 className={styles.rateLimitedTitle}>
            You&apos;re refreshing too quickly.
          </h1>
          <p className={styles.rateLimitedLede}>
            We limit this page to 60 visits per minute per user. Please
            try again in{' '}
            <strong>{Math.max(1, rl.retryAfterSeconds)} second{rl.retryAfterSeconds === 1 ? '' : 's'}</strong>
            .
          </p>
        </div>
      </main>
    )
  }

  // Read affiliates + draft (1 RT) and dispatch on the resolved state.
  const appState = await getMyOnboardingApplicationForThanks()

  // Approved → /affiliate dashboard (per spec Open Q #1).
  if (appState.kind === 'approved') {
    redirect('/affiliate')
  }
  // None / suspended → /affiliate/onboarding/welcome (re-apply entry).
  if (appState.kind === 'none' || appState.kind === 'suspended') {
    redirect('/affiliate/onboarding/welcome')
  }
  // Pending + submitted → render.

  return (
    <main className={styles.page}>
      <ThanksPage
        affiliateId={appState.affiliateId}
        email={user.email}
      />
    </main>
  )
}