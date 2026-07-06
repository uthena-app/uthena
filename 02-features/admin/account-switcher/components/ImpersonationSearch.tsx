// ImpersonationSearch — pure client component for the search input +
// reason field. Uses a plain `<form method="get">` so the search updates
// the URL (`?q=...`) without any client JS fetch loop. The reason
// field is stored in:
//   1. local state (so the form's submit / counter reflect the value)
//   2. localStorage under `uthena.impersonation.reason.v1` (so the
//      per-row SwitchToUserButton client islands can read it without
//      lifting state up — the search form and the result rows are
//      separate components)
//
// localStorage can throw in private-browsing mode; the try/catch is
// defensive (the form still works in-memory even if storage fails).

'use client'

import { useEffect, useState } from 'react'
import { MIN_REASON_LEN, MAX_REASON_LEN } from '../constants'
import styles from './AccountSwitcher.module.css'

const REASON_STORAGE_KEY = 'uthena.impersonation.reason.v1'

function readStoredReason(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(REASON_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeStoredReason(value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(REASON_STORAGE_KEY, value)
  } catch {
    // Private-browsing mode can throw. The form still works in-memory.
  }
}

export function ImpersonationSearch({ initialQuery = '' }: { initialQuery?: string }) {
  // Hydrate from localStorage on mount so the reason persists across
  // search submits (the page re-renders, but the field is a fresh
  // component instance).
  const [reason, setReason] = useState('')
  useEffect(() => {
    setReason(readStoredReason())
  }, [])
  const reasonTrimmed = reason.trim()
  const reasonValid = reasonTrimmed.length >= MIN_REASON_LEN && reasonTrimmed.length <= MAX_REASON_LEN
  const onReasonChange = (value: string) => {
    setReason(value)
    writeStoredReason(value)
  }
  return (
    <section className={styles.searchSection} aria-labelledby="impersonation-search-h">
      <h2 id="impersonation-search-h" className={styles.sectionH}>
        Find a user
      </h2>
      <form method="get" className={styles.searchForm} role="search">
        <label className={styles.label} htmlFor="impersonation-q">
          Email or display name
        </label>
        <input
          id="impersonation-q"
          name="q"
          type="search"
          defaultValue={initialQuery}
          maxLength={120}
          placeholder="alice@example.com or Alice K."
          className={styles.input}
          autoComplete="off"
          required
          aria-describedby="impersonation-q-hint"
        />
        <span id="impersonation-q-hint" className={styles.hint}>
          Search is case-insensitive and excludes other super_admin users and banned accounts.
        </span>
        <div className={styles.searchActions}>
          <button type="submit" className={styles.primaryBtn}>
            Search
          </button>
          {initialQuery ? (
            <a href="/admin/account-switcher" className={styles.secondaryBtn}>
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <div className={styles.reasonField}>
        <label className={styles.label} htmlFor="impersonation-reason">
          Reason (required, {MIN_REASON_LEN}–{MAX_REASON_LEN} chars)
        </label>
        <textarea
          id="impersonation-reason"
          name="reason"
          rows={3}
          maxLength={MAX_REASON_LEN}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className={styles.textarea}
          placeholder="e.g. Customer reported charge they don't recognize — refund workflow review."
          aria-describedby="impersonation-reason-hint"
        />
        <span id="impersonation-reason-hint" className={styles.hint}>
          Required for audit. Recorded in <code>admin_audit_log.metadata.reason</code> on every start.
        </span>
        <span
          className={styles.reasonCounter}
          aria-live="polite"
          data-state={reasonValid ? 'valid' : reasonTrimmed.length === 0 ? 'neutral' : 'invalid'}
        >
          {reasonTrimmed.length} / {MAX_REASON_LEN}
        </span>
      </div>

      {/* The reason is persisted to localStorage so the per-row
          SwitchToUserButton client islands (separate component tree)
          can read it without prop drilling. */}
      {reasonValid ? (
        <p className={styles.reasonOkHint}>
          Ready. Click <strong>Switch to this user</strong> on a row below.
        </p>
      ) : (
        <p className={styles.reasonWarnHint}>
          Type a reason of {MIN_REASON_LEN}–{MAX_REASON_LEN} characters to enable the switch buttons.
        </p>
      )}
    </section>
  )
}
