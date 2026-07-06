// DownloadHistoryFilters.tsx — client island for the /library/downloads
// page filter strip. Two filter dimensions:
//   - kind: 'all' | 'download' | 'stream'
//   - window: '30' | '90' | '365' | 'all' (days back from now)
//
// The component owns the URL state — pushes a new URL when a chip is
// clicked, syncs from the URL on mount, and stays in sync on Back/Forward
// via the popstate listener. The page (RSC) reads the URL params on
// every render and re-runs getDownloadHistory().
//
// Why a client island instead of <Link>s?
//   - Three filters × the active-state logic per chip × the chips-with-
//     clear-X affordance is ~70 lines of state. Lifting to RSC would
//     require a searchParams round-trip on every chip click; a client
//     island + `router.push` is faster + the URL is the source of truth.
//   - The same pattern as BrowseSortSelect (P0.16) — proven in this
//     codebase, no need to invent.

'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { FileDownloadKind } from '@foundations/data/enums'
import styles from './DownloadHistoryFilters.module.css'

type KindFilter = FileDownloadKind | 'all'
type WindowFilter = '30' | '90' | '365' | 'all'

const KIND_OPTIONS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'download', label: 'Downloads' },
  { value: 'stream', label: 'Streams' },
]

const WINDOW_OPTIONS: ReadonlyArray<{ value: WindowFilter; label: string }> = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last year' },
  { value: 'all', label: 'All time' },
]

export function DownloadHistoryFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [kind, setKind] = useState<KindFilter>(parseKind(params.get('kind')))
  const [windowDays, setWindowDays] = useState<WindowFilter>(parseWindow(params.get('days')))

  // Sync state when the URL changes externally (Back/Forward, hard nav,
  // clear-all chip). useEffect is keyed on the params string so it
  // only runs when the URL actually changes — not on every render.
  useEffect(() => {
    setKind(parseKind(params.get('kind')))
    setWindowDays(parseWindow(params.get('days')))
  }, [params])

  function push(nextKind: KindFilter, nextWindow: WindowFilter) {
    const search = new URLSearchParams()
    // Default-strip: omit kind when 'all', omit days when '365' (the
    // most common case). The result URL stays clean — `/library/downloads`
    // instead of `/library/downloads?kind=all&days=365`.
    if (nextKind !== 'all') search.set('kind', nextKind)
    if (nextWindow !== '365') search.set('days', nextWindow)
    const qs = search.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function onKindClick(value: KindFilter) {
    if (value === kind) return
    setKind(value)
    push(value, windowDays)
  }

  function onWindowClick(value: WindowFilter) {
    if (value === windowDays) return
    setWindowDays(value)
    push(kind, value)
  }

  return (
    <div className={styles.wrap} role="toolbar" aria-label="Download history filters">
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Kind</legend>
        <div className={styles.chips}>
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onKindClick(opt.value)}
              className={styles.chip}
              data-active={kind === opt.value}
              aria-pressed={kind === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Window</legend>
        <div className={styles.chips}>
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onWindowClick(opt.value)}
              className={styles.chip}
              data-active={windowDays === opt.value}
              aria-pressed={windowDays === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

function parseKind(raw: string | null): KindFilter {
  if (raw === 'download' || raw === 'stream') return raw
  return 'all'
}

function parseWindow(raw: string | null): WindowFilter {
  if (raw === '30' || raw === '90' || raw === '365' || raw === 'all') return raw
  return '365'
}
