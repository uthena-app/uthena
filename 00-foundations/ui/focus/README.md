# `00-foundations/ui/focus/` — shared a11y hooks for overlays

These three hooks compose the WAI-ARIA modal-dialog pattern (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Every overlay in the app (search, mobile nav, future cart drawer, future confirm modals) uses them — no inline re-implementations.

## What's here

| Hook | Purpose |
|---|---|
| `useBodyScrollLock(active)` | Lock `body.overflow = 'hidden'` while `active` is true. Reference-counted so nested overlays don't clobber each other. |
| `useFocusRestore(active)` | Remember the element focused when `active` flips true; restore it via `queueMicrotask` after unmount. Falls back to `document.body.focus()`. |
| `useFocusTrap(rootRef, active)` | Trap Tab / Shift+Tab inside `rootRef.current` while `active` is true. Auto-filters display:none + disabled elements. |

## Usage

```tsx
'use client'
import { useRef } from 'react'
import {
  useBodyScrollLock,
  useFocusRestore,
  useFocusTrap,
} from '@foundations/ui/focus'

export function MyOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useBodyScrollLock(open)
  useFocusTrap(dialogRef, open)
  useFocusRestore(open)

  if (!open) return null
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true">
      ...
    </div>
  )
}
```

## Why three hooks, not one `useOverlay()` bundle

- **Composition over configuration.** Each hook is independently useful. `useFocusRestore` is needed even when there's no trap (e.g. a non-modal popover). `useBodyScrollLock` is needed even when there's no focus management (e.g. a one-shot tooltip that blocks scroll momentarily).
- **Smaller surface for tests.** Each hook can be unit-tested in isolation.
- **No hidden coupling.** A combined hook would force a prop-shape contract on every overlay; the three-hands approach lets each overlay wire only what it needs.

## Why no third-party library (`focus-trap-react`, etc.)

- Adds ~12 KB minified for ~80 lines of logic we control.
- Couples our modal behavior to an upstream we can't patch if the behavior diverges from our design system.
- The pattern is stable; we don't need the library's options surface.

## The global focus ring

The default focus ring lives in `app/globals.css`:

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Components can re-declare `outline` inside their own `:focus-visible` rule (e.g. for inset rings on inputs), but should keep the same color + offset unless they have a specific design reason.

## See also

- [WAI-ARIA APG: Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [WCAG 2.4.3 Focus Order](https://www.w3.org/WAI/WCAG21/Understanding/focus-order.html)
- [WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG21/Understanding/focus-visible.html)