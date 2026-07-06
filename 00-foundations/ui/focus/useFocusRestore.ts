// useFocusRestore — remember & restore the previously-focused element
// when an overlay opens and closes.
//
// Why a hook:
// - A modal/drawer MUST remember what was focused before it opened
//   so that closing returns the user to where they were. This is
//   WAI-ARIA modal dialog behavior (https://www.w3.org/WAI/ARIA/apg/
//   patterns/dialog-modal/).
// - Capturing/restoring is two lines of state, but the timing
//   matters: the restore has to happen *after* the overlay unmounts
//   (otherwise the overlay's own focusable children steal focus
//   back). We use `queueMicrotask` so the restore runs after React
//   has flushed the unmount.
//
// How to use:
//   const lastFocusedRef = useFocusRestore(open)
//   // open=true  -> lastFocusedRef.current is set on the next tick
//   // open=false -> lastFocusedRef.current is restored after unmount
//
// If no element was focused when the overlay opened, the restore
// falls back to `document.body.focus()` so screen readers don't
// keep reading the overlay content after it closes.

'use client'

import { useEffect, useRef } from 'react'

export function useFocusRestore<T extends HTMLElement = HTMLElement>(
  active: boolean,
): React.MutableRefObject<T | null> {
  const lastFocusedRef = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return
    if (typeof document === 'undefined') return
    // Defer one tick so we don't capture the overlay's own
    // mount-time focus event. requestAnimationFrame is enough.
    const raf = requestAnimationFrame(() => {
      lastFocusedRef.current = (document.activeElement as T | null) ?? null
    })
    return () => {
      cancelAnimationFrame(raf)
      // Restore focus after the overlay has unmounted.
      queueMicrotask(() => {
        const target = lastFocusedRef.current
        if (target && typeof target.focus === 'function') {
          target.focus()
        } else if (typeof document !== 'undefined') {
          // No previous focus — make body focusable so SR doesn't
          // re-read the now-removed overlay.
          document.body.focus()
        }
      })
    }
  }, [active])

  return lastFocusedRef
}