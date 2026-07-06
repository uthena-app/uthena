// BookmarkButton.tsx — CLIENT island. Add / remove a per-lesson bookmark.

'use client'

import { useState, useTransition } from 'react'
import { toggleBookmarkAction } from '../actions/toggleBookmark'
import styles from './BookmarkButton.module.css'

export function BookmarkButton(props: {
  lessonId: number
  productId: number
  bookmarked: boolean
}) {
  const { lessonId, productId, bookmarked } = props
  const [optimistic, setOptimistic] = useState(bookmarked)
  const [, startTransition] = useTransition()

  function handleClick() {
    const next = !optimistic
    setOptimistic(next)
    startTransition(async () => {
      const result = await toggleBookmarkAction({ lessonId, productId })
      if (!result.ok) {
        setOptimistic(!next)
      } else if (result.bookmarked !== next) {
        setOptimistic(result.bookmarked)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={optimistic ? styles.on : styles.off}
      aria-pressed={optimistic}
      data-bookmarked={optimistic ? 'yes' : 'no'}
    >
      <span className={styles.icon} aria-hidden>
        {optimistic ? '★' : '☆'}
      </span>
      <span>{optimistic ? 'Bookmarked' : 'Bookmark'}</span>
    </button>
  )
}
