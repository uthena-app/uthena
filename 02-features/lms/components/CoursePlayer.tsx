// CoursePlayer.tsx — CLIENT island; lesson shell + nav.
//
// Wraps `<VideoPlayer>` (P7.6) for the LMS context. Owns:
//   - video element wrapper + lesson title + summary
//   - prev/next nav
//   - mark complete + bookmark buttons (separate small client islands)
//   - debounced progress writer (5s on timeupdate + on ended + on unmount)
//   - "Mark complete" CTA
//
// Re-mounts on lessonId change; the player's `key` prop forces a fresh
// video element so position + duration reset cleanly. Auto-resume uses
// the lesson's `progress.position_seconds` from the server (passed via
// `initialSeekSeconds`).

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { VideoPlayer } from '@features/library/components/VideoPlayer'
import { MarkCompleteButton } from './MarkCompleteButton'
import { BookmarkButton } from './BookmarkButton'
import { updateLessonProgressAction } from '../actions/updateLessonProgress'
import { clampPosition, isCompleteAtPosition } from '../lib/formatLessonDuration'
import styles from './CoursePlayer.module.css'

export type CoursePlayerProps = {
  productId: number
  productSlug: string
  lessonId: number
  lessonTitle: string
  lessonSummary: string | null
  durationSeconds: number
  /** Pre-minted stream URL. Falls back to a demo HLS source for missing files. */
  src: string | null
  /** Initial seek target — the user's last watched position (or 0). */
  initialSeekSeconds: number
  initiallyCompleted: boolean
  initiallyBookmarked: boolean
  prevLessonUrl: string | null
  nextLessonUrl: string | null
}

const POSITION_DEBOUNCE_MS = 5_000

export function CoursePlayer(props: CoursePlayerProps) {
  const {
    productId,
    productSlug,
    lessonId,
    lessonTitle,
    lessonSummary,
    src,
    initialSeekSeconds,
    initiallyCompleted,
    initiallyBookmarked,
    prevLessonUrl,
    nextLessonUrl,
  } = props

  const [completed, setCompleted] = useState(initiallyCompleted)
  const [position, setPosition] = useState<number>(initialSeekSeconds)
  const [isPending, startTransition] = useTransition()

  const lastWrittenAt = useRef<number>(Date.now())
  const pendingFlush = useRef<{ positionSeconds: number; completed: boolean } | null>(null)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flush pending progress to server. Idempotent — server UPSERT handles dedup.
  function scheduleFlush(positionSeconds: number, isCompleted: boolean) {
    pendingFlush.current = { positionSeconds, completed: isCompleted }
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(() => {
      const pending = pendingFlush.current
      pendingFlush.current = null
      flushTimer.current = null
      if (!pending) return
      lastWrittenAt.current = Date.now()
      startTransition(async () => {
        await updateLessonProgressAction({
          productId,
          lessonId,
          positionSeconds: pending.positionSeconds,
          completed: pending.completed,
        })
      })
    }, POSITION_DEBOUNCE_MS)
  }

  // Flush on unmount so a fast navigation doesn't lose progress.
  useEffect(() => {
    return () => {
      const pending = pendingFlush.current
      if (pending && flushTimer.current) {
        clearTimeout(flushTimer.current)
      }
      if (pending) {
        // Fire-and-forget; server UPSERT is idempotent.
        void updateLessonProgressAction({
          productId,
          lessonId,
          positionSeconds: pending.positionSeconds,
          completed: pending.completed,
        })
      }
    }
  }, [productId, lessonId])

  return (
    <div className={styles.root}>
      <div className={styles.playerWrapper}>
        {src ? (
          <VideoPlayer
            key={lessonId}
            src={src}
            title={lessonTitle}
            initialSeekSeconds={initialSeekSeconds}
            onTimeUpdate={(seconds, duration) => {
              const clamped = clampPosition(seconds, duration)
              setPosition(clamped)
              if (isCompleteAtPosition(clamped, duration)) {
                if (!completed) {
                  setCompleted(true)
                  scheduleFlush(clamped, true)
                }
              } else {
                scheduleFlush(clamped, completed)
              }
            }}
            onEnded={(duration) => {
              if (!completed) {
                setCompleted(true)
                const endPosition = clampPosition(duration, duration)
                scheduleFlush(endPosition, true)
              }
            }}
          />
        ) : (
          <div className={styles.playerPlaceholder}>
            <p>This lesson has no media file attached yet.</p>
          </div>
        )}
      </div>

      <div className={styles.meta}>
        <h1 className={styles.title}>{lessonTitle}</h1>
        {lessonSummary ? <p className={styles.summary}>{lessonSummary}</p> : null}

        <div className={styles.actions}>
          <MarkCompleteButton
            lessonId={lessonId}
            productId={productId}
            completed={completed}
            onChange={(c) => {
              setCompleted(c)
              scheduleFlush(position, c)
            }}
          />
          <BookmarkButton
            lessonId={lessonId}
            productId={productId}
            bookmarked={initiallyBookmarked}
          />
          {isPending ? <span className={styles.pendingBadge}>Saving…</span> : null}
        </div>
      </div>

      <nav className={styles.nav} aria-label="Lesson navigation">
        {prevLessonUrl !== null ? (
          <a href={prevLessonUrl} className={styles.navPrev}>
            ← Previous lesson
          </a>
        ) : (
          <span className={styles.navDisabled}>← No previous lesson</span>
        )}
        {nextLessonUrl !== null ? (
          <a href={nextLessonUrl} className={styles.navNext}>
            Next lesson →
          </a>
        ) : (
          <span className={styles.navDisabled}>No next lesson →</span>
        )}
      </nav>
    </div>
  )
}
