// useFocusTrap — Tab/Shift+Tab trap inside a container ref while active.
//
// Why a hook (not a third-party library):
// - The pattern is short (~30 lines) and tightly coupled to the
//   design tokens. Adding `focus-trap-react` or `focus-trap` would
//   be +12 KB minified for ~30 lines we control.
// - ARIA APG modal-dialog pattern:
//   https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
//   When a modal is open, Tab and Shift+Tab must cycle inside the
//   dialog, never escape to the page underneath.
//
// How to use:
//   const dialogRef = useRef<HTMLDivElement>(null)
//   useFocusTrap(dialogRef, open)
//   return <div ref={dialogRef} role="dialog" aria-modal="true">…</div>
//
// Behavior:
// - When active, listens for `keydown` on `window`.
// - Queries the root for focusable elements
//   (a[href], button:not([disabled]), input:not([disabled]),
//    textarea:not([disabled]), select:not([disabled]),
//    [tabindex]:not([tabindex="-1"])).
// - On Tab from the last focusable, moves focus to the first.
// - On Shift+Tab from the first focusable (or any element outside
//   the root), moves focus to the last.
// - If the root has no focusables, focuses the root itself so Tab
//   has somewhere to land next time.
//
// Performance:
// - Queries the focusable list once per Tab press. The cost is one
//   DOM read per Tab; negligible for the <100-node overlays we ship.

'use client'

import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(
  rootRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return
    if (typeof window === 'undefined') return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const root = rootRef.current
      if (!root) return

      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => {
        // Skip elements that are visually hidden or display:none.
        if (el.hasAttribute('disabled')) return false
        // offsetParent is null for display:none and for elements in
        // a detached subtree; treat both as "not focusable".
        // We use getClientRects() instead because offsetParent
        // returns null for position:fixed elements (which is the
        // common case for our modals).
        const rects = el.getClientRects()
        if (rects.length === 0) return false
        return true
      })

      if (focusables.length === 0) {
        // Nothing focusable — keep focus on the root so the user
        // can't Tab away.
        e.preventDefault()
        root.focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      // Non-null asserted: focusables.length > 0 above.
      if (!first || !last) return
      const activeEl = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (activeEl === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rootRef, active])
}