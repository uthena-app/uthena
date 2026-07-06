// LedgerFilters.tsx — client island for /partner/payouts.
//
// Renders:
//   - Status filter chip strip (Accruing / Pending / Locked /
//     Available / Paid / Void). Active chip renders an ✕ that
//     clears the filter on click.
//   - Kind filter chip strip (Sale / Sub / Refund / Adjust /
//     Payout / Clawback). Same toggle shape.
//   - Sort dropdown (date desc / amount desc / kind asc). Default
//     'date' is hidden from the URL so the canonical URL stays
//     clean.
//
// All three groups share the same URL-preservation logic: when one
// chip or the dropdown changes, the OTHER groups' URL params
// survive. This makes filter combos shareable (Back/Forward work,
// the spec's acceptance criterion #7).
//
// Why a client island and not pure RSC + <Link>s: the page is RSC
// (data layer + summary + table) and the chips are the only piece
// of interactivity. One small island keeps the bundle cost minimal
// — no extra deps, just `next/navigation`'s hooks.

'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  LEDGER_STATUS_CHIP_LABEL,
  LEDGER_KIND_CHIP_LABEL,
} from '@features/payouts/format'
import {
  LEDGER_STATUS_VALUES,
  LEDGER_KIND_VALUES,
  type LedgerSort,
} from '@features/payouts/filter-options'
import styles from './LedgerFilters.module.css'

const SORT_OPTIONS: Array<{ key: LedgerSort; label: string }> = [
  { key: 'date', label: 'Newest first' },
  { key: 'amount', label: 'Biggest amount' },
  { key: 'kind', label: 'By kind' },
]

export function LedgerFilters({
  currentStatus,
  currentKind,
  currentSort,
}: {
  // `string | undefined` rather than `?:` so callers can pass the
  // narrow union types (status/kind) directly without the
  // exactOptionalPropertyTypes strictness rejecting a typed-undefined
  // value at the call site.
  currentStatus?: string | undefined
  currentKind?: string | undefined
  currentSort: LedgerSort
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Build the URL with a single param toggled. Preserves the other
  // two so filter combinations are shareable (spec criterion #7).
  function buildUrl(toggle: { key: 'status' | 'kind' | 'sort'; value: string | null }): string {
    const params = new URLSearchParams()
    const cur: Record<string, string | undefined> = {
      status: currentStatus,
      kind: currentKind,
      sort: currentSort === 'date' ? undefined : currentSort,
    }
    cur[toggle.key] = toggle.value ?? undefined
    for (const [k, v] of Object.entries(cur)) {
      if (v) params.set(k, v)
    }
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  function push(toggle: { key: 'status' | 'kind' | 'sort'; value: string | null }) {
    router.push(buildUrl(toggle))
  }

  return (
    <div className={styles.bar} role="group" aria-label="Ledger filters">
      <ChipGroup
        legend="Status"
        ariaLabel="Filter by status"
        values={LEDGER_STATUS_VALUES}
        labelMap={LEDGER_STATUS_CHIP_LABEL}
        active={currentStatus}
        onToggle={(value) =>
          push({ key: 'status', value: currentStatus === value ? null : value })
        }
      />
      <ChipGroup
        legend="Kind"
        ariaLabel="Filter by kind"
        values={LEDGER_KIND_VALUES}
        labelMap={LEDGER_KIND_CHIP_LABEL}
        active={currentKind}
        onToggle={(value) =>
          push({ key: 'kind', value: currentKind === value ? null : value })
        }
      />
      <label className={styles.sort}>
        <span className={styles.sortLabel}>Sort</span>
        <select
          className={styles.sortSelect}
          value={currentSort}
          onChange={(e) => push({ key: 'sort', value: e.target.value === 'date' ? null : e.target.value })}
          aria-label="Sort ledger"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function ChipGroup<K extends string>({
  legend,
  ariaLabel,
  values,
  labelMap,
  active,
  onToggle,
}: {
  legend: string
  ariaLabel: string
  values: readonly K[]
  labelMap: Record<string, string>
  active?: string | undefined
  onToggle: (value: K) => void
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.chips} role="group" aria-label={ariaLabel}>
        {values.map((value) => {
          const isActive = active === value
          return (
            <button
              key={value}
              type="button"
              className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
              aria-pressed={isActive}
              onClick={() => onToggle(value)}
            >
              {labelMap[value] ?? value}
              {isActive && (
                <span aria-hidden="true" className={styles.chipClear}>
                  ✕
                </span>
              )}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}