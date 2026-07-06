// SignOutButton — client-only. Calls supabase.auth.signOut() then
// router.push('/login'). Renders as a button styled to match the
// sidebar's sign-out affordance.

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { getEnv } from '@foundations/env'

export function SignOutButton({ className }: { className?: string | undefined }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onClick() {
    setError(null)
    startTransition(async () => {
      try {
        const env = getEnv()
        const supabase = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
        await supabase.auth.signOut()
      } catch {
        // Even if signOut throws, we still want to leave — the user
        // pressed the button. The session cookie is cleared on the
        // next request.
      }
      router.push('/login')
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className={className}
      >
        {isPending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 12, color: 'var(--danger)', padding: '0 12px' }}
        >
          {error}
        </span>
      )}
    </>
  )
}
