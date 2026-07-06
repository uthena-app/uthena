// PollLibraryReady.tsx — client island that polls the order's grant
// count every 5s for up to 60s. Flips the "Finalizing your library…"
// badge to "Library ready" once the count > 0. Stops on success or
// timeout. The poll uses a Server Action GET-friendly endpoint (the
// /api/orders/[id]/grants route, see 03-app/api/orders/[id]/grants).
//
// On `failed` / `refunded` orders the badge flips to a danger state
// that surfaces BOTH the "View order details" link (to /account/orders/
// [id] so the buyer can see the row's history + retry options) AND a
// mailto support link. P4.13 acceptance criterion: when the order is
// failed/refunded, the user must be able to reach the order detail
// page and the support inbox from the success surface.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from './PollLibraryReady.module.css'

type State =
  | { kind: 'ready' }
  | { kind: 'finalizing' }
  | { kind: 'timeout' }
  | { kind: 'failed'; reason: string }

const POLL_MS = 5_000
const MAX_POLLS = 12 // 60s total

export function PollLibraryReady({
  orderId,
  initialGrantCount,
  supportEmail = 'support@uthena.com',
}: {
  orderId: number
  initialGrantCount: number
  supportEmail?: string
}) {
  const [state, setState] = useState<State>(
    initialGrantCount > 0 ? { kind: 'ready' } : { kind: 'finalizing' },
  )

  useEffect(() => {
    if (state.kind === 'ready' || state.kind === 'timeout' || state.kind === 'failed') {
      return
    }
    let cancelled = false
    let polls = 0
    const tick = async () => {
      polls += 1
      try {
        const res = await fetch(`/api/orders/${orderId}/grants`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = (await res.json()) as { grant_count: number; status: string }
        if (cancelled) return
        if (data.grant_count > 0) {
          setState({ kind: 'ready' })
          return
        }
        if (data.status === 'failed' || data.status === 'refunded') {
          setState({ kind: 'failed', reason: data.status })
          return
        }
        if (polls >= MAX_POLLS) {
          setState({ kind: 'timeout' })
          return
        }
        setTimeout(tick, POLL_MS)
      } catch (err) {
        if (cancelled) return
        if (polls >= MAX_POLLS) {
          setState({ kind: 'timeout' })
          return
        }
        setTimeout(tick, POLL_MS)
      }
    }
    setTimeout(tick, POLL_MS)
    return () => {
      cancelled = true
    }
  }, [orderId, state.kind])

  if (state.kind === 'ready') {
    return (
      <span className={`${styles.badge} ${styles.badgeSuccess}`} role="status" aria-live="polite">
        <span aria-hidden>✓</span> Library ready
      </span>
    )
  }
  if (state.kind === 'timeout') {
    return (
      <span className={`${styles.badge} ${styles.badgeWarn}`} role="status" aria-live="polite">
        Still finalizing —{' '}
        <a
          className={styles.link}
          href={`mailto:${supportEmail}?subject=Order%20${orderId}%20grant%20delay`}
        >
          contact support
        </a>
      </span>
    )
  }
  if (state.kind === 'failed') {
    return (
      <span className={`${styles.badge} ${styles.badgeDanger}`} role="status" aria-live="polite">
        Something went wrong —{' '}
        <Link className={styles.link} href={`/account/orders/${orderId}`}>
          view order details
        </Link>
        {' or '}
        <a
          className={styles.link}
          href={`mailto:${supportEmail}?subject=Order%20${orderId}%20${state.reason}`}
        >
          contact support
        </a>
      </span>
    )
  }
  return (
    <span className={`${styles.badge} ${styles.badgeNeutral}`} role="status" aria-live="polite">
      <span aria-hidden>●</span> Finalizing your library…
    </span>
  )
}