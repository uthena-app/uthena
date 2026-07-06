// BrowseSortSelect — client island that wires a native <select> to the
// URL via a hidden form. On `change`, the form submits, navigating to
// the new URL with the chosen sort key as a searchParam. The page
// itself stays RSC; only this tiny island is client-side.
//
// Why a real <select> + form submit (not a custom dropdown): native
// selects are keyboard-accessible, screen-reader-announced, mobile-
// friendly (the platform picker is the best UI for a 4-option list),
// and need zero styles. The form auto-submits via a `useEffect` that
// attaches a `change` listener once on mount.
//
// Why a hidden form (not router.push directly): the parent page owns
// the URL state — the form's `action` is the bare path (`/browse`)
// so the existing `?category=&price=&density=` params in the URL are
// preserved by the browser when the form submits (browsers serialize
// the URL with the form's GET fields appended; we use the form to
// rebuild the URL from scratch by including all current params as
// hidden inputs, which is the safe pattern when an existing URL has
// unrelated params that should survive).

'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { DEFAULT_SORT, SORT_LABELS, parseSort, type SortKey } from '@features/catalog/format'
import styles from './BrowseSortSelect.module.css'

const ALL_SORT_KEYS: SortKey[] = ['newest', 'popular', 'price-asc', 'price-desc']

/** Params that should SURVIVE a sort change (i.e. not get overwritten). */
const PRESERVED_PARAMS = ['category', 'price', 'density'] as const

export function BrowseSortSelect({ current }: { current: SortKey }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectRef = useRef<HTMLSelectElement>(null)

  // Sync the <select>'s selected value when the URL changes externally
  // (e.g. the user clicks "Clear all", or hits Back). Cheap effect — one
  // DOM write per URL change.
  useEffect(() => {
    if (!selectRef.current) return
    selectRef.current.value = parseSort(searchParams.get('sort') ?? undefined)
  }, [searchParams])

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = parseSort(e.target.value)
    const params = new URLSearchParams()
    // Preserve non-sort params from the current URL
    for (const key of PRESERVED_PARAMS) {
      const v = searchParams.get(key)
      if (v) params.set(key, v)
    }
    // Add the new sort — skip when it's the default so the URL stays clean
    if (next !== DEFAULT_SORT) params.set('sort', next)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <label className={styles.wrap}>
      <span className={styles.label}>Sort</span>
      <select
        ref={selectRef}
        defaultValue={current}
        onChange={handleChange}
        className={styles.select}
        aria-label="Sort courses"
      >
        {ALL_SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </label>
  )
}
