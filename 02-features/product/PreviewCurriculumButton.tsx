'use client'

// PreviewCurriculumButton — the secondary "Preview curriculum" CTA
// in the "At a glance" sidebar (P0.12 Slice 5). The brief is an RSC,
// but this button needs to switch the active tab in the `ProductTabs`
// client island, which lives in a sibling component. The cleanest
// seam is a window CustomEvent:
//
//   - The button dispatches `uthena:product:switch-tab` with
//     `detail = { tab: 'curriculum', instanceId }`.
//   - `ProductTabs` listens for that event on mount and updates its
//     `active` state when the `instanceId` matches (so multiple
//     ProductTabs instances on the same page don't fight each
//     other).
//
// **Why a window event (not a context / ref)** — the brief lives
// inside `<aside>`, the tabs live inside `<section>`. Lifting state
// would require a shared context that wraps both, which is a lot of
// plumbing for one click. A named event keeps both surfaces
// independent and is the same pattern `SearchTrigger` /
// `MobileNavTrigger` use for the global overlays. (See the P0.4 +
// P0.5 lessons in MEMORY.md.)
//
// **Why a client island (not a regular `<a href="#curriculum">`)** —
// the mockup shows the Preview curriculum as a button that scrolls
// to + activates the Curriculum tab. Switching tabs is local state
// in `ProductTabs`; a hash anchor would scroll to the tab row but
// not switch the active tab (Description stays selected). The event
// bridge is the right shape.
//
// **A11y** — the button is a real `<button>` so it's focusable,
// screen-reader announced, and keyboard-activatable. The label is
// the visible "Preview curriculum" text; an `aria-label` adds the
// product context for screen readers ("Preview curriculum for
// {kind}").

import { useId } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import styles from './PreviewCurriculumButton.module.css'

/** Event name used by the At a glance → Tabs bridge. The product
 *  detail page's `ProductTabs` client island listens for this. */
export const PRODUCT_TAB_SWITCH_EVENT = 'uthena:product:switch-tab'

type Props = {
  /** Stable per-product id (matches `ProductTabs.instanceId`). */
  instanceId: string
}

export function PreviewCurriculumButton({ instanceId }: Props) {
  // The button doesn't need a useId; it's a stateless trigger.
  // `useId` is included for future-proofing in case we want to
  // wire a per-button accessible label that pairs with the
  // tabpanel's labelledby (the brief + the tabs share the same
  // instanceId, which is enough today).
  useId()

  function onClick() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent(PRODUCT_TAB_SWITCH_EVENT, {
        detail: { tab: 'curriculum', instanceId },
      }),
    )
  }

  return (
    <Button
      variant="secondary"
      size="md"
      fullWidth
      type="button"
      onClick={onClick}
      className={styles.btn}
    >
      Preview curriculum
    </Button>
  )
}
