// LibraryProductHeader.tsx — the top section of /library/[slug].
// RSC. Shows:
//   - Breadcrumb (Home / Library / <product title>)
//   - Thumbnail + product title + partner + short description
//   - Source pill (Personal Access / Purchased / Granted / Free promo)
//   - Back-to-library link
//
// Why a dedicated component: the page composes 4 sections (header +
// files + sharing + lessons/certificate placeholders). Keeping the
// header in its own file mirrors the public PDP split (ProductGallery
// + ProductRatingRow + ProductPriceBlock + LicenseSelector are
// separate). The page route stays thin.
//
// No client JS. All static + RSC-rendered strings.

import Link from 'next/link'
import type { AccessSource, LibraryProductSummary } from '../queries/getLibraryProduct'
import styles from './LibraryProductHeader.module.css'

const SOURCE_LABEL: Record<AccessSource, string> = {
  purchase: 'Purchased',
  admin_grant: 'Granted',
  free_promo: 'Free promo',
  subscription: 'Personal Access',
}

const KIND_LABEL: Record<LibraryProductSummary['kind'], string> = {
  video_course: 'Video course',
  ebook: 'eBook',
  template_pack: 'Template pack',
  audio_course: 'Audio course',
  bundle: 'Bundle',
  asset_pack: 'Asset pack',
}

export type LibraryProductHeaderProps = {
  product: LibraryProductSummary
  access: { source: AccessSource; granted_at: string }
}

export function LibraryProductHeader({ product, access }: LibraryProductHeaderProps) {
  return (
    <header className={styles.wrap}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/" className={styles.crumb}>Home</Link>
        <span className={styles.crumbSep} aria-hidden>/</span>
        <Link href="/library" className={styles.crumb}>My library</Link>
        <span className={styles.crumbSep} aria-hidden>/</span>
        <span className={styles.crumbCurrent} aria-current="page">{product.title}</span>
      </nav>

      <div className={styles.layout}>
        {product.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail_url}
            alt=""
            className={styles.thumb}
          />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden />
        )}

        <div className={styles.body}>
          <p className={styles.kind}>{KIND_LABEL[product.kind] ?? product.kind}</p>
          <h1 className={styles.title}>{product.title}</h1>
          {product.partner_display_name && (
            <p className={styles.partner}>by {product.partner_display_name}</p>
          )}
          <p className={styles.desc}>{product.short_description}</p>
          <div className={styles.meta}>
            <span className={styles.sourcePill} data-source={access.source}>
              {SOURCE_LABEL[access.source] ?? access.source}
            </span>
            {product.total_lesson_count > 0 && (
              <span className={styles.metaItem}>
                {product.total_lesson_count} lessons
              </span>
            )}
          </div>
          <div className={styles.actions}>
            <Link href="/library" className={styles.backLink}>
              ← Back to library
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}