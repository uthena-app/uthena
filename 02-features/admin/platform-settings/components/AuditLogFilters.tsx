// AuditLogFilters.tsx — client island; GET-form filter UI.

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import styles from './AuditLogFilters.module.css'

export type AuditLogFiltersInitial = {
  actorEmail: string
  action: string
  targetKind: string
  targetId: string
  from: string
  to: string
}

export function AuditLogFilters({ initial }: { initial: AuditLogFiltersInitial }) {
  const [actorEmail, setActorEmail] = useState(initial.actorEmail)
  const [action, setAction] = useState(initial.action)
  const [targetKind, setTargetKind] = useState(initial.targetKind)
  const [targetId, setTargetId] = useState(initial.targetId)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const router = useRouter()
  const [, startTransition] = useTransition()

  function apply() {
    const params = new URLSearchParams()
    if (actorEmail.trim()) params.set('actorEmail', actorEmail.trim())
    if (action.trim()) params.set('action', action.trim())
    if (targetKind.trim()) params.set('targetKind', targetKind.trim())
    if (targetId.trim()) params.set('targetId', targetId.trim())
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `/admin/audit-log?${qs}` : '/admin/audit-log')
    })
  }

  function clear() {
    setActorEmail('')
    setAction('')
    setTargetKind('')
    setTargetId('')
    setFrom('')
    setTo('')
    startTransition(() => router.push('/admin/audit-log'))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
      className={styles.root}
      aria-label="Audit log filters"
    >
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>Actor email</span>
          <input
            type="text"
            value={actorEmail}
            onChange={(e) => setActorEmail(e.target.value)}
            placeholder="hash:…@uthena.audit"
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Action contains</span>
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="signup, payout_request_approved, …"
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Target kind</span>
          <input
            type="text"
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value)}
            placeholder="payout_requests, reviews, …"
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Target ID</span>
          <input
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="123"
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>From</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={styles.input}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>To</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={styles.input}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="submit" className={styles.applyButton}>Apply</button>
        <button type="button" onClick={clear} className={styles.clearButton}>Clear</button>
      </div>
    </form>
  )
}
