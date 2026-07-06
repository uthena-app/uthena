// CourseSettingsForm — client component. The Settings tab on
// /partner/courses/[id]. Renders the editable product metadata
// fields (title, short_description, long_description, category_id,
// kind) and persists changes via updateProductSettingsAction.
//
// P12.6 Slice 1: the Settings tab is the first of the 5 tabs to
// ship. Curriculum / Pricing / Sales / Reviews ship in subsequent
// slices; their tabs render "coming soon" placeholders in the
// page route.

'use client'

import { useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { updateProductSettingsAction } from '../actions/updateProductSettings'
import type { PartnerCourseDetail } from '../queries/getMyCourseDetail'
import type { CategoryOption } from '../queries/listPartnerCategories'
import { tiptapDocToText } from '../lib/tiptapDocToText'
import { PRODUCT_KINDS } from '@foundations/data/enums'
import styles from './CourseSettingsForm.module.css'

const KIND_LABELS: Record<(typeof PRODUCT_KINDS)[number], string> = {
  video_course: 'Video course',
  ebook: 'eBook',
  template_pack: 'Template pack',
  audio_course: 'Audio course',
  bundle: 'Bundle',
  asset_pack: 'Asset pack',
}

const LONG_DESCRIPTION_MAX = 10_000

export function CourseSettingsForm({
  course,
  categories,
}: {
  course: PartnerCourseDetail
  categories: CategoryOption[]
}) {
  const [title, setTitle] = useState(course.title)
  const [shortDescription, setShortDescription] = useState(course.short_description)
  const [longDescription, setLongDescription] = useState(() => tiptapDocToText(course.long_description))
  const [categoryId, setCategoryId] = useState(String(course.category_id))
  const [kind, setKind] = useState<(typeof PRODUCT_KINDS)[number]>(course.kind)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const dirty =
    title !== course.title ||
    shortDescription !== course.short_description ||
    longDescription !== tiptapDocToText(course.long_description) ||
    categoryId !== String(course.category_id) ||
    kind !== course.kind

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})
    setSubmitError(null)
    setSuccess(false)
    startTransition(async () => {
      const result = await updateProductSettingsAction({
        productId: course.id,
        title,
        shortDescription,
        longDescription,
        categoryId,
        kind,
      })
      if (!result.ok) {
        setSubmitError(result.error)
        if (result.fieldErrors) setErrors(result.fieldErrors)
        return
      }
      setSuccess(true)
    })
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <div className={styles.field}>
        <label htmlFor="title" className={styles.label}>
          Title <span className={styles.optional}>(max 200 chars)</span>
        </label>
        <input
          id="title"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 200))}
          maxLength={200}
          required
        />
        <p className={styles.counter}>
          {title.length} / 200
        </p>
        {errors.title && (
          <p className={styles.error} role="alert">
            {errors.title}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="shortDescription" className={styles.label}>
          Short description <span className={styles.optional}>(max 280 chars)</span>
        </label>
        <textarea
          id="shortDescription"
          className={styles.textarea}
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value.slice(0, 280))}
          maxLength={280}
          rows={3}
          required
        />
        <p className={styles.counter}>
          {shortDescription.length} / 280
        </p>
        {errors.shortDescription && (
          <p className={styles.error} role="alert">
            {errors.shortDescription}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="longDescription" className={styles.label}>
          Long description <span className={styles.optional}>(markdown, max {LONG_DESCRIPTION_MAX.toLocaleString('en-US')} chars)</span>
        </label>
        <textarea
          id="longDescription"
          className={`${styles.textarea} ${styles.textareaLg}`}
          value={longDescription}
          onChange={(e) => setLongDescription(e.target.value.slice(0, LONG_DESCRIPTION_MAX))}
          maxLength={LONG_DESCRIPTION_MAX}
          rows={10}
        />
        <p className={styles.counter}>
          {longDescription.length.toLocaleString('en-US')} / {LONG_DESCRIPTION_MAX.toLocaleString('en-US')}
        </p>
        <p className={styles.help}>
          Saved as a TipTap document on the storefront. Blank lines become paragraph breaks. Rich text editor ships in a later slice.
        </p>
        {errors.longDescription && (
          <p className={styles.error} role="alert">
            {errors.longDescription}
          </p>
        )}
      </div>

      <div className={styles.grid2}>
        <div className={styles.field}>
          <label htmlFor="categoryId" className={styles.label}>
            Category
          </label>
          <select
            id="categoryId"
            className={styles.select}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            {categories.length === 0 ? (
              <option value="">No categories available</option>
            ) : (
              categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
          {errors.categoryId && (
            <p className={styles.error} role="alert">
              {errors.categoryId}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="kind" className={styles.label}>
            Kind
          </label>
          <select
            id="kind"
            className={styles.select}
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof PRODUCT_KINDS)[number])}
            required
          >
            {PRODUCT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {errors.kind && (
            <p className={styles.error} role="alert">
              {errors.kind}
            </p>
          )}
        </div>
      </div>

      {submitError && (
        <p className={styles.submitError} role="alert">
          {submitError}
        </p>
      )}
      {success && (
        <p className={styles.submitOk} role="status">
          Saved.
        </p>
      )}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={!dirty || isPending} loading={isPending}>
          Save changes
        </Button>
      </div>
    </form>
  )
}