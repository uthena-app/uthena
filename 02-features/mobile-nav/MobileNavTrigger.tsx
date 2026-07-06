// MobileNavTrigger — tiny client island that turns any element with
// `data-mobile-nav-trigger` into a button that opens the mobile nav
// drawer. Mounted once from the root layout alongside MobileNav so
// the SiteHeader (RSC) can keep shipping zero JS for the trigger.
//
// Why a separate island instead of inlining:
// - The trigger must run JS to fire the custom event. The header is
//   otherwise server-only and rendering the drawer inside the header
//   would push its full markup + state into the RSC payload.
// - Mirrors the SearchTrigger pattern exactly: same data-attr
//   convention, same window-event bridge, same "render null" shape.

'use client'

import { useEffect } from 'react'
import { MOBILE_NAV_OPEN_EVENT } from './mobileNavEvents'

export function MobileNavTrigger() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target
      if (!(target instanceof Element)) return
      const trigger = target.closest<HTMLElement>('[data-mobile-nav-trigger]')
      if (!trigger) return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent(MOBILE_NAV_OPEN_EVENT))
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
  return null
}
