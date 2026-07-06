'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@foundations/ui/primitives/Button'
import {
  signOutCurrentSessionAction,
  signOutEverywhereAction,
  signOutSessionByIdAction,
} from '../actions/sessionActions'
import type { SessionInfo } from '../queries/getMySessions'
import styles from './SessionsSection.module.css'

type SessionsSectionProps = {
  sessions: SessionInfo[]
  currentSessionId: string | null
  currentEmail: string
}

export function SessionsSection({
  sessions,
  currentSessionId,
  currentEmail,
}: SessionsSectionProps) {
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [signingOutId, setSigningOutId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  // P1.8 — fall back to "match by user-agent" if the JWT didn't expose
  // a session_id (e.g. older cookie format). This is best-effort; the
  // primary signal is the JWT claim.
  const currentRowId =
    currentSessionId ?? sessions.find((s) => s.isCurrent)?.id ?? null

  const onSignOutCurrent = () => {
    setError(null)
    startTransition(async () => {
      const result = await signOutCurrentSessionAction()
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(result.redirectTo)
      router.refresh()
    })
  }

  const onSignOutOther = (sessionId: string) => {
    setError(null)
    setSigningOutId(sessionId)
    startTransition(async () => {
      const result = await signOutSessionByIdAction({ sessionId })
      if (!result.ok) {
        setError(result.error)
        setSigningOutId(null)
        return
      }
      setSigningOutId(null)
      // Refresh the page so the list re-fetches without the removed row.
      router.refresh()
    })
  }

  const onConfirmSignOutAll = () => {
    setError(null)
    startTransition(async () => {
      const result = await signOutEverywhereAction({ confirmEmail: typed })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(result.redirectTo)
      router.refresh()
    })
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>Sessions</h2>
      <p className={styles.lede}>
        These are the devices currently signed in to your Uthena account. Sign out of any device
        you no longer use.
      </p>

      {sessions.length === 0 ? (
        <p className={styles.empty} role="status">
          No active sessions found. If you recently signed in, refresh this page.
        </p>
      ) : (
        <ul className={styles.list}>
          {sessions.map((s) => {
            const isCurrent = s.id === currentRowId
            return (
              <li
                key={s.id}
                className={`${styles.row} ${isCurrent ? styles.rowCurrent : ''}`}
              >
                <div className={styles.deviceInfo}>
                  <p className={styles.deviceLabel}>
                    {isCurrent ? (
                      <>
                        This device <span className={styles.badge}>Current</span>
                      </>
                    ) : (
                      <span className={styles.deviceName}>Other device</span>
                    )}
                  </p>
                  <p className={styles.deviceMeta} title={s.userAgent ?? 'Unknown device'}>
                    {s.userAgentDisplay}
                  </p>
                  <p className={styles.deviceMeta}>
                    Signed in {formatTimeAgo(s.createdAt)}
                  </p>
                </div>
                {isCurrent ? (
                  <Button type="button" variant="ghost" disabled>
                    Active
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onSignOutOther(s.id)}
                    loading={isPending && signingOutId === s.id}
                    disabled={isPending}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.thisDeviceRow}>
        <Button
          type="button"
          variant="secondary"
          onClick={onSignOutCurrent}
          loading={isPending && signingOutId === null}
          disabled={isPending}
        >
          Sign out this device
        </Button>
        <p className={styles.thisDeviceHelp}>
          Ends only the current session. Other devices stay signed in.
        </p>
      </div>

      {!showConfirmAll ? (
        <div className={styles.allRow}>
          <Button type="button" variant="danger" onClick={() => setShowConfirmAll(true)}>
            Sign out everywhere
          </Button>
          <p className={styles.allHelp}>
            Ends every active session on every device. You&apos;ll need to sign in again.
          </p>
        </div>
      ) : (
        <div className={styles.confirmAll}>
          <p className={styles.confirmLabel}>
            Type your email to confirm: <span className={styles.confirmEmail}>{currentEmail}</span>
          </p>
          <input
            type="email"
            className={styles.confirmInput}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Confirm your email"
          />
          <div className={styles.confirmActions}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowConfirmAll(false)
                setTyped('')
                setError(null)
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={onConfirmSignOutAll}
              loading={isPending && signingOutId === null}
              disabled={
                typed.trim().toLowerCase() !== currentEmail.trim().toLowerCase() || isPending
              }
            >
              Sign out everywhere
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'recently'
  const diffMs = Date.now() - then
  if (diffMs < 60_000) return 'just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
