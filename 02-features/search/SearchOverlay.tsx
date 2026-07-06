// SearchOverlay — global ⌘K instant-search modal (P0.4).
//
// Why a single client component (not a portal + remote trigger):
// - The overlay owns one DOM tree: input + results list + footer
//   hints. Splitting it across files would mean prop-drilling the
//   open state across the boundary anyway.
// - The keyboard listener lives in the same component, mounted
//   always. The cost is one global keydown handler (~30 bytes of
//   minified JS) — well under the 50 KB PR budget.
//
// Behavior contract:
//   • Opens on ⌘K (macOS) / Ctrl+K (others). Also opens when the
//     user clicks any element with `data-search-trigger` (the
//     SiteHeader's pill input is wired this way, so clicking it
//     opens the overlay instead of submitting the form).
//   • Closes on Escape, click on the backdrop, click on a result.
//   • Debounced text input (300 ms) hits /api/search?q=.
//   • Keyboard nav: ↓ / ↑ to highlight, Enter to navigate,
//     Home / End to jump to first/last. Tab is trapped inside the
//     modal so focus never leaks to the page underneath.
//   • Focus management: input is focused on open; the previously
//     focused element is restored on close.
//   • Empty input shows a "type to search" hint + the popular
//     categories as quick links.
//   • No results shows an actionable empty state ("No matches for
//     X. Try a shorter query, or browse all courses.").
//   • Loading shows 4 skeleton rows.

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  useBodyScrollLock,
  useFocusRestore,
  useFocusTrap,
} from '@foundations/ui/focus'
import { formatMoneyShort } from '@foundations/money/cents'
import { useDebouncedValue } from './useDebouncedValue'
import { SEARCH_TRIGGER_OPEN_EVENT } from './searchEvents'
import styles from './SearchOverlay.module.css'

type SearchProduct = {
  id: number
  slug: string
  title: string
  short_description: string | null
  thumbnail_url: string | null
  starting_price_cents: number | null
  category: { slug: string; name: string } | null
}

type SearchResponse = {
  q: string
  count: number
  products: SearchProduct[]
}

const POPULAR_CATEGORIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'marketing', label: 'Marketing' },
  { slug: 'ai', label: 'AI & Automation' },
  { slug: 'sales', label: 'Sales' },
  { slug: 'business', label: 'Business' },
  { slug: 'design', label: 'Design' },
]

const SEARCH_DEBOUNCE_MS = 300

export function SearchOverlay() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const [results, setResults] = useState<SearchProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState<number>(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // ----- Shared focus + scroll behavior (00-foundations/ui/focus/) ------
  // WAI-ARIA modal-dialog pattern. The overlay used to be missing a
  // Tab trap — keyboard users could Tab past the input into the
  // results, then out of the overlay entirely into the page
  // underneath. The shared trap fixes that. See P0.6.
  useBodyScrollLock(open)
  useFocusTrap(dialogRef, open)
  useFocusRestore(open)

  // ----- Open / close ---------------------------------------------------
  const openOverlay = useCallback(() => setOpen(true), [])

  const closeOverlay = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResults([])
    setActiveIdx(-1)
    // Focus restoration runs from useFocusRestore's cleanup
    // (post-unmount microtask) — no need to track it here.
  }, [])

  // ----- Global ⌘K listener --------------------------------------------
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      const isK = e.key === 'k' || e.key === 'K'
      if (!isK) return
      // ⌘K on macOS, Ctrl+K everywhere else.
      const isMod = e.metaKey || e.ctrlKey
      if (!isMod) return
      e.preventDefault()
      setOpen((prev) => !prev)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ----- Event-based trigger from header search input ------------------
  // The SiteHeader's pill input is a real form (graceful no-JS
  // fallback to /search?q=…). When JS is on, the SearchTrigger client
  // island calls `e.preventDefault()` on the click and dispatches
  // SEARCH_TRIGGER_OPEN_EVENT instead, which opens the overlay.
  useEffect(() => {
    function onTrigger() {
      openOverlay()
    }
    window.addEventListener(SEARCH_TRIGGER_OPEN_EVENT, onTrigger)
    return () => window.removeEventListener(SEARCH_TRIGGER_OPEN_EVENT, onTrigger)
  }, [openOverlay])

  // ----- Focus input when overlay opens --------------------------------
  useEffect(() => {
    if (!open) return
    // Defer to next frame so the modal is in the DOM before focus.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  // ----- Fetch results when debounced query changes --------------------
  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    if (trimmed.length === 0) {
      setResults([])
      setLoading(false)
      setActiveIdx(-1)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=8`, {
      headers: { Accept: 'application/json' },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`search ${res.status}`)
        return res.json() as Promise<SearchResponse>
      })
      .then((data) => {
        if (cancelled) return
        setResults(data.products)
        setActiveIdx(data.products.length > 0 ? 0 : -1)
      })
      .catch((err) => {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.error('[search] overlay fetch failed', err)
        setResults([])
        setActiveIdx(-1)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // ----- View state machine --------------------------------------------
  const view = useMemo<OverlayView>(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return { kind: 'idle' }
    if (loading && results.length === 0) return { kind: 'loading' }
    if (results.length === 0) return { kind: 'empty', query: trimmed }
    return { kind: 'results', items: results }
  }, [query, loading, results])

  // ----- Navigation helper ---------------------------------------------
  const goToProduct = useCallback(
    (slug: string) => {
      closeOverlay()
      router.push(`/products/${slug}`)
    },
    [closeOverlay, router],
  )

  const goToSearchPage = useCallback(
    (q: string) => {
      closeOverlay()
      router.push(`/search?q=${encodeURIComponent(q)}`)
    },
    [closeOverlay, router],
  )

  // ----- Keyboard nav inside the modal ---------------------------------
  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeOverlay()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length === 0) return
      setActiveIdx((i) => (i + 1) % results.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length === 0) return
      setActiveIdx((i) => (i <= 0 ? results.length - 1 : i - 1))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      if (results.length > 0) setActiveIdx(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      if (results.length > 0) setActiveIdx(results.length - 1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = query.trim()
      if (trimmed.length === 0) return
      // Highlighted result wins; otherwise fall through to the
      // full results page (so Enter always feels productive).
      const picked = activeIdx >= 0 ? results[activeIdx] : undefined
      if (picked) {
        goToProduct(picked.slug)
      } else {
        goToSearchPage(trimmed)
      }
    }
  }

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        // Close only when the click started on the backdrop itself,
        // not on the modal or any of its descendants.
        if (e.target === e.currentTarget) closeOverlay()
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className={styles.srOnly}>
          Search the catalog
        </h2>
        <div className={styles.inputWrap}>
          <span aria-hidden className={styles.inputIcon}>
            ⌕
          </span>
          <input
            ref={inputRef}
            type="search"
            className={styles.input}
            placeholder="Find your favorite courses…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            autoComplete="off"
            spellCheck={false}
            // Helps password managers / IME not interfere with the
            // fast iteration loop the debounce expects.
            inputMode="search"
            aria-label="Search the catalog"
            aria-controls="search-overlay-results"
            aria-activedescendant={
              activeIdx >= 0 && results[activeIdx]
                ? `search-result-${results[activeIdx].id}`
                : undefined
            }
          />
          <button
            type="button"
            className={styles.closeBtn}
            onClick={closeOverlay}
            aria-label="Close search"
          >
            esc
          </button>
        </div>

        <div id="search-overlay-results" className={styles.body} role="listbox">
          {view.kind === 'idle' && <IdleBody onPick={(q) => setQuery(q)} />}
          {view.kind === 'loading' && <LoadingBody />}
          {view.kind === 'empty' && <EmptyBody query={view.query} />}
          {view.kind === 'results' && (
            <ResultsBody
              items={view.items}
              query={query.trim()}
              activeIdx={activeIdx}
              onHover={setActiveIdx}
              onPick={(slug) => goToProduct(slug)}
              onSubmitAll={() => goToSearchPage(query.trim())}
            />
          )}
        </div>

        <footer className={styles.footer} aria-hidden>
          <span className={styles.kbdHint}>
            <kbd className={styles.kbd}>↑</kbd>
            <kbd className={styles.kbd}>↓</kbd>
            navigate
          </span>
          <span className={styles.kbdHint}>
            <kbd className={styles.kbd}>↵</kbd>
            open
          </span>
          <span className={styles.kbdHint}>
            <kbd className={styles.kbd}>esc</kbd>
            close
          </span>
        </footer>
      </div>
    </div>
  )
}

// ----- Sub-components ---------------------------------------------------

function IdleBody({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className={styles.idle}>
      <p className={styles.idleHint}>Type to search the catalog.</p>
      <p className={styles.idleEyebrow}>Popular categories</p>
      <ul className={styles.catList}>
        {POPULAR_CATEGORIES.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/browse?category=${c.slug}`}
              className={styles.catLink}
              onClick={(e) => {
                // Stay inside the overlay: prefill the search box
                // instead of navigating immediately, so the user
                // can refine before jumping.
                e.preventDefault()
                onPick(c.label)
              }}
            >
              {c.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LoadingBody() {
  return (
    <ul className={styles.resultsList} aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className={styles.skelRow}>
          <span className={styles.skelThumb} aria-hidden />
          <span className={styles.skelLines}>
            <span className={styles.skelLineLg} aria-hidden />
            <span className={styles.skelLineSm} aria-hidden />
          </span>
        </li>
      ))}
    </ul>
  )
}

function EmptyBody({ query }: { query: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>No matches for &ldquo;{query}&rdquo;</p>
      <p className={styles.emptyHint}>
        Try a shorter query, or{' '}
        <Link href="/browse" className={styles.emptyLink}>
          browse all courses
        </Link>
        .
      </p>
    </div>
  )
}

function ResultsBody({
  items,
  query,
  activeIdx,
  onHover,
  onPick,
  onSubmitAll,
}: {
  items: SearchProduct[]
  query: string
  activeIdx: number
  onHover: (idx: number) => void
  onPick: (slug: string) => void
  onSubmitAll: () => void
}) {
  return (
    <>
      <ul className={styles.resultsList}>
        {items.map((p, idx) => {
          const active = idx === activeIdx
          return (
            <li key={p.id}>
              <button
                id={`search-result-${p.id}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.result} ${active ? styles.resultActive : ''}`}
                onMouseEnter={() => onHover(idx)}
                onClick={() => onPick(p.slug)}
              >
                {p.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnail_url}
                    alt=""
                    className={styles.resultThumb}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className={styles.resultThumbPlaceholder} aria-hidden />
                )}
                <span className={styles.resultBody}>
                  {p.category && (
                    <span className={styles.resultEyebrow}>{p.category.name}</span>
                  )}
                  <span className={styles.resultTitle}>{p.title}</span>
                  {p.short_description && (
                    <span className={styles.resultDesc}>{p.short_description}</span>
                  )}
                </span>
                {p.starting_price_cents != null && (
                  <span className={styles.resultPrice}>
                    {formatMoneyShort(p.starting_price_cents, 'USD')}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className={styles.submitAll} onClick={onSubmitAll}>
        See all results for &ldquo;{query}&rdquo; <span aria-hidden>→</span>
      </button>
    </>
  )
}

type OverlayView =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty'; query: string }
  | { kind: 'results'; items: SearchProduct[] }