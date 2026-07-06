// /partner/onboarding/not-found — 404 fallback. The page itself never
// calls notFound() in Slice 1 (auth + state dispatch all return
// redirects or render), but Next.js still requires this file for the
// route to be 404-safe.

import Link from 'next/link'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './not-found.module.css'

export default function PartnerOnboardingNotFound() {
  return (
    <main className={styles.page}>
      <EmptyState
        title="Onboarding step not found"
        description="The step number in your URL is invalid or has been removed. Your saved progress is intact."
        action={
          <Link href="/partner/onboarding">
            <Button type="button" variant="primary" size="md">
              Back to step 1
            </Button>
          </Link>
        }
      />
    </main>
  )
}
