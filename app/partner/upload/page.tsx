// /partner/upload — RSC.
//
// P12.7 Slice 1 — wizard route shell. Authenticates the user via
// `requirePartner()`, then dispatches to one of two rendering paths
// based on whether the partner has a draft already:
//
//   1. default → render the wizard from `?step=N` (URL) or the
//      draft's currentStep (DB), defaulting to step 1 when both are
//      missing.
//   2. submitted draft (status='submitted') → render a "we're
//      reviewing your submission" surface (Slice 5 ships the full
//      pending-review UI; Slice 1 ships a placeholder).
//
// The page is intentionally thin: it owns the auth gate + state
// dispatch + URL parsing + the categories list read. The shell
// component owns the wizard UI. All per-step form logic lives in
// 02-features/partner-upload/.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requirePartner } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import { getMyUploadDraft } from '@features/partner-upload/queries/getMyUploadDraft'
import { parseRequestedUploadStep } from '@features/partner-upload/lib/parseStep'
import { listPartnerCategories } from '@features/partner-portal/queries/listPartnerCategories'
import { UploadShell } from '@features/partner-upload/components/UploadShell'
import { loggerFor } from '@foundations/log/pino'
import styles from './upload.module.css'

const log = loggerFor({ component: 'partner-upload.page' })

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Upload a course',
  description:
    'Create a new course on Uthena — 5 steps from details to submit for review. Drafts auto-save.',
  path: '/partner/upload',
})

// Upload wizard is user-specific and has zero shared cache: every
// visit reads the user's draft + the categories list. RSC +
// force-dynamic is the cheapest correct combination.
export const dynamic = 'force-dynamic'

export default async function PartnerUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | undefined }>
}) {
  // Auth gate. requirePartner() redirects anon → /login?next=... and
  // wrong-role → /403. The wizard is restricted to partners (plus
  // admin elevation, see guards.ts). Pending + approved + suspended
  // partners can all start an upload per spec §Security line 104.
  await requirePartner()

  const sp = await searchParams

  // Read draft + categories in parallel — they're independent queries
  // against the database. RLS keeps the draft self-scoped; categories
  // is public-read. Both fail-soft (log warn + return a safe empty).
  const [draft, categories] = await Promise.all([
    getMyUploadDraft(),
    listPartnerCategories().catch((err: unknown) => {
      log.warn(
        { code: 'partner_upload_categories_read_failed', msg: err instanceof Error ? err.message : String(err) },
        'partner upload: categories read failed (continuing with empty list)',
      )
      return []
    }),
  ])

  // Slice 1 surface: submitted drafts render a thin "pending review"
  // notice with a "Withdraw" CTA deferred to Slice 5. The full review
  // surface lives in the Slice 5 wizard's Step 5 component.
  if (draft.exists && draft.status === 'submitted') {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Partner upload</p>
          <h1 className={styles.title}>Your submission is in review</h1>
          <p className={styles.lede}>
            We&apos;ll email you within 48 hours. Withdrawing + editing
            support ships in a follow-up release.
          </p>
          {draft.submittedAt && (
            <p className={styles.meta}>
              Submitted{' '}
              <time dateTime={draft.submittedAt}>
                {new Date(draft.submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
              .
            </p>
          )}
          <p className={styles.meta}>
            <a className={styles.link} href="/partner/courses">
              ← Back to my courses
            </a>
          </p>
        </header>
      </main>
    )
  }

  // Default: render the wizard.
  const currentStep = parseRequestedUploadStep(sp.step, draft)
  return (
    <main className={styles.page}>
      <UploadShell currentStep={currentStep} draft={draft} categories={categories} />
    </main>
  )
}
