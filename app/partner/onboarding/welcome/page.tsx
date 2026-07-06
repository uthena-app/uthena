// /partner/onboarding/welcome — RSC. The entry screen for the partner
// onboarding wizard.
//
// P12.3 — welcome screen. The page dispatches on the user's partner
// status before rendering the static `<WelcomePage>` component:
//
//   1. anonymous → redirect to /signup?next=/partner/onboarding/welcome
//      (spec acceptance criterion #1 — auth required, signup honors
//      ?next=). The signup page is the canonical entry for new
//      partners per `partner-onboarding-welcome.md` Open Q #1.
//   2. approved → redirect to /partner (the dashboard).
//   3. pending → redirect to /partner/onboarding/thanks.
//   4. default (no partner row, OR suspended) → render the welcome
//      page. Suspended partners fall through per spec Open Q #2
//      (re-onboarding; the wizard handles the rest).
//
// What this page is NOT:
//   - No DB writes. No `partner_onboarding_drafts` row is created
//     here (the row is created on the first `saveStep` inside the
//     wizard — spec line 23, line 52 acceptance criterion).
//   - No form fields. The wizard owns all form logic.
//   - No client JS. RSC + the static `<WelcomePage>` component.
//
// Page-level rate limit: 60 req/min/user via the in-process
// `pageRateLimitVerdict` helper. The spec's acceptance criterion
// (line 53) requires this to prevent scraper abuse of the redirect
// logic. Per-user, not per-IP — matches the saveStep pattern. When
// the verdict denies, the page renders a friendly "slow down"
// surface (NOT a 500 / NOT a redirect — both would be jarring for
// a logged-in user who's just refreshing the page).

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import {
  getMyPartnerApplicationStatus,
} from '@features/partner-onboarding/queries/getMyPartnerApplicationStatus'
import {
  WelcomePage,
} from '@features/partner-onboarding/components/WelcomePage'
import {
  pageRateLimitVerdict,
} from '@features/partner-onboarding/lib/page-rate-limit'
import styles from './page.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Become a partner',
  description:
    'Apply to teach on Uthena — 60% revenue share, weekly payouts, and a partner dashboard.',
  path: '/partner/onboarding/welcome',
})

// Welcome is user-specific: the redirect dispatch reads the user's
// partner row + session, so no shared cache. RSC + force-dynamic.
export const dynamic = 'force-dynamic'

const NEXT_PATH = '/partner/onboarding/welcome'

export default async function PartnerOnboardingWelcomePage() {
  const user = await getSessionUser()

  // Auth gate — spec acceptance criterion #1.
  // Anon → /signup?next=... (not /login; the spec is explicit).
  if (!user) {
    redirect(`/signup?next=${encodeURIComponent(NEXT_PATH)}`)
  }

  // Page-level rate limit (60 req/min/user per spec line 53). When
  // denied, render a friendly "slow down" surface instead of the
  // welcome content — neither a 500 nor a redirect is appropriate
  // for a logged-in user who's stuck refreshing.
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

  // Read the partner row to dispatch on status. RLS keeps the read
  // self-scoped; no service-role escalation.
  const appState = await getMyPartnerApplicationStatus()

  // Approved → /partner dashboard.
  if (appState.kind === 'approved') {
    redirect('/partner')
  }
  // Pending → /thanks page (the user already submitted).
  if (appState.kind === 'pending') {
    redirect('/partner/onboarding/thanks')
  }
  // Default (none / suspended) → render the welcome content.

  return (
    <main className={styles.page}>
      <WelcomePage />
    </main>
  )
}