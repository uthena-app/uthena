// useBodyScrollLock — shared body-scroll lock for modal/drawer overlays.
//
// Why a hook (not a one-shot helper):
// - Components mount/unmount their overlays conditionally. A hook
//   tied to component lifecycle is the cleanest API:
//     useBodyScrollLock(open)
// - We use a module-level reference counter so two modals can lock
//   the body at the same time (e.g. the cart drawer + a confirm
//   modal) without the second one stomping on the first's restore.
//
// What it does:
// - On `locked === true`, capture the current `body.style.overflow`
//   (the previous value, possibly '' or 'hidden') and set
//   `body.style.overflow = 'hidden'`.
// - On unmount or `locked === false`, restore the previous value
//   only if the counter drops to zero. That prevents the second
//   modal's cleanup from prematurely re-enabling scroll while the
//   first modal is still open.
//
// Caveats:
// - iOS Safari ignores `overflow:hidden` on <body>. For full iOS
//   parity you'd also need to fix `position:fixed` + a scroll
//   listener. Uthena's overlays are short-lived enough that the
//   common-case `overflow:hidden` is sufficient; flagging the iOS
//   edge for the cart drawer (P4.1) when we wire that.
//
// SSR-safe: the hook short-circuits when `typeof document` is
// undefined so RSC pages that import it accidentally don't crash.

'use client'

import { useEffect } from 'react'

// Module-level counter so nested overlays don't clobber each other.
let lockCount = 0
let savedOverflow: string | null = null

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return
    if (typeof document === 'undefined') return
    if (lockCount === 0) {
      // Capture the previous value only on the first lock so
      // nested locks don't overwrite each other's "previous" with
      // their own `'hidden'`.
      savedOverflow = document.body.style.overflow
    }
    lockCount += 1
    document.body.style.overflow = 'hidden'
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0 && savedOverflow !== null) {
        document.body.style.overflow = savedOverflow
        savedOverflow = null
      }
    }
  }, [locked])
}