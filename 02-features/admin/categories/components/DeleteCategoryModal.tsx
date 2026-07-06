// DeleteCategoryModal.tsx — modal for confirming a category delete.
// "Type DELETE to confirm" + impact summary. Submit is disabled until
// the typed confirmation matches AND the impact is zero (no products,
// no children). If the server reports a non-zero impact, the modal
// is disabled and the error message is shown.

'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCategoryAction } from '../actions/deleteCategory'
import type { CategoryNode } from '../types'
import styles from './Modal.module.css'

const REQUIRED = 'DELETE'

export function DeleteCategoryModal({
  category,
  childCount,
  onClose,
}: {
  category: CategoryNode
  childCount: number
  onClose: () => void
}) {
  const router = useRouter()
  const formId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const productCount = category.product_count_cache ?? 0
  const hasProducts = productCount > 0
  const hasChildren = childCount > 0
  const canDelete = !hasProducts && !hasChildren && confirm === REQUIRED

  useEffect(() => {
    const input = dialogRef.current?.querySelector<HTMLInputElement>('input[name="confirm"]')
    input?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canDelete) return
    setError(null)
    startTransition(async () => {
      const res = await deleteCategoryAction({ id: category.id })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onClose()
      router.refresh()
    })
  }

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
      >
        <h2 id={`${formId}-title`} className={styles.title}>
          Delete &ldquo;{category.name}&rdquo;?
        </h2>

        <div className={styles.impactBox}>
          <span>
            <strong>{productCount}</strong> product{productCount === 1 ? '' : 's'}
          </span>
          <span>
            <strong>{childCount}</strong> sub-categor{childCount === 1 ? 'y' : 'ies'}
          </span>
        </div>

        {hasProducts && (
          <p className={styles.error} role="alert">
            This category can&apos;t be deleted because it has products. Move or
            archive the products first.
          </p>
        )}
        {!hasProducts && hasChildren && (
          <p className={styles.error} role="alert">
            This category can&apos;t be deleted because it has sub-categories. Move or
            delete the sub-categories first.
          </p>
        )}
        {!hasProducts && !hasChildren && (
          <form id={formId} onSubmit={onSubmit} className={styles.form}>
            <label className={styles.confirmField}>
              <span>Type {REQUIRED} to confirm</span>
              <input
                name="confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={styles.select}
                autoComplete="off"
                spellCheck={false}
                aria-label="Confirmation"
              />
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                onClick={onClose}
                className={styles.secondary}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.danger}
                disabled={!canDelete || isPending}
              >
                {isPending ? 'Deleting…' : 'Delete category'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
