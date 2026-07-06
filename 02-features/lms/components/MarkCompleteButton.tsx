// MarkCompleteButton.tsx — CLIENT island. "Mark complete" / "Mark incomplete" CTA.
//
// Updates the local optimistic state immediately; calls the server action;
// rolls back on failure (the server UPSERT is idempotent so a double-click
// is safe).

'use client'

import { useState, useTransition } from 'react'
import { updateLessonProgressAction } from '../actions/updateLessonProgress'
import styles from './MarkCompleteButton.module.css'

export function MarkCompleteButton(props: {
  lessonId: number
  productId: number
  completed: boolean
  onChange: (completed: boolean) => void
}) {
  const { lessonId, productId, completed, onChange } = props
  const [optimistic, setOptimistic] = useState(completed)
  const [, startTransition] = useTransition()

  function handleClick() {
    const next = !optimistic
    setOptimistic(next)
    onChange(next)
    startTransition(async () => {
      const result = await updateLessonProgressAction({
        lessonId,
        productId,
        positionSeconds: 0, // server uses existing position; explicit completion only
        completed: next,
      })
      if (!result.ok) {
        setOptimistic(!next)
        onChange(!next)
        // The spec wants a non-noisy error UX; the server action returns
        // a friendly error we could surface via toast — for v1 we silently
        // roll back. (Future: emit a toast.)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={optimistic ? styles.doneButton : styles.button}
      aria-pressed={optimistic}
      data-complete={optimistic ? 'yes' : 'no'}
    >
      <span className={styles.icon} aria-hidden>
        {optimistic ? '✓' : '○'}
      </span>
      <span>{optimistic ? 'Completed' : 'Mark complete'}</span>
    </button>
  )
}
