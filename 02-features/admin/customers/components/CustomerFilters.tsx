// CustomerFilters.tsx — the URL-driven filter bar above the customers
// table. Each filter is a plain GET <form> with hidden inputs — no
// client JS needed. Submitting re-navigates to /admin/customers with
// the new query string; the page re-renders.
//
// Fields (all optional, all wired into URL):
//   q (text), role (select), status (select), signupFrom (date),
//   signupTo (date), spendMinCents (number), spendMaxCents (number),
//   riskMin (number 0-100), riskMax (number 0-100).

import type { ParsedCustomerFilters } from '../types'
import styles from './CustomerFilters.module.css'

export type CustomerFiltersProps = {
  filters: ParsedCustomerFilters
  /** Active sort key — preserved across submit so sort doesn't reset. */
  sort: string
}

export function CustomerFilters({ filters, sort }: CustomerFiltersProps) {
  return (
    <form
      className={styles.form}
      method="get"
      action="/admin/customers"
      aria-label="Customer filters"
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
        <span className={styles.label}>Role</span>
        <select name="role" defaultValue={filters.role ?? ''} className={styles.input}>
          <option value="">All</option>
          <option value="customer">Customer</option>
          <option value="partner">Partner</option>
          <option value="affiliate">Affiliate</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Status</span>
        <select name="status" defaultValue={filters.status ?? ''} className={styles.input}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Signed up from</span>
        <input
          type="date"
          name="signupFrom"
          defaultValue={filters.signupFrom ?? ''}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Signed up to</span>
        <input
          type="date"
          name="signupTo"
          defaultValue={filters.signupTo ?? ''}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Spend min (¢)</span>
        <input
          type="number"
          name="spendMinCents"
          defaultValue={filters.spendMinCents ?? ''}
          min={0}
          step={1}
          placeholder="0"
          className={styles.input}
          inputMode="numeric"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Spend max (¢)</span>
        <input
          type="number"
          name="spendMaxCents"
          defaultValue={filters.spendMaxCents ?? ''}
          min={0}
          step={1}
          placeholder="∞"
          className={styles.input}
          inputMode="numeric"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Risk min</span>
        <input
          type="number"
          name="riskMin"
          defaultValue={filters.riskMin ?? ''}
          min={0}
          max={100}
          step={1}
          placeholder="0"
          className={styles.input}
          inputMode="numeric"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Risk max</span>
        <input
          type="number"
          name="riskMax"
          defaultValue={filters.riskMax ?? ''}
          min={0}
          max={100}
          step={1}
          placeholder="100"
          className={styles.input}
          inputMode="numeric"
        />
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit}>
          Apply
        </button>
        <a href="/admin/customers" className={styles.reset}>
          Reset
        </a>
      </div>
    </form>
  )
}