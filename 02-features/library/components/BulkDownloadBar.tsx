// BulkDownloadBar.tsx — client island that powers P7.4 bulk-download
// from the file vault. Reads the count of checked file_ids checkboxes
// inside the form, shows a count + a primary submit button + a
// "Select all / clear" link, and disables the submit when zero boxes
// are checked (or the selection is over the 50-file hard cap).
//
// The bar is a tiny client island because counting checkboxes needs
// the DOM; everything else in the form (the checkboxes themselves,
// the wrapping `<form action="/api/library/bulk-download" method="post">`,
// the per-row `Generate link` button) is plain HTML that works
// without JS. The "Select all / clear" links are also plain HTML
// `<button type="button">` elements that trigger a `change` event on
// each checkbox via the island's `selectAll`/`clearAll` handlers.
//
// No server action — the route handler at /api/library/bulk-download
// streams the zip response directly. The form's standard submit
// triggers the browser's native download flow (Content-Disposition:
// attachment on the response). The island's job is purely the
// count + the button enabled/disabled state.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './BulkDownloadBar.module.css'

const MAX_FILES = 50

export type BulkDownloadBarProps = {
  /** Stable id for the form the bar controls. The checkboxes must
   *  have `name="file_ids"` and `value="<file_id>"` (string). */
  formId: string
}

export function BulkDownloadBar({ formId }: BulkDownloadBarProps) {
  const [count, setCount] = useState(0)
  const [totalSize, setTotalSize] = useState(0)
  const formRef = useRef<HTMLFormElement | null>(null)

  // Find the form by id on mount + subscribe to checkbox changes.
  // The checkboxes themselves are server-rendered HTML — we just
  // listen for change events bubbling up to the form.
  useEffect(() => {
    const form = document.getElementById(formId)
    if (!(form instanceof HTMLFormElement)) return
    formRef.current = form

    function recompute() {
      if (!formRef.current) return
      const boxes = formRef.current.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][name="file_ids"]:checked',
      )
      let bytes = 0
      boxes.forEach((b) => {
        const sizeAttr = b.dataset.fileSize
        if (sizeAttr) {
          const n = Number.parseInt(sizeAttr, 10)
          if (Number.isFinite(n) && n > 0) bytes += n
        }
      })
      setCount(boxes.length)
      setTotalSize(bytes)
    }

    form.addEventListener('change', recompute)
    recompute()
    return () => form.removeEventListener('change', recompute)
  }, [formId])

  const selectAll = useCallback(() => {
    const form = formRef.current
    if (!form) return
    form
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="file_ids"]')
      .forEach((box) => {
        if (!box.disabled && !box.checked) {
          box.checked = true
          box.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
  }, [])

  const clearAll = useCallback(() => {
    const form = formRef.current
    if (!form) return
    form
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="file_ids"]')
      .forEach((box) => {
        if (box.checked) {
          box.checked = false
          box.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
  }, [])

  const overCap = count > MAX_FILES
  const hasAny = count > 0
  const sizeLabel = totalSize > 0 ? formatBytes(totalSize) : null

  return (
    <div className={styles.bar} role="region" aria-label="Bulk download selection">
      <div className={styles.count} aria-live="polite">
        <span className={styles.countValue}>{count}</span>
        <span className={styles.countLabel}>
          {count === 1 ? 'file' : 'files'} selected
          {sizeLabel ? <> · {sizeLabel}</> : null}
        </span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          onClick={selectAll}
          className={styles.linkBtn}
          aria-label="Select all files"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clearAll}
          className={styles.linkBtn}
          disabled={!hasAny}
          aria-label="Clear selection"
        >
          Clear
        </button>
        <button
          type="submit"
          className={styles.primary}
          disabled={!hasAny || overCap}
          aria-disabled={!hasAny || overCap}
        >
          Download as zip
        </button>
      </div>
      {overCap && (
        <p role="alert" className={styles.warning}>
          You can bulk-download up to {MAX_FILES} files at once. Deselect{' '}
          {count - MAX_FILES} to continue.
        </p>
      )}
    </div>
  )
}

/** Format a byte count as a short human string (binary units, one
 *  decimal). Mirrors formatBytes in validateBulkRequest.ts but
 *  accepts a number — the bar is client-only and reads numbers
 *  from data-file-size attributes. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const KB = 1024
  const MB = KB * 1024
  const GB = MB * 1024
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`
  return `${bytes} B`
}