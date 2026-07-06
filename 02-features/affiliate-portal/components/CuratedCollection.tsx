// CuratedCollection — P13.8 public mini-shop curated products grid.
//
// Renders the affiliate's curated list (excluding the featured
// product — that's surfaced separately by <FeaturedPick>) as a
// responsive grid of product cards. Each card links to
// /products/[slug]?ref=[handle] so the purchase is attributed to
// this affiliate (per spec acceptance #6 + #7).
//
// When the collection is empty, the parent page renders
// `<MiniShopEmptyState>` instead. This component assumes a non-
// empty array.
//
// RSC, zero client JS.

import Link from 'next/link'
import { formatMoneyShort, type Currency } from '@foundations/money/cents'
import type { CuratedProduct } from '../queries/getMiniShop'
import styles from './CuratedCollection.module.css'

/** Narrow an arbitrary string from the products pricing row to the
 *  canonical Currency union ('USD' | 'EUR' | 'GBP'). Unrecognized
 *  codes (incl. empty string) fall back to 'USD' so the page
 *  always renders a valid currency label. */
function narrowCurrency(raw: string): Currency {
  return raw === 'USD' || raw === 'EUR' || raw === 'GBP' ? raw : 'USD'
}

export function CuratedCollection({
  products,
  affiliateHandle,
}: {
  products: ReadonlyArray<CuratedProduct>
  affiliateHandle: string
}) {
  return (
    <section
      className={styles.section}
      aria-labelledby="minishop-collection-heading"
    >
      <header className={styles.header}>
        <span className={styles.eyebrow}>Curated by this affiliate</span>
        <h2 id="minishop-collection-heading" className={styles.h2}>
          More from @{affiliateHandle}
        </h2>
      </header>
      <ul className={styles.grid} role="list">
        {products.map((product) => (
          <CuratedCard
            key={product.curatedId}
            product={product}
            affiliateHandle={affiliateHandle}
          />
        ))}
      </ul>
    </section>
  )
}

function CuratedCard({
  product,
  affiliateHandle,
}: {
  product: CuratedProduct
  affiliateHandle: string
}) {
  const productHref = `/products/${product.productSlug}?ref=${encodeURIComponent(affiliateHandle)}`
  const note = product.whyIPickedThis?.trim() || null

  return (
    <li className={styles.cardLi}>
      <Link href={productHref} className={styles.card} prefetch={false}>
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
          <h3 className={styles.title}>{product.productTitle}</h3>
          {product.productShortDescription && (
            <p className={styles.shortDescription}>
              {product.productShortDescription}
            </p>
          )}
          {note && (
            <p className={styles.note}>
              <span className={styles.noteQuoteMark} aria-hidden>
                “
              </span>
              {note}
            </p>
          )}
          <div className={styles.priceRow}>
            {product.startingPriceCents !== null ? (
              <span className={styles.price}>
                {formatMoneyShort(
                  product.startingPriceCents,
                  narrowCurrency(product.currency),
                )}
              </span>
            ) : (
              <span className={styles.pricePlaceholder}>View product →</span>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}
