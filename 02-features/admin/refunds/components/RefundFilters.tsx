// RefundFilters.tsx — URL-driven filter bar above the refund queue
// list. Each filter is a plain GET <form> with hidden inputs — no
// client JS needed. Submitting re-navigates to /admin/refunds with
// the new query string; the page re-renders.
//
// Fields (all optional, all wired into URL per spec line 17):
//   status (select — the 5 enum values; "All" is the default), from
//   (date), to (date), customerEmail (text), productId (number).
//
// The product ID filter renders as a small number input; per STUB-122
// the full dropdown population lands in Slice 2 — the input is the
// v1 ergonomic compromise so admins can still filter by product
// without a populated option list.

import { REFUND_STATUSES } from '@foundations/data/enums'
import { REFUND_STATUS_LABEL, type ParsedRefundFilters } from '../types'
import styles from './RefundFilters.module.css'

export type RefundFiltersProps = {
  filters: ParsedRefundFilters
}

export function RefundFilters({ filters }: RefundFiltersProps) {
  return (
    <form
      className={styles.form}
      method="get"
      action="/admin/refunds"
      aria-label="Refund filters"
    >
      <label className={styles.field}>
        <span className={styles.label}>Status</span>
        <select
          name="status"
          defaultValue={filters.status ?? ''}
          className={styles.input}
        >
          <option value="">All</option>
          {REFUND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REFUND_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>From</span>
        <input
          type="date"
          name="from"
          defaultValue={filters.from ?? ''}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>To</span>
        <input
          type="date"
          name="to"
          defaultValue={filters.to ?? ''}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Customer email</span>
        <input
          type="search"
          name="customerEmail"
          defaultValue={filters.customerEmail ?? ''}
          placeholder="name@example.com"
          className={styles.input}
          maxLength={100}
          autoComplete="off"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Product ID</span>
        <input
          type="number"
          name="productId"
          defaultValue={filters.productId ?? ''}
          placeholder="—"
          className={styles.input}
          min={1}
          step={1}
        />
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.submit}>
          Apply
        </button>
        <a href="/admin/refunds" className={styles.reset}>
          Reset
        </a>
      </div>
    </form>
  )
}