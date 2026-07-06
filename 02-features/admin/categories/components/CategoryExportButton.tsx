// CategoryExportButton.tsx — client component. Calls the
// exportCategoriesAction and triggers a download of the resulting
// JSON.

'use client'

import { useState, useTransition } from 'react'
import { exportCategoriesAction } from '../actions/exportCategories'
import styles from './CategoryExportButton.module.css'

export function CategoryExportButton() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await exportCategoriesAction()
      if (!res.ok) {
        setError(res.error)
        return
      }
      const blob = new Blob([res.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `uthena-categories-${new Date().toISOString().slice(0, 10)}.json`
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
      >
        {isPending ? 'Exporting…' : 'Export tree'}
      </button>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </>
  )
}
