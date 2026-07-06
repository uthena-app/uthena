'use client'

// ProductTabs — the 4-tab shell (Description / Curriculum /
// Instructor / Reviews) that lives below the product detail page's
// top section. Renders the tabs row + the active panel. The panel
// content is passed in as ReactNode so the page can hand in the
// RSC-rendered Description / Curriculum / Instructor / Reviews
// children. This component is the only client island on the
// below-the-fold — the panel content is server-rendered, the
// tabs UI is the only thing that ships JS.
//
// **Mockup parity**: `mockups/product.html` lines 110–134. The
// tabs row is a flex line with a hairline `--line` bottom border
// (matches `.tabs` in `mockups/styles/main.css` line 298). The
// active tab has the heading color + a `--teal` bottom border
// (2 px thick, sits on top of the row's `--line` border). The
// inactive tabs are `--text-soft` with no underline. The Curriculum
// + Reviews buttons carry a mono `.ct` count badge ("12 modules" /
// "12") on the right side.
//
// **WAI-ARIA tabs pattern**: each tab is a `<button>` with
// `role="tab"` + `aria-selected` + `aria-controls` pointing at
// the panel's id. The panels have `role="tabpanel"` +
// `aria-labelledby` pointing back at the controlling tab. Only
// the active panel is in the DOM (we conditionally render via
// `activeTab === 'description' ? <Description /> : ...`). The
// `aria-controls` + `aria-labelledby` pair keeps the screen-reader
// relationship clear even though only one panel exists at a time.
//
// **Keyboard nav** (WAI-ARIA APG "Tabs" pattern):
//   - Left / Right arrows → cycle through tabs (wraps)
//   - Home → first tab
//   - End → last tab
//   - Tab → leave the tablist (focus moves to the panel content)
//   - Enter / Space → already handled by `<button>` (activates)
// Tab key on a tab button is intercepted by the buttons themselves
// (Tab moves focus out of the tablist entirely).
//
// **Why client (not server with `<details>`)**: the mockup uses
// real `<button>` + JS toggling — the active state is independent
// of the URL. `<details>` would force a separate disclosure widget
// per tab, which doesn't match the "tab strip with one panel"
// pattern.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { PRODUCT_TAB_SWITCH_EVENT } from './PreviewCurriculumButton'
import styles from './ProductTabs.module.css'

export type ProductTabId = 'description' | 'curriculum' | 'instructor' | 'reviews'

/** Module-scoped validation list — used by the `uthena:product:switch-tab`
 *  event listener to validate incoming tab names. Mirrors the order of
 *  the `tabs` array below so the index resolves to the correct tab
 *  button when the event fires. */
const VALID_TABS: readonly ProductTabId[] = [
  'description',
  'curriculum',
  'instructor',
  'reviews',
]

type TabConfig = {
  id: ProductTabId
  label: string
  /** Optional badge label that appears after the tab label
   *  (e.g. "12 modules" / "12"). Mono font. */
  badge?: string | null
}

type Props = {
  /** The 4 panel nodes. The page passes them in already
   *  server-rendered. */
  panels: Record<ProductTabId, ReactNode>
  /** Number of curriculum entries (drives the "X modules" badge). */
  curriculumCount: number
  /** Number of published reviews (drives the "X" badge). */
  reviewCount: number
  /** Default-active tab. Defaults to 'description'. */
  defaultTab?: ProductTabId
  /** Stable per-product id used to make the panel id unique
   *  (multiple tabs on the page would otherwise clash). */
  instanceId?: string
}

export function ProductTabs({
  panels,
  curriculumCount,
  reviewCount,
  defaultTab = 'description',
  instanceId,
}: Props) {
  const [active, setActive] = useState<ProductTabId>(defaultTab)
  const baseId = useId()
  const id = instanceId ?? baseId
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([])

  // Cross-component bridge: the "At a glance" sidebar's Preview
  // curriculum button (P0.12 Slice 5) dispatches
  // `uthena:product:switch-tab` with `detail = { tab, instanceId }`.
  // When the `instanceId` matches this tabs instance, switch tabs +
  // move focus to the new tab's button (so keyboard users land
  // somewhere sensible after the click). Multiple tabs instances on
  // the same page (rare; future-proofing for the bundle configurator)
  // each filter on their own `instanceId`, so the events don't fight.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onSwitch(e: Event) {
      const detail = (e as CustomEvent<{ tab?: ProductTabId; instanceId?: string }>).detail
      if (!detail || detail.instanceId !== id) return
      const target = detail.tab
      if (!target) return
      // Validate the tab is a known id. `VALID_TABS` is a module-scoped
      // constant — the tab list is fixed at compile time, so we don't
      // need to depend on the runtime `tabs` array here. This also
      // keeps the effect's dep list at `[id]` so the listener doesn't
      // re-register on every render (the `tabs` array is recreated each
      // render and would churn the listener).
      const idx = VALID_TABS.indexOf(target)
      if (idx === -1) return
      setActive(target)
      // Move focus to the tab button so screen readers announce the
      // new active tab. `queueMicrotask` defers the focus call until
      // React has committed the new state (the new tab button exists
      // in the DOM by then).
      queueMicrotask(() => {
        const tab = tabsRef.current[idx]
        if (tab) tab.focus()
      })
    }
    window.addEventListener(PRODUCT_TAB_SWITCH_EVENT, onSwitch)
    return () => window.removeEventListener(PRODUCT_TAB_SWITCH_EVENT, onSwitch)
  }, [id])

  const tabs: TabConfig[] = [
    { id: 'description', label: 'Description' },
    {
      id: 'curriculum',
      label: 'Curriculum',
      badge: curriculumCount > 0 ? `${curriculumCount} module${curriculumCount === 1 ? '' : 's'}` : null,
    },
    { id: 'instructor', label: 'Instructor' },
    {
      id: 'reviews',
      label: 'Reviews',
      badge: reviewCount > 0 ? reviewCount.toString() : null,
    },
  ]

  const focusTab = useCallback((idx: number) => {
    const tab = tabsRef.current[idx]
    if (tab) tab.focus()
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
      const lastIdx = tabs.length - 1
      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault()
          const next = currentIdx === lastIdx ? 0 : currentIdx + 1
          setActive(tabs[next]!.id)
          focusTab(next)
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          const prev = currentIdx === 0 ? lastIdx : currentIdx - 1
          setActive(tabs[prev]!.id)
          focusTab(prev)
          break
        }
        case 'Home': {
          e.preventDefault()
          setActive(tabs[0]!.id)
          focusTab(0)
          break
        }
        case 'End': {
          e.preventDefault()
          setActive(tabs[lastIdx]!.id)
          focusTab(lastIdx)
          break
        }
      }
    },
    [focusTab, tabs],
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.row} role="tablist" aria-label="Product details">
        {tabs.map((tab, idx) => {
          const isActive = active === tab.id
          const panelId = `${id}-panel-${tab.id}`
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabsRef.current[idx] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              className={`${styles.tab} ${isActive ? styles.tabOn : ''}`.trim()}
            >
              <span className={styles.tabLabel}>{tab.label}</span>
              {tab.badge && (
                <span className={styles.ct} aria-hidden>
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) => {
        const panelId = `${id}-panel-${tab.id}`
        const isActive = active === tab.id
        return (
          <section
            key={tab.id}
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${tab.id}`}
            hidden={!isActive}
            className={styles.panel}
          >
            {panels[tab.id]}
          </section>
        )
      })}
    </div>
  )
}