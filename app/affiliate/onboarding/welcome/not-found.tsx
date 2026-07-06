// /affiliate/onboarding/welcome/not-found — 404 fallback. The page
// never calls notFound() (auth + state dispatch all return
// redirects or render), but Next.js still requires this file for
// the route to be 404-safe.

import Link from 'next/link'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './not-found.module.css'

export default function AffiliateOnboardingWelcomeNotFound() {
  return (
    <main className={styles.page}>
      <EmptyState
        title="Welcome page not found"
        description="This page may have been moved. Head back to the affiliate program entry."
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