// RefreshDefaultLinkButton.tsx — P13.5 client island.
//
// Wired into the empty-state branch of `<DefaultLinkHero>`. When
// the affiliate lands on /affiliate/links with no default link
// row (legacy data path), this button calls the
// `ensureDefaultLinkAction` server action which idempotently
// creates the default row + revalidates the page so the hero card
// surfaces on the next render.
//
// Wired as a server action form per Next.js conventions (no
// `useTransition` needed for the simple success/error flow; the
// page action handles `revalidatePath('/affiliate/links')` so a
// hard navigation isn't required).
//
// Render strategy: form with hidden inputs + a primary submit
// button. No state — the server action redirects to `?ok=1` on
// success, the parent treats the `?ok` query as the canonical
// "generated" signal (same pattern as onboarding form posts).
//
// 'use client' is required because the Toast success/error
// feedback uses the shared Toast provider which lives on the
// client (portal + useEffect mount guard).

'use client'

import { useEffect, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@foundations/ui/Toast'
import {
  ensureDefaultLinkAction,
  type EnsureDefaultLinkResult,
} from '../actions/links/ensureDefaultLinkAction'
import styles from './DefaultLinkHero.module.css'

export function RefreshDefaultLinkButton() {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const toast = useToast()

  // On a `?ok=1` query (the action redirect signal), fire a one-time
  // toast confirmation. The query is then stripped via router.replace
  // so a refresh doesn't re-fire the toast.
  useEffect(() => {
    if (params.get('ok') === '1') {
      toast.success('Default link generated. Share the URL anywhere.')
      const next = new URLSearchParams(params.toString())
      next.delete('ok')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }
  }, [params, pathname, router, toast])

  function handleClick() {
    startTransition(async () => {
      let result: EnsureDefaultLinkResult
      try {
        result = await ensureDefaultLinkAction()
      } catch (err) {
        toast.error('Could not generate link. Please try again.')
        return
      }
      if (result.ok === true) {
        // Success path: the action already called
        // `revalidatePath('/affiliate/links')` — no manual refresh
        // required. The next render shows the hero card. The `?ok=1`
        // toast signal is set by the action itself (it returns the
        // redirect URL).
        return
      }
      if (result.ok === false && result.code === 'rate_limited') {
        toast.error('Too many refresh attempts — please try again in a few minutes.')
      } else if (result.ok === false && result.code === 'unauthenticated') {
        toast.error('Your session expired. Please sign in again.')
      } else {
        toast.error(result.message ?? 'Could not generate link. Please try again.')
      }
    })
  }

  return (
    <button
      type="button"
      className={styles.refreshBtn}
      onClick={handleClick}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending ? 'Generating…' : 'Generate default link'}
    </button>
  )
}
