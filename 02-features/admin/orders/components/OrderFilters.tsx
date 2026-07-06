// OrderFilters.tsx — URL-driven filter bar above the orders table.
// Each filter is a plain GET <form> with hidden inputs — no client JS
// needed. Submitting re-navigates to /admin/orders with the new query
// string; the page re-renders.
//
// Fields (all optional, all wired into URL per spec line 17):
//   customerEmail (text), status (select), from (date), to (date),
//   affiliateId (number), productId (number), partnerId (number).
//
// The 3 numeric filters (affiliateId / productId / partnerId) render as
// small number inputs; the spec calls for a "select" widget but per
// STUB-121 (filed with this slice), the full dropdown population lands
// in Slice 2 — the input is the v1 ergonomic compromise so admins can
// still filter by these fields without a populated option list.

import { ORDER_STATUSES, type OrderStatus } from '@foundations/data/enums'
import type { ParsedOrderFilters } from '../types'
import styles from './OrderFilters.module.css'

export type OrderFiltersProps = {
  filters: ParsedOrderFilters
}

export function OrderFilters({ filters }: OrderFiltersProps) {
  return (
    <form
      className={styles.form}
      method="get"
      action="/admin/orders"
      aria-label="Order filters"
    >
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
        <span className={styles.label}>Status</span>
        <select
          name="status"
          defaultValue={filters.status ?? ''}
          className={styles.input}
        >
          <option value="">All</option>
          {ORDER_STATUSES.map((s: OrderStatus) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
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
        <span className={styles.label}>Affiliate ID</span>
        <input
          type="number"
          name="affiliateId"
          defaultValue={filters.affiliateId ?? ''}
          placeholder="—"
          className={styles.input}
          min={1}
          step={1}
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

      <label className={styles.field}>
        <span className={styles.label}>Partner ID</span>
        <input
          type="number"
          name="partnerId"
          defaultValue={filters.partnerId ?? ''}
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
        <a href="/admin/orders" className={styles.reset}>
          Reset
        </a>
      </div>
    </form>
  )
}
