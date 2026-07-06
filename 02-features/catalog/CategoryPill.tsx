// CategoryPill — chip-shaped link used on the home category strip,
// the search results active filter row, and the browse active filter
// row. Server component, no client JS.
//
// Two variants:
//   - "link" (default): pill that links to /collections/[slug]. Used
//     on the home page category strip and anywhere a category is
//     being introduced to the user.
//   - "filter": pill that shows the current active filter with a
//     trailing "✕" glyph linking to the URL with the filter removed.
//     Used by the browse page and search results page when a category
//     filter is active.
//
// Count badge is optional (the browse sidebar's "All" entry has
// no count; the home strip's category entries do). When the count
// is undefined the badge slot is omitted entirely — no empty
// placeholder — so the pill collapses to name-only.
//
// Token-only styling lives in CategoryPill.module.css.

import Link from 'next/link'
import styles from './CategoryPill.module.css'

export interface CategoryPillProps {
  /** Display name (e.g. "AI", "Marketing"). */
  name: string
  /** Category slug — used to build the `/collections/[slug]` href. */
  slug: string
  /** Product count to render in the mono-number badge. Omit to hide. */
  count?: number
  /**
   * `link` (default) renders as a pill linking to the category page.
   * `filter` renders as an active-filter chip with a trailing ✕ that
   * links to `clearHref` to remove the filter.
   */
  variant?: 'link' | 'filter'
  /**
   * Required for `filter` variant. The URL the ✕ glyph links to (the
   * same path with the category param stripped). Ignored by the
   * `link` variant.
   */
  clearHref?: string
}

export function CategoryPill({
  name,
  slug,
  count,
  variant = 'link',
  clearHref,
}: CategoryPillProps) {
  if (variant === 'filter') {
    if (!clearHref) {
      // Defensive: a filter pill without a clear target is a wiring
      // bug. Render the name-only pill but skip the ✕ instead of
      // emitting a broken link.
      return (
        <span className={`${styles.pill} ${styles.filter}`} aria-label={`Active filter: ${name}`}>
          <span className={styles.name}>{name}</span>
          {count != null && <span className={styles.count}>{count}</span>}
        </span>
      )
    }
    return (
      <span className={`${styles.pill} ${styles.filter}`}>
        <span className={styles.name}>{name}</span>
        {count != null && <span className={styles.count}>{count}</span>}
        <Link
          href={clearHref}
          className={styles.clear}
          aria-label={`Remove ${name} filter`}
          scroll={false}
        >
          <span aria-hidden>✕</span>
        </Link>
      </span>
    )
  }

  return (
    <Link
      href={`/collections/${slug}`}
      className={styles.pill}
      aria-label={count != null ? `${name} (${count} courses)` : name}
    >
      <span className={styles.name}>{name}</span>
      {count != null && <span className={styles.count}>{count}</span>}
    </Link>
  )
}