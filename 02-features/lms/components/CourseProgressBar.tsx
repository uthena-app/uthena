// CourseProgressBar.tsx — SERVER; per-course completion bar + label.
//
// Pure component, takes a CourseProgress (or null) and renders the
// bar + percentage label + lesson count. Used on `/library` rows.

import styles from './CourseProgressBar.module.css'

export function CourseProgressBar(props: {
  percent: number
  totalLessons: number
  completedLessons: number
}) {
  const { percent, totalLessons, completedLessons } = props
  const clampedPercent = Math.max(0, Math.min(100, Math.floor(percent)))
  const status =
    clampedPercent === 0
      ? 'not-started'
      : clampedPercent >= 100
        ? 'completed'
        : 'in-progress'

  return (
    <div
      className={styles.root}
      data-progress-status={status}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedPercent}
      aria-valuetext={`${clampedPercent}% complete (${completedLessons} of ${totalLessons} lessons)`}
    >
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${clampedPercent}%` }} />
      </div>
      <div className={styles.label}>
        <span className={styles.percent}>{clampedPercent}%</span>
        <span className={styles.count}>
          {completedLessons}/{totalLessons} lessons
        </span>
      </div>
    </div>
  )
}
