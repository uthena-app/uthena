// ExportCsvButton.tsx — client island for /partner/payouts.
//
// Calls the `exportLedgerCsvAction` server action with the active
// filter state (read from the URL via `useSearchParams` so the
// exported CSV always matches what's on screen), then triggers a
// CSV download via the Blob + URL.createObjectURL pattern. Mirrors
// `CategoryExportButton.tsx` (admin categories export) — the
// shape is the same, only the action differs.
//
// On rate-limit hit, surfaces the friendly cooldown inline (matches
// the spec's "Try again in N minutes" copy). On other errors,
// surfaces the action's error string + the standard
// `role="alert"` affordance.
//
// Why a client island: the page is RSC (data layer + summary +
// table) and the export button is the only piece of post-render
// interactivity besides the filter chips. One small island keeps
// the bundle cost minimal — no extra deps.

'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { exportLedgerCsvAction } from '../actions/exportLedgerCsv'
import styles from './ExportCsvButton.module.css'

export function ExportCsvButton() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const searchParams = useSearchParams()

  function onClick() {
    setError(null)
    // Read the active filter state from the URL so the export
    // mirrors what's on screen. The page's `parseStatus` /
    // `parseKind` / `parseSort` helpers guarantee the URL values
    // are valid union members when this button is on the page.
    // The cast is safe + the action's Zod schema is the real
    // validator (it rejects any malformed union member).
    const rawFilters = {
      status: searchParams.get('status') ?? undefined,
      kind: searchParams.get('kind') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
    } as Parameters<typeof exportLedgerCsvAction>[0]
    startTransition(async () => {
      const res = await exportLedgerCsvAction(rawFilters)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={onClick}
        disabled={isPending}
        aria-label="Export ledger as CSV"
      >
        {isPending ? 'Exporting…' : 'Export CSV'}
      </button>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </>
  )
}