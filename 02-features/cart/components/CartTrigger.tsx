// CartTrigger — tiny client island that turns any element with
// `data-cart-trigger` into a button that opens the cart drawer.
// Mounted once from the root layout alongside CartDrawer so the
// SiteHeader (RSC) can keep shipping zero JS for the trigger.
//
// Why a separate island (mirrors SearchTrigger + MobileNavTrigger):
// - The trigger must run JS to fire the custom event. The header is
//   otherwise server-only and rendering the drawer inside the header
//   would push its full markup + state into the RSC payload.
// - The data-attr convention means a future surface (e.g. a "Cart"
//   button in the mobile-nav drawer, or a `/cart` page header CTA)
//   can open the drawer without restating the listener.

'use client'

import { useEffect } from 'react'
import { CART_OPEN_EVENT } from '../cartEvents'

export function CartTrigger() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target
      if (!(target instanceof Element)) return
      const trigger = target.closest<HTMLElement>('[data-cart-trigger]')
      if (!trigger) return
      // If the trigger is inside a link, swallow the navigation so
      // the drawer can open instead of jumping to /cart. The trigger
      // in the header IS a real <button> (no link wrapper), but this
      // guards against future surfaces that use an <a>.
      const anchor = trigger.closest('a')
      if (anchor) e.preventDefault()
      window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT))
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
  return null
}
