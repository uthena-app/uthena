// PartnerFilters.tsx — the URL-driven filter bar above the partners
// table. Each filter is a plain GET <form> with hidden inputs — no
// client JS needed. Submitting re-navigates to /admin/partners with
// the new query string; the page re-renders.
//
// Fields (all optional, all wired into URL):
//   q (text), status (select), kycStatus (select), taxFormStatus
//   (select), appliedFrom (date), appliedTo (date).

import type { ParsedPartnerFilters } from '../types'
import styles from './PartnerFilters.module.css'

export type PartnerFiltersProps = {
  filters: ParsedPartnerFilters
  /** Active sort key — preserved across submit so sort doesn't reset. */
  sort: string
}

export function PartnerFilters({ filters, sort }: PartnerFiltersProps) {
  return (
    <form
      className={styles.form}
      method="get"
      action="/admin/partners"
      aria-label="Partner filters"
    >
      <input type="hidden" name="sort" value={sort} />

      <label className={styles.field}>
        <span className={styles.label}>Search</span>
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder="Name or email"
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
        <span className={styles.label}>KYC status</span>
        <select
          name="kycStatus"
          defaultValue={filters.kycStatus ?? ''}
          className={styles.input}
        >
          <option value="">All</option>
          <option value="none">Not submitted</option>
          <option value="pending">Pending review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Tax form</span>
        <select
          name="taxFormStatus"
          defaultValue={filters.taxFormStatus ?? ''}
          className={styles.input}
        >
          <option value="">All</option>
          <option value="none">Not submitted</option>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Applied from</span>
        <input
          type="date"
          name="appliedFrom"
          defaultValue={filters.appliedFrom ?? ''}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Applied to</span>
        <input
          type="date"
          name="appliedTo"
          defaultValue={filters.appliedTo ?? ''}
          className={styles.input}
        />
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit}>
          Apply
        </button>
        <a href="/admin/partners" className={styles.reset}>
          Reset
        </a>
      </div>
    </form>
  )
}