// EditCategoryModal.tsx — modal for editing an existing category.
// Pre-fills from the row, validates cycle/depth, submits via
// updateCategoryAction.

'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@foundations/ui/primitives/Button'
import { updateCategoryAction } from '../actions/updateCategory'
import type { CategoryNode, ParentOption } from '../types'
import styles from './Modal.module.css'

export function EditCategoryModal({
  category,
  parents,
  onClose,
}: {
  category: CategoryNode
  parents: ParentOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const formId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [name, setName] = useState(category.name)
  const [slug, setSlug] = useState(category.slug)
  const [description, setDescription] = useState(category.description ?? '')
  const [parentId, setParentId] = useState<string>(
    category.parent_id != null ? String(category.parent_id) : '',
  )
  const [displayOrder, setDisplayOrder] = useState(String(category.display_order))
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const nameInput = dialogRef.current?.querySelector<HTMLInputElement>('input[name="name"]')
    nameInput?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!first || !last) return
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    startTransition(async () => {
      const res = await updateCategoryAction({
        id: category.id,
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        parent_id: parentId === '' ? null : Number(parentId),
        display_order: Number(displayOrder) || 0,
      })
      if (!res.ok) {
        setError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      onClose()
      router.refresh()
    })
  }

  // Don't allow selecting this category as its own parent.
  const selectableParents = parents.filter((p) => p.id !== category.id)

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
          Edit category
        </h2>
        <form id={formId} onSubmit={onSubmit} className={styles.form}>
          <Input
            name="name"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            error={fieldErrors.name}
          />
          <Input
            name="slug"
            label="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            maxLength={120}
            hint="Changing the slug will break inbound /collections/[slug] links."
            error={fieldErrors.slug}
          />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Description</span>
            <textarea
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              className={styles.textarea}
            />
            {fieldErrors.description && (
              <span className={styles.error}>{fieldErrors.description}</span>
            )}
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Parent</span>
            <select
              name="parent_id"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className={styles.select}
            >
              <option value="">— Top level —</option>
              {selectableParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {fieldErrors.parent_id && (
              <span className={styles.error}>{fieldErrors.parent_id}</span>
            )}
          </label>
          <Input
            name="display_order"
            label="Display order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            min={0}
            max={100000}
            error={fieldErrors.display_order}
          />

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
            <button type="submit" className={styles.primary} disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
