// AddCategoryModal.tsx — modal for creating a new category. Renders
// a controlled form with name / slug (auto-gen) / description / parent.
// Uses native HTML5 drag-and-drop patterns elsewhere in the app, so
// no third-party modal library is used here; we render a dialog-like
// <div role="dialog" aria-modal="true"> with a backdrop.

'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@foundations/ui/primitives/Button'
import { addCategoryAction } from '../actions/addCategory'
import type { ParentOption } from '../types'
import styles from './Modal.module.css'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function AddCategoryModal({
  parents,
  onClose,
  defaultParentId = null,
}: {
  parents: ParentOption[]
  onClose: () => void
  defaultParentId?: number | null
}) {
  const router = useRouter()
  const formId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState<string>(defaultParentId != null ? String(defaultParentId) : '')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  // Auto-gen slug from name (only while the user hasn't manually edited).
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name))
  }, [name, slugTouched])

  // Focus management: focus the name input on mount; trap focus inside
  // the dialog; close on Escape.
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
      const res = await addCategoryAction({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        parent_id: parentId === '' ? null : Number(parentId),
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
          Add category
        </h2>
        <form id={formId} onSubmit={onSubmit} className={styles.form}>
          <Input
            name="name"
            label="Name"
            placeholder="e.g. Photography"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            error={fieldErrors.name}
          />
          <Input
            name="slug"
            label="Slug"
            placeholder="photography"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugTouched(true)
            }}
            required
            maxLength={120}
            hint="URL-safe identifier; lowercase letters, digits, hyphens"
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
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {fieldErrors.parent_id && (
              <span className={styles.error}>{fieldErrors.parent_id}</span>
            )}
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
            <button type="submit" className={styles.primary} disabled={isPending}>
              {isPending ? 'Adding…' : 'Add category'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
