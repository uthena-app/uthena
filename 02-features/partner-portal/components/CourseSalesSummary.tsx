// CourseSalesSummary.tsx — RSC for the Sales tab on the partner course
// detail page (`/partner/courses/[id]?tab=sales`).
//
// P12.11 Slice 1: the four "summary stats" acceptance criterion from
// `01-specs/pages/partner-courses-detail.md` — revenue_period, units
// sold_period, refund rate_period, avg rating_period — rendered with
// real data via the `get_partner_course_sales_summary` RPC (migration
// 0042). The Daily revenue chart, top-5 buyer countries, and the
// per-order drill-down table are deferred to P12.11 Slices 2-3 per
// STUB-097. The visible "View full sales table" link points at the
// future drill-down page (`/partner/courses/[id]/sales`) — clicking
// it today returns 404 from the not-found.tsx until Slice 2 lands.

import type { PartnerCourseSalesSummary } from '../queries/getMyCourseSalesSummary'
import styles from './CourseSalesSummary.module.css'

/** Format bigint cents as `$X.XX` (USD-only per the partner-courses
 *  detail spec; multi-currency is explicitly out of scope for v1).
 *  Returns "$0.00" for falsy / 0 values. Stable ordering: rounds half
 *  away from zero via `.toLocaleString` (en-US) — acceptable for
 *  display only; the underlying bigint is preserved in the data
 *  layer and never rounded. */
function formatUSD(cents: number): string {
  if (!Number.isFinite(cents)) return '$0.00'
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Format a rating in [1, 5] as `<n>/5` with one decimal. Returns
 *  null when there's no published rating yet (the caller renders the
 *  "No reviews yet" copy in that case). */
function formatRating(avg: number | null): string | null {
  if (avg == null || !Number.isFinite(avg)) return null
  return `${avg.toFixed(2)} / 5`
}

/** Format a refund rate in [0, 1] as a one-decimal percentage. The
 *  RPC returns 0 when there are no orders, so we never render `NaN`
 *  or `Infinity`. */
function formatRefundRate(rate: number): string {
  if (!Number.isFinite(rate)) return '0.0%'
  const pct = Math.min(100, Math.max(0, rate * 100))
  return `${pct.toFixed(1)}%`
}

/** Format a sale-recency string for the page footer (most-recent sale
 *  date). Returns a friendly "No sales yet." when the value is null.
 *  Days-ago math is calendar-day (UTC) — close enough for the partner
 *  audit-strip use case; we don't need timezone precision here. */
function formatRecency(
  iso: string | null,
  fallback: string,
  comparator: 'last' | 'first',
): string {
  if (!iso) return fallback
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return fallback
  const diffMs = Date.now() - t
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const abs = Math.abs(days)
  if (abs === 0) return comparator === 'last' ? 'today' : 'today'
  if (abs === 1) return comparator === 'last' ? 'yesterday' : '1 day ago'
  return comparator === 'last'
    ? `${days} days ago`
    : days < 0
      ? `in ${abs} days`
      : `${days} days ago`
}

export function CourseSalesSummary({
  productId,
  summary,
}: {
  /** The product id — used to build the drill-down link href. */
  productId: number
  /** Already fetched + ownership-checked + fail-softed summary. */
  summary: PartnerCourseSalesSummary
}) {
  const ratingLabel = formatRating(summary.avgRating)
  const hasAnySale = summary.orderCount > 0
  const hasAnyReview = summary.avgRating != null

  return (
    <section className={styles.wrap} aria-label="Course sales summary">
      <header className={styles.header}>
        <h2 className={styles.h2}>Lifetime sales</h2>
        <p className={styles.subtle}>
          Lifetime aggregates for this product. Date-range filters and
          the per-order table land in a follow-up slice (see the link
          below).
        </p>
      </header>

      <ul className={styles.statGrid}>
        <li className={styles.statCard}>
          <span className={styles.statLabel}>Revenue</span>
          <span className={styles.statValue} data-testid="course-sales-revenue">
            {formatUSD(summary.revenueCents)}
          </span>
          <span className={styles.statHint}>
            {hasAnySale
              ? `${summary.orderCount} ${summary.orderCount === 1 ? 'order' : 'orders'}`
              : 'No paid orders yet'}
          </span>
        </li>

        <li className={styles.statCard}>
          <span className={styles.statLabel}>Units sold</span>
          <span className={styles.statValue} data-testid="course-sales-units">
            {summary.unitsSold.toLocaleString('en-US')}
          </span>
          <span className={styles.statHint}>
            {hasAnySale
              ? `Across ${summary.orderCount} ${summary.orderCount === 1 ? 'order' : 'orders'}`
              : 'No paid units yet'}
          </span>
        </li>

        <li className={styles.statCard}>
          <span className={styles.statLabel}>Refund rate</span>
          <span className={styles.statValue} data-testid="course-sales-refund-rate">
            {formatRefundRate(summary.refundRate)}
          </span>
          <span className={styles.statHint}>
            {summary.refundCount === 0
              ? hasAnySale
                ? 'No refunds on this product'
                : 'No orders to compare'
              : `${summary.refundCount} ${summary.refundCount === 1 ? 'refund' : 'refunds'} of ${summary.orderCount} ${summary.orderCount === 1 ? 'order' : 'orders'}`}
          </span>
        </li>

        <li className={styles.statCard}>
          <span className={styles.statLabel}>Average rating</span>
          <span className={styles.statValue} data-testid="course-sales-avg-rating">
            {ratingLabel ?? 'No reviews yet'}
          </span>
          <span className={styles.statHint}>
            {hasAnyReview
              ? 'Published reviews only — pending / hidden / flagged are excluded'
              : 'Reviews appear once a buyer leaves one'}
          </span>
        </li>
      </ul>

      <p className={styles.footer}>
        {summary.lastSaleAt ? (
          <>
            Most recent sale:{' '}
            <strong className={styles.footerValue}>
              {formatRecency(summary.lastSaleAt, 'No sales yet', 'last')}
            </strong>
            {summary.firstSaleAt ? (
              <>
                {' · '}first sale:{' '}
                <strong className={styles.footerValue}>
                  {formatRecency(summary.firstSaleAt, '—', 'first')}
                </strong>
              </>
            ) : null}
          </>
        ) : (
          <span className={styles.footerMuted}>No sales recorded for this product.</span>
        )}
      </p>

      <p className={styles.drillLinkRow}>
        <a
          href={`/partner/courses/${productId}/sales`}
          className={styles.drillLink}
        >
          View full sales table →
        </a>
        <span className={styles.drillLinkHint}>
          Per-order table, date / tier / status filters, and CSV
          export — coming in the next slice.
        </span>
      </p>
    </section>
  )
}
