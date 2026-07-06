'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/** Catches in-app navigation (Next.js <Link> clicks) when `when`
 *  is true. Next 15's `useBlocker` from `next/navigation` is not
 *  reliably exposed across minor versions; this is a small
 *  click interceptor on internal anchor links that prompts
 *  before allowing the navigation. Behavior matches Next's
 *  useBlocker contract: if `onBlock` throws `__BLOCK__`, the
 *  navigation is cancelled; otherwise the link's href is
 *  pushed. */
export function useBlocker(when: boolean, onBlock: () => void) {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!when) return
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const anchor = target?.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      if (
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('mailto:') ||
        href.startsWith('#')
      )
        return
      if (anchor.target && anchor.target !== '_self') return
      const next = href.split('?')[0]?.split('#')[0] ?? ''
      if (next === pathname) return
      e.preventDefault()
      e.stopPropagation()
      try {
        onBlock()
      } catch (err) {
        if (err instanceof Error && err.message === '__BLOCK__') return
        throw err
      }
      router.push(href)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [when, pathname, router, onBlock])
}
