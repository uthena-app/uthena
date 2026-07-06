// CategoryTreeFilter.tsx — client component. Search input (debounced
// 200ms) and "hide empty" toggle. The actual filtering is done in the
// parent's render (we lift state up so the tree re-renders). On every
// change we update the URL search params (?q=...&hideEmpty=1) so the
// filter survives reloads.

'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import styles from './CategoryTreeFilter.module.css'

export function CategoryTreeFilter({
  initialQuery,
  initialHideEmpty,
  onChange,
}: {
  initialQuery: string
  initialHideEmpty: boolean
  onChange: (state: { query: string; hideEmpty: boolean }) => void
}) {
  const router = useRouter()
  const pathname = usePathname() ?? '/admin/categories'
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialQuery)
  const [hideEmpty, setHideEmpty] = useState(initialHideEmpty)

  // Debounce 200ms; reflect to URL after the debounce settles.
  useEffect(() => {
    const t = setTimeout(() => {
      onChange({ query: query.trim().toLowerCase(), hideEmpty })
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (query) params.set('q', query)
      else params.delete('q')
      if (hideEmpty) params.set('hideEmpty', '1')
      else params.delete('hideEmpty')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, 200)
    return () => clearTimeout(t)
    // We intentionally don't include `onChange` in deps to avoid
    // resetting the timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, hideEmpty])

  return (
    <div className={styles.bar}>
      <input
        type="search"
        className={styles.search}
        placeholder="Search categories…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search categories"
      />
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={hideEmpty}
          onChange={(e) => setHideEmpty(e.target.checked)}
        />
        <span>Hide empty</span>
      </label>
    </div>
  )
}
