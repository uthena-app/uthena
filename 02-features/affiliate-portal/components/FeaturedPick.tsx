// FeaturedPick — P13.8 public mini-shop featured product card.
//
// Renders the one product the affiliate has marked as `is_featured`
// (per the curated read in getMiniShop.ts). Per spec acceptance #5:
// the "Why I picked this" note renders with attribution to the
// affiliate — we render the note as a blockquote tagged with the
// affiliate's display name.
//
// When the affiliate has 0 curated products, the page renders the
// `<MiniShopEmptyState>` component instead of this one. When they
// have 1 curated product, this component always renders (the
// "auto-featured" semantics in the spec — the data is already
// is_featured=true in the database because the page is read-only
// today; the editor in /affiliate/shop is what flips the flag).
//
// RSC, zero client JS.

import Link from 'next/link'
import { formatMoneyShort, type Currency } from '@foundations/money/cents'
import type { CuratedProduct, ShopAffiliate } from '../queries/getMiniShop'
import styles from './FeaturedPick.module.css'

/** Narrow an arbitrary string from the products pricing row to the
 *  canonical Currency union ('USD' | 'EUR' | 'GBP'). Unrecognized
 *  codes (incl. empty string) fall back to 'USD' so the page
 *  always renders a valid currency label. Mirrors the same
 *  narrowing in CuratedCollection. */
function narrowCurrency(raw: string): Currency {
  return raw === 'USD' || raw === 'EUR' || raw === 'GBP' ? raw : 'USD'
}

export function FeaturedPick({
  product,
  affiliateHandle,
  displayName,
  miniShopPath,
}: {
  product: CuratedProduct
  affiliateHandle: string
  displayName: string
  miniShopPath: string
}) {
  const productHref = `/products/${product.productSlug}?ref=${encodeURIComponent(affiliateHandle)}`
  const note = product.whyIPickedThis?.trim() || null
  const eyebrowLabel = note ? `${displayName}'s pick` : 'Featured'
  const fallbackNote = `Recommended by ${displayName}.`

  return (
    <article
      className={styles.card}
      aria-label={`Featured product: ${product.productTitle}`}
    >
      <div className={styles.cover}>
        {product.productThumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.productThumbnailUrl}
            alt=""
            className={styles.thumb}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden />
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.eyebrow}>{eyebrowLabel}</span>
        <h2 className={styles.title}>
          <Link href={productHref} className={styles.titleLink}>
            {product.productTitle}
          </Link>
        </h2>
        {product.productShortDescription && (
          <p className={styles.shortDescription}>{product.productShortDescription}</p>
        )}
        <blockquote className={styles.note}>
          <p className={styles.noteText}>
            {note ?? fallbackNote}
          </p>
          <footer className={styles.noteAttribution}>— {displayName}</footer>
        </blockquote>
        <div className={styles.priceRow}>
          {product.startingPriceCents !== null ? (
            <span className={styles.price}>
              From {formatMoneyShort(
                product.startingPriceCents,
                narrowCurrency(product.currency),
              )}
            </span>
          ) : (
            <span className={styles.pricePlaceholder}>View product</span>
          )}
          <Link href={productHref} className={styles.cta} prefetch={false}>
            View product
            <span aria-hidden className={styles.ctaArrow}>→</span>
          </Link>
        </div>
        <p className={styles.attributionNote}>
          Purchase attributed to <span className={styles.handleChip}>@{affiliateHandle}</span>
          {' '}via {miniShopPath}
        </p>
      </div>
    </article>
  )
}
