// ContentModerationActions.tsx — right-rail buttons for the moderation queue.

'use client'

import { useState, useTransition } from 'react'
import {
  moderateReviewAction,
  changeProductStatusAction,
} from '../actions/reviewModerationActions'
import styles from './ContentModerationActions.module.css'

type CommonProps = {
  productId: number
}

export function ContentModerationActions(props:
  | ({ kind: 'review'; reviewId: number; status: string } & CommonProps)
  | ({ kind: 'product' } & CommonProps)
) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function reload() {
    // Server component re-renders when we navigate (the action's
    // revalidatePath is implicit via the audit log insert).
    window.location.reload()
  }

  function actAs(kind: 'approve' | 'reject' | 'clear_flag') {
    if (props.kind !== 'review') return
    startTransition(async () => {
      const result = await moderateReviewAction({ reviewId: props.reviewId, action: kind })
      if (result.ok) {
        reload()
      } else {
        setErrorMessage(result.error)
      }
    })
  }

  function setStatus(newStatus: 'published' | 'draft' | 'archived') {
    if (props.kind !== 'product') return
    startTransition(async () => {
      const result = await changeProductStatusAction({ productId: props.productId, newStatus })
      if (result.ok) {
        reload()
      } else {
        setErrorMessage(result.error)
      }
    })
  }

  return (
    <div className={styles.rail}>
      {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
      {props.kind === 'review' ? (
        <div className={styles.buttonGroup}>
          <button type="button" className={styles.approve} onClick={() => actAs('approve')}>
            Approve
          </button>
          <button type="button" className={styles.reject} onClick={() => actAs('reject')}>
            Reject
          </button>
          <button type="button" className={styles.clear} onClick={() => actAs('clear_flag')}>
            Clear flag
          </button>
        </div>
      ) : (
        <div className={styles.buttonGroup}>
          <button type="button" className={styles.publish} onClick={() => setStatus('published')}>
            Publish
          </button>
          <button type="button" className={styles.draft} onClick={() => setStatus('draft')}>
            Move to draft
          </button>
          <button type="button" className={styles.archive} onClick={() => setStatus('archived')}>
            Archive
          </button>
        </div>
      )}
    </div>
  )
}
