// /affiliate/onboarding/thanks/not-found — 404 fallback. The page
// never calls notFound() (auth + state dispatch all return
// redirects or render), but Next.js still requires this file for
// the route to be 404-safe.

import Link from 'next/link'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './not-found.module.css'

export default function AffiliateOnboardingThanksNotFound() {
  return (
    <main className={styles.page}>
      <EmptyState
        title="Application status not found"
        description="We couldn't find a submitted application for your account. If you just submitted, please try again in a few seconds."
        action={
          <Link href="/affiliate/onboarding">
            <Button type="button" variant="primary" size="md">
              Open the onboarding wizard
            </Button>
          </Link>
        }
      />
    </main>
  )
}