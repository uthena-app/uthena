// Product card — used in the home grid, browse grid, collection page.
// Server component. Mockup parity with `mockups/home.html` lines
// 101–207: cover with license pill, body with category + module
// count, title, stars + review count, price + strikethrough + save%.

import Link from 'next/link'
import { formatMoneyShort } from '@foundations/money/cents'
import { formatLessonCount, formatStarRow, formatSavePct } from '@features/catalog/format'
import type { LicenseTier, ProductListItem } from '@features/catalog/queries'
import styles from './ProductCard.module.css'

/** Map a license tier slug to the user-visible pill label. */
const LICENSE_LABELS: Record<LicenseTier, string> = {
  plr: 'PLR',
  mrr: 'MRR',
  rr: 'RR',
  personal: 'Personal',
}

export function ProductCard({
  product,
  subscriptionIncluded = false,
}: {
  product: ProductListItem
  /**
   * True when the current user gets this product via their active
   * Personal Access subscription (P8.2). Drives the teal
   * "Included with Personal Access" pill rendered between the
   * meta row and the title. Anon / non-subscriber callers pass
   * `false` (default) — no badge renders.
   */
  subscriptionIncluded?: boolean
}) {
  const savePct = formatSavePct(product.starting_price_cents, product.msrp_cents)
  const starRow = product.review_count > 0 ? formatStarRow(product.avg_rating) : ''
  const licenseLabel = product.default_license
    ? LICENSE_LABELS[product.default_license]
    : null

  return (
    <Link
      href={`/products/${product.slug}`}
      className={styles.card}
      aria-label={
        subscriptionIncluded
          ? `View ${product.title} — included with Personal Access`
          : `View ${product.title}`
      }
    >
      <div className={styles.cover}>
        {product.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail_url}
            alt=""
            className={styles.thumb}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden />
        )}
        {licenseLabel && (
          <span
            className={`${styles.lic} ${
              product.default_license === 'mrr' ? styles.licMrr : ''
            }`.trim()}
          >
            {licenseLabel}
          </span>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.metaRow}>
          {product.category && <span>{product.category.name}</span>}
          {product.total_lesson_count > 0 && (
            <span>{formatLessonCount(product.total_lesson_count).replace('lessons', 'modules').replace('lesson', 'module')}</span>
          )}
        </div>
        {subscriptionIncluded && (
          <span className={styles.includedBadge} aria-label="Included with Personal Access subscription">
            <span className={styles.includedCheck} aria-hidden>
              ✓
            </span>
            Included with Personal Access
          </span>
        )}
        <div className={styles.title}>{product.title}</div>
        {starRow && (
          <div className={styles.stars}>
            <span aria-hidden>{starRow}</span>
            <span className={styles.starsCt}>({product.review_count})</span>
            <span className={styles.srOnly}>
              {product.avg_rating?.toFixed(1) ?? '0'} out of 5 stars from{' '}
              {product.review_count} reviews
            </span>
          </div>
        )}
        {product.starting_price_cents != null && (
          <div className={styles.price}>
            <b className={styles.priceNow}>{formatMoneyShort(product.starting_price_cents, product.currency)}</b>
            {product.msrp_cents != null && product.msrp_cents > product.starting_price_cents && (
              <s className={styles.priceWas}>
                {formatMoneyShort(product.msrp_cents, product.currency)}
              </s>
            )}
            {savePct != null && <span className={styles.save}>-{savePct}%</span>}
          </div>
        )}
      </div>
    </Link>
  )
}
