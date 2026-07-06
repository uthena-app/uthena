// AffiliateFilters.tsx — the URL-driven filter bar above the
// affiliates table. Each filter is a plain GET <form> with hidden
// inputs — no client JS needed. Submitting re-navigates to
// /admin/affiliates with the new query string; the page re-renders.
//
// Fields (all optional, all wired into URL):
//   q (text), status (select), joinedFrom (date), joinedTo (date).

import type { ParsedAffiliateFilters } from '../types'
import styles from './AffiliateFilters.module.css'

export type AffiliateFiltersProps = {
  filters: ParsedAffiliateFilters
  /** Active sort key — preserved across submit so sort doesn't reset. */
  sort: string
}

export function AffiliateFilters({ filters, sort }: AffiliateFiltersProps) {
  return (
    <form
      className={styles.form}
      method="get"
      action="/admin/affiliates"
      aria-label="Affiliate filters"
    >
      <input type="hidden" name="sort" value={sort} />

      <label className={styles.field}>
        <span className={styles.label}>Search</span>
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder="Handle, name or email"
          className={styles.input}
          maxLength={100}
          autoComplete="off"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Status</span>
        <select name="status" defaultValue={filters.status ?? ''} className={styles.input}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="suspended">Suspended</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Joined from</span>
        <input
          type="date"
          name="joinedFrom"
          defaultValue={filters.joinedFrom ?? ''}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Joined to</span>
        <input
          type="date"
          name="joinedTo"
          defaultValue={filters.joinedTo ?? ''}
          className={styles.input}
        />
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit}>
          Apply
        </button>
        <a href="/admin/affiliates" className={styles.reset}>
          Reset
        </a>
      </div>
    </form>
  )
}