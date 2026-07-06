// /partner/courses/[id] — RSC. 5-tab single-course management surface.
//
// P12.6 Slice 1: page shell + header + tab nav + Status bar +
// Settings tab fully working (title / short_description /
// long_description / category_id / kind editable, audit-logged).
// Curriculum / Pricing / Sales / Reviews tabs render "Coming in
// next slice" placeholders with the slice boundary noted.
//
// Tabs are URL-driven (?tab=settings | curriculum | pricing |
// sales | reviews) via Link components — no client-side tab state.
// This keeps the route 100% RSC: each tab content is fetched in
// the same RSC pass on the server. The next slices will swap the
// placeholder for the real RSC tab content.
//
// Auth: `requirePartner` (PartnerShell). Ownership: the page calls
// getMyCourseDetail(id) which RLS-restricts to the partner's own
// product; non-owner → notFound() (404), never leaks "this id
// exists but isn't yours".

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PartnerShell } from '@features/partner-portal/PartnerShell'
import { PartnerProductStatusBadge } from '@features/partner-portal/components/StatusBadge'
import { CourseSalesSummary } from '@features/partner-portal/components/CourseSalesSummary'
import { CourseSettingsForm } from '@features/partner-portal/components/CourseSettingsForm'
import { getMyCourseDetail, getMyCourseLastEdit } from '@features/partner-portal/queries/getMyCourseDetail'
import { getMyCourseSalesSummary } from '@features/partner-portal/queries/getMyCourseSalesSummary'
import { listPartnerCategories } from '@features/partner-portal/queries/listPartnerCategories'
import { getSessionUser } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './detail.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'Course detail',
  description: 'Manage curriculum, pricing, sales, reviews, and settings for this product.',
  path: '/partner/courses/[id]',
})

const TABS = [
  { id: 'curriculum', label: 'Curriculum' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'sales', label: 'Sales' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'settings', label: 'Settings' },
] as const

type TabId = (typeof TABS)[number]['id']

function parseTabId(raw: string | string[] | undefined): TabId {
  if (typeof raw !== 'string') return 'settings'
  const found = TABS.find((t) => t.id === raw)
  return found ? found.id : 'settings'
}

/** Format a UTC ISO timestamp as a relative-time string ("just now",
 *  "5m ago", "2h ago", "3d ago"). Mirrors the format the partner
 *  dashboard uses; localized in en-US. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diffMs = Date.now() - then
  const sec = Math.max(0, Math.floor(diffMs / 1000))
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function PartnerCourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id: idRaw } = await params
  const sp = await searchParams
  const id = Number.parseInt(idRaw, 10)
  if (!Number.isFinite(id) || id <= 0) notFound()

  const activeTab = parseTabId(sp.tab)

  const [course, categories, sessionUser, salesSummary] = await Promise.all([
    getMyCourseDetail(id),
    listPartnerCategories(),
    getSessionUser(),
    // P12.11 Slice 1 — Sales tab. The summary reads the
    // get_partner_course_sales_summary RPC (migration 0042) and is
    // fail-soft (returns the empty summary on RPC error). Fetched in
    // parallel with the rest of the page so the active-tab branch
    // renders without an extra round-trip when the tab is selected.
    getMyCourseSalesSummary(id),
  ])
  if (!course) notFound()

  const lastEdit = sessionUser ? await getMyCourseLastEdit(id, sessionUser.id) : null

  return (
    <PartnerShell>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <Link href="/partner/courses" className={styles.backLink}>
              ← All courses
            </Link>
          </div>
          <div className={styles.titleRow}>
            <h1 className={styles.h1}>{course.title}</h1>
            <PartnerProductStatusBadge status={course.status} />
          </div>
          <p className={styles.lede}>
            <span className={styles.mono}>{`/products/${course.slug}`}</span>
            {' · '}
            <span>Kind: {course.kind.replace(/_/g, ' ')}</span>
          </p>
          {lastEdit && (
            <p className={styles.auditStrip}>
              Last edit: {relativeTime(lastEdit.at)}
              {lastEdit.fieldsChanged.length > 0 ? ` (${lastEdit.fieldsChanged.join(', ')})` : ''}
            </p>
          )}
        </header>

        <nav className={styles.tabBar} aria-label="Course detail tabs">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/partner/courses/${id}?tab=${t.id}`}
              className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
              aria-current={activeTab === t.id ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <section className={styles.panel}>
          {activeTab === 'settings' ? (
            <CourseSettingsForm course={course} categories={categories} />
          ) : activeTab === 'sales' ? (
            // P12.11 Slice 1 — Sales tab. Reads
            // `salesSummary` (fetched above in parallel via
            // `getMyCourseSalesSummary`). The future drill-down
            // page `/partner/courses/[id]/sales` is linked from the
            // component itself; landing there today 404s until
            // Slice 2 ships.
            <CourseSalesSummary productId={course.id} summary={salesSummary} />
          ) : (
            <div className={styles.placeholder}>
              <p className={styles.placeholderTitle}>{TABS.find((t) => t.id === activeTab)?.label}</p>
              <p className={styles.placeholderBody}>
                This tab ships in the next slice. The Settings tab is live now — title, short description, long description, category, and kind are editable. The Sales tab shows lifetime revenue, units, refund rate, and average rating per product.
              </p>
            </div>
          )}
        </section>
      </div>
    </PartnerShell>
  )
}