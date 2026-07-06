// SearchTrigger — tiny client island that turns any element with
// `data-search-trigger` into a button that opens the ⌘K overlay.
// Mounted once from SiteHeader so the SiteHeader itself stays RSC.
//
// Why a separate island instead of inlining:
// - The trigger must run JS to preventDefault the form click and
//   fire the custom event. The header is otherwise server-only.
// - A small island that delegates via `data-*` keeps it reusable
//   (e.g. the future /search page can mark its results header with
//   `data-search-trigger` to give the user a quick-refine affordance
//   without restating the listener).

'use client'

import { useEffect } from 'react'
import { SEARCH_TRIGGER_OPEN_EVENT } from './searchEvents'

export function SearchTrigger() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target
      if (!(target instanceof Element)) return
      const trigger = target.closest<HTMLElement>('[data-search-trigger]')
      if (!trigger) return
      // If the trigger is inside a form, swallow the submit so the
      // overlay can open instead of navigating to /search?q=.
      const form = trigger.closest('form')
      if (form) e.preventDefault()
      window.dispatchEvent(new CustomEvent(SEARCH_TRIGGER_OPEN_EVENT))
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
  return null
}