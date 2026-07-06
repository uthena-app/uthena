// VerifyEmailRedirect — tiny client island that handles the
// auto-redirect after a successful email verification. Mounted only
// on the success branch of /verify-email; the rest of the page stays
// RSC.
//
// The 2s delay matches the spec: "redirects to /library after 2s".
// We honor `prefers-reduced-motion` by skipping the redirect (the
// user can still use the "Go to your library" link). When motion
// is acceptable, we use `router.push` + `router.refresh` so the
// layout re-reads the auth state and the post-redirect page picks
// up the verified-user state.
//
// Defensive cleanup: if the user clicks the "Go to your library"
// link before the timer fires, the effect's cleanup clears the
// timer so we don't redirect-after-navigation. The `now` ref is
// intentionally NOT a dep — we want the timer to be set once.

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const REDIRECT_DELAY_MS = 2000

export function VerifyEmailRedirect({ to }: { to: string }) {
  const router = useRouter()
  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return
    const t = setTimeout(() => {
      router.push(to)
      router.refresh()
    }, REDIRECT_DELAY_MS)
    return () => clearTimeout(t)
  }, [router, to])
  return null
}