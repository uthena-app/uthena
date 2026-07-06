'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@foundations/ui/primitives/Button'
import {
  createReviewAction,
  updateReviewAction,
  deleteReviewAction,
} from '../actions/reviewActions'
import type { MyReview, ReviewableProduct } from '../queries/getMyReviews'
import styles from './ReviewsSection.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (days < 1) return 'today'
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`
  return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`
}

function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (n: number) => void
  disabled?: boolean
}) {
  return (
    <div className={styles.starPicker} role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(n)}
          disabled={disabled}
          className={`${styles.star} ${value >= n ? styles.starOn : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function StatusPill({ status }: { status: MyReview['status'] }) {
  const label =
    status === 'pending'
      ? 'Pending review'
      : status === 'published'
        ? 'Published'
        : status === 'hidden'
          ? 'Hidden'
          : 'Flagged'
  const cls =
    status === 'pending'
      ? styles.pillPending
      : status === 'published'
        ? styles.pillPublished
        : status === 'hidden'
          ? styles.pillHidden
          : styles.pillFlagged
  return <span className={`${styles.pill} ${cls}`}>{label}</span>
}

function ReviewForm({
  product,
  initial,
  onClose,
}: {
  product?: ReviewableProduct
  initial?: MyReview
  onClose: () => void
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  const isEdit = Boolean(initial)
  const productId = initial?.product_id ?? product?.product_id

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    if (rating < 1) {
      setFieldErrors({ rating: 'Pick a rating.' })
      return
    }
    if (body.trim().length < 50) {
      setFieldErrors({ body: 'At least 50 characters.' })
      return
    }
    startTransition(async () => {
      const result = isEdit
        ? await updateReviewAction({ reviewId: initial!.id, rating, title, body })
        : await createReviewAction({ productId: productId!, rating, title, body })
      if (!result.ok) {
        setError(result.error)
        if (result.fieldErrors) setFieldErrors(result.fieldErrors)
        return
      }
      onClose()
    })
  }

  const onDelete = () => {
    if (!initial) return
    if (!window.confirm('Delete this review? You cannot resubmit for the same product.')) return
    startTransition(async () => {
      const result = await deleteReviewAction({ reviewId: initial.id })
      if (!result.ok) {
        setError(result.error ?? 'Could not delete.')
        return
      }
      onClose()
    })
  }

  return (
    <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={onSubmit} className={styles.modal} noValidate>
        <h2 className={styles.modalH}>
          {isEdit ? 'Edit your review' : 'Write a review'}
          {product && <span className={styles.modalSubtitle}>{product.product_title}</span>}
        </h2>

        <div className={styles.field}>
          <label className={styles.label}>Rating</label>
          <StarPicker value={rating} onChange={setRating} disabled={isPending} />
          {fieldErrors.rating && (
            <p className={styles.error} role="alert">
              {fieldErrors.rating}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="title" className={styles.label}>
            Title <span className={styles.optional}>(optional, max 80 chars)</span>
          </label>
          <input
            id="title"
            type="text"
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            maxLength={80}
            disabled={isPending}
          />
          {fieldErrors.title && (
            <p className={styles.error} role="alert">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="body" className={styles.label}>
            Your review <span className={styles.optional}>(50–2000 characters)</span>
          </label>
          <textarea
            id="body"
            className={styles.textarea}
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            maxLength={2000}
            rows={6}
            disabled={isPending}
          />
          <p className={styles.counter}>
            {body.length} / 2000
          </p>
          {fieldErrors.body && (
            <p className={styles.error} role="alert">
              {fieldErrors.body}
            </p>
          )}
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.modalActions}>
          {isEdit && (
            <Button type="button" variant="danger" onClick={onDelete} disabled={isPending}>
              Delete
            </Button>
          )}
          <span className={styles.spacer} />
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isPending}>
            {isEdit ? 'Save changes' : 'Submit review'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ReviewCard({ review, onEdit }: { review: MyReview; onEdit: () => void }) {
  return (
    <article className={styles.reviewCard}>
      <div className={styles.reviewHeader}>
        <div>
          <p className={styles.reviewTitle}>
            {review.product_slug ? (
              <Link href={`/products/${review.product_slug}`} className={styles.reviewProduct}>
                {review.product_title}
              </Link>
            ) : (
              review.product_title
            )}
          </p>
          <div className={styles.reviewMeta}>
            <span className={styles.stars} aria-label={`${review.rating} out of 5 stars`}>
              {'★'.repeat(review.rating)}
              <span className={styles.starsOff}>{'★'.repeat(5 - review.rating)}</span>
            </span>
            <span className={styles.dot}>·</span>
            <span>{relativeTime(review.created_at)}</span>
            <StatusPill status={review.status} />
          </div>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      {review.title && <p className={styles.reviewHeadline}>{review.title}</p>}
      <p className={styles.reviewBody}>
        {review.body.length > 240 ? review.body.slice(0, 240) + '…' : review.body}
      </p>
    </article>
  )
}

export function ReviewsSection({
  reviews,
  reviewable,
}: {
  reviews: MyReview[]
  reviewable: ReviewableProduct[]
}) {
  const [editingReview, setEditingReview] = useState<MyReview | null>(null)
  const [writingFor, setWritingFor] = useState<ReviewableProduct | null>(null)

  return (
    <div className={styles.wrap}>
      <section className={styles.section}>
        <h2 className={styles.h2}>
          My reviews
          <span className={styles.count}>{reviews.length}</span>
        </h2>
        {reviews.length === 0 ? (
          <p className={styles.empty}>You haven&apos;t written any reviews yet.</p>
        ) : (
          <div className={styles.list}>
            {reviews.map((r) => (
              <ReviewCard key={r.id} review={r} onEdit={() => setEditingReview(r)} />
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>
          Leave a new review
          <span className={styles.count}>{reviewable.length}</span>
        </h2>
        {reviewable.length === 0 ? (
          <p className={styles.empty}>
            {reviews.length === 0
              ? 'Buy a product to leave your first review.'
              : "You've reviewed every product you own. Thank you!"}
          </p>
        ) : (
          <ul className={styles.list}>
            {reviewable.map((p) => (
              <li key={p.product_id} className={styles.reviewableRow}>
                <div>
                  <p className={styles.reviewTitle}>
                    {p.product_slug ? (
                      <Link href={`/products/${p.product_slug}`} className={styles.reviewProduct}>
                        {p.product_title}
                      </Link>
                    ) : (
                      p.product_title
                    )}
                  </p>
                  <p className={styles.reviewMeta}>
                    {p.partner_name && <>by {p.partner_name} · </>}
                    {p.license && <>{p.license} · </>}
                    granted {formatDate(p.granted_at)}
                  </p>
                </div>
                <Button type="button" variant="primary" size="sm" onClick={() => setWritingFor(p)}>
                  Write review
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(editingReview || writingFor) && (
        <ReviewForm
          {...(editingReview ? { initial: editingReview } : { product: writingFor! })}
          onClose={() => {
            setEditingReview(null)
            setWritingFor(null)
          }}
        />
      )}
    </div>
  )
}
