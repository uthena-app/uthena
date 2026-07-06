// LessonList.tsx — SERVER component. Sidebar with section + lesson items.
//
// Highlights the current lesson. Each lesson is a link to the watch
// route. Per-lesson progress (completed, position) renders as icons.
// Preview lessons (is_preview=true) get a "Preview" pill so the user
// knows they're free.

import { formatLessonDuration } from '../lib/formatLessonDuration'
import type { LessonForShell, ModuleForShell } from '../queries/getCourseWithLessons'
import styles from './LessonList.module.css'

export function LessonList(props: {
  productSlug: string
  modules: ModuleForShell[]
  currentLessonId: number
}) {
  const { productSlug, modules, currentLessonId } = props

  if (modules.length === 0) {
    return (
      <aside className={styles.empty} aria-label="Lesson list">
        <p className={styles.emptyText}>
          The instructor hasn't published any lessons yet. Check back soon.
        </p>
      </aside>
    )
  }

  return (
    <aside className={styles.sidebar} aria-label="Lesson list">
      <h2 className={styles.heading}>Course content</h2>
      <ol className={styles.modulesList}>
        {modules.map((module) => (
          <li key={module.id} className={styles.module}>
            <div className={styles.moduleHeader}>
              <h3 className={styles.moduleTitle}>{module.title}</h3>
              <p className={styles.moduleMeta}>
                {module.lessons.length} lesson{module.lessons.length === 1 ? '' : 's'}
                {' · '}
                {module.total_duration_label}
              </p>
            </div>
            <ol className={styles.lessonsList}>
              {module.lessons.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  productSlug={productSlug}
                  lesson={lesson}
                  isCurrent={lesson.id === currentLessonId}
                />
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </aside>
  )
}

function LessonRow(props: {
  productSlug: string
  lesson: LessonForShell
  isCurrent: boolean
}) {
  const { productSlug, lesson, isCurrent } = props
  const href = `/learn/${productSlug}/lessons/${lesson.id}`
  const state = lesson.progress
  const stateClass =
    state?.completed ? styles.completed : isCurrent ? styles.current : styles.upcoming
  return (
    <li className={stateClass}>
      <a
        href={href}
        className={styles.link}
        aria-current={isCurrent ? 'page' : undefined}
        data-lesson-id={lesson.id}
        data-state={state?.completed ? 'completed' : isCurrent ? 'current' : 'upcoming'}
      >
        <span className={styles.checkmark} aria-hidden>
          {state?.completed ? '✓' : isCurrent ? '▶' : '○'}
        </span>
        <span className={styles.lessonInfo}>
          <span className={styles.lessonTitle}>{lesson.title}</span>
          <span className={styles.lessonMeta}>
            {formatLessonDuration(lesson.duration_seconds)}
            {lesson.is_preview ? <span className={styles.previewPill}>Preview</span> : null}
            {state && !state.completed && state.position_seconds > 0 ? (
              <span className={styles.partialPill}>
                {formatLessonDuration(state.position_seconds)} watched
              </span>
            ) : null}
          </span>
        </span>
      </a>
    </li>
  )
}
