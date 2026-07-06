// /partner/courses — RSC. List of the partner's products.
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requirePartner } from '@foundations/auth/guards'
import { getMyPartnerProducts } from '@features/partner-portal/queries/getMyPartnerProducts'
import { PartnerProductStatusBadge } from '@features/partner-portal/components/StatusBadge'
import { PartnerShell } from '@features/partner-portal/PartnerShell'
import { sensitivePageMetadata } from '@foundations/metadata'
import { formatMoney } from '@foundations/money/cents'
import styles from './courses.module.css'

// P0.21 — `noindex` so the partner courses list isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'My courses',
  description: 'Your Uthena partner courses — sales, status, review queue.',
  path: '/partner/courses',
})

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const KIND_LABELS: Record<string, string> = {
  video_course: 'Video course',
  ebook: 'eBook',
  template_pack: 'Template pack',
  audio_course: 'Audio course',
  bundle: 'Bundle',
  asset_pack: 'Asset pack',
}

// P6.2 — currency for the per-product revenue display. The whole
// app is USD-only in v1 (Stripe is single-currency); if/when we
// add multi-currency, this constant lifts to per-product.
const PARTNER_KPI_CURRENCY = 'USD' as const

export default async function PartnerCoursesPage() {
  await requirePartner()
  const products = await getMyPartnerProducts()
  if (products === null) redirect('/partner/onboarding')

  return (
    <PartnerShell>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.h1}>My courses</h1>
            <p className={styles.lede}>
              Manage the products you&apos;ve uploaded. New uploads go to admin review
              before publishing.
            </p>
          </div>
          <Link href="/partner/instructor-upload" className={styles.uploadBtn}>
            + Upload a course
          </Link>
        </header>

        {products.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>You haven&apos;t uploaded any products yet.</p>
            <p className={styles.emptyLede}>
              Once you upload a product, it shows up here for review and management.
            </p>
            <Link href="/partner/instructor-upload" className={styles.uploadBtn}>
              Upload your first product →
            </Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {products.map((p) => (
              <li key={p.id} className={styles.row}>
                <div className={styles.thumbCol}>
                  {p.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail_url} alt="" className={styles.thumb} />
                  ) : (
                    <div className={styles.thumbPlaceholder} aria-hidden>
                      {p.title.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className={styles.bodyCol}>
                  <p className={styles.title}>{p.title}</p>
                  <p className={styles.shortDesc}>{p.short_description}</p>
                  <p className={styles.meta}>
                    {KIND_LABELS[p.kind] ?? p.kind} · updated {formatDate(p.updated_at)}
                  </p>
                </div>
                {/* P6.2 — per-product revenue aggregates (resolves STUB-035). */}
                {/* Both columns are right-aligned, monospace numbers, hidden */}
                {/* on mobile via the responsive grid collapse below. */}
                <div
                  className={styles.unitsCol}
                  aria-label={
                    p.units_sold === 0
                      ? 'No units sold yet'
                      : `${p.units_sold} ${p.units_sold === 1 ? 'unit' : 'units'} sold`
                  }
                >
                  <span className={styles.metricLabel}>Sold</span>
                  <span className={styles.metricValue}>
                    {p.units_sold.toLocaleString('en-US')}
                  </span>
                </div>
                <div
                  className={styles.revenueCol}
                  aria-label={
                    p.total_sales_cents === 0
                      ? 'No revenue yet'
                      : `Lifetime revenue ${formatMoney(p.total_sales_cents, PARTNER_KPI_CURRENCY)}`
                  }
                >
                  <span className={styles.metricLabel}>Revenue</span>
                  <span className={styles.metricValue}>
                    {formatMoney(p.total_sales_cents, PARTNER_KPI_CURRENCY)}
                  </span>
                </div>
                <div className={styles.statusCol}>
                  <PartnerProductStatusBadge status={p.status} />
                </div>
                <div className={styles.actionCol}>
                  <Link href={`/partner/courses/${p.id}`} className={styles.openBtn}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PartnerShell>
  )
}