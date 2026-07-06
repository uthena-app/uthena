// /affiliate/onboarding/welcome — RSC. The entry screen for the
// affiliate onboarding wizard.
//
// P13.2 — welcome screen. The page dispatches on the user's
// affiliate status before rendering the static `<WelcomePage>`
// component:
//
//   1. anonymous → redirect to /signup?next=/affiliate/onboarding/welcome
//      (spec acceptance criterion #1 — auth required, signup honors
//      ?next=). The signup page is the canonical entry for new
//      affiliates per `affiliate-onboarding-welcome.md` Open Q #1.
//   2. approved → redirect to /affiliate (the dashboard).
//   3. pending → redirect to /affiliate/onboarding/thanks.
//   4. default (no affiliate row, OR suspended) → render the welcome
//      page. Suspended affiliates fall through per spec Open Q #2
//      (re-onboarding; the wizard handles the rest).
//
// What this page is NOT:
//   - No DB writes. No `affiliate_onboarding_drafts` row is created
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
  getMyAffiliateApplicationStatus,
} from '@features/affiliate-onboarding'
import { WelcomePage } from '@features/affiliate-onboarding'
import { pageRateLimitVerdict } from '@features/affiliate-onboarding'
import styles from './page.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Become an affiliate',
  description:
    'Apply to promote Uthena — 20% commission, weekly PayPal payouts, and a public mini-shop at uthena.com/your-name.',
  path: '/affiliate/onboarding/welcome',
})

// Welcome is user-specific: the redirect dispatch reads the user's
// affiliate row + session, so no shared cache. RSC + force-dynamic.
export const dynamic = 'force-dynamic'

const NEXT_PATH = '/affiliate/onboarding/welcome'

export default async function AffiliateOnboardingWelcomePage() {
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

  // Read the affiliate row to dispatch on status. RLS keeps the read
  // self-scoped; no service-role escalation.
  const appState = await getMyAffiliateApplicationStatus()

  // Approved → /affiliate dashboard.
  if (appState.kind === 'approved') {
    redirect('/affiliate')
  }
  // Pending → /thanks page (the user already submitted).
  if (appState.kind === 'pending') {
    redirect('/affiliate/onboarding/thanks')
  }
  // Default (none / suspended) → render the welcome content.

  // The user's display_name is stored on `profiles.display_name`.
  // Fall back to the email local-part so the headline always reads
  // "Welcome, <something>!" — never an awkward "Welcome, !".
  const firstName = extractFirstName(user.display_name, user.email)

  return (
    <main className={styles.page}>
      <WelcomePage firstName={firstName} />
    </main>
  )
}

/** Best-effort first-name extraction from `profiles.display_name`.
 *  - "Marcus Reyes" → "Marcus"
 *  - "marcus" → "marcus"
 *  - "Marcus" → "Marcus"
 *  - "" / undefined → email local-part (e.g. "klaas" from "klaas@...")
 *  - everything else → email local-part.
 *  PII-safe: the name is the signed-in user's own; it never leaves
 *  the page's render boundary. */
function extractFirstName(displayName: string | undefined, email: string): string {
  const trimmed = (displayName ?? '').trim()
  if (trimmed.length > 0) {
    const first = trimmed.split(/\s+/)[0]
    if (first && first.length > 0) return first
  }
  const local = email.split('@')[0] ?? ''
  return local.length > 0 ? local : 'there'
}