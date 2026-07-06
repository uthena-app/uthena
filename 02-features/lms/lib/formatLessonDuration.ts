// formatLessonDuration.ts — pure helpers for LMS lesson display.
//
// No React / no DOM. Imported in server + client + tests.

/**
 * Format a duration in seconds as "M:SS" (or "H:MM:SS" if >= 1 hour).
 * Pure. Whole seconds only — floors fractional input.
 *
 * Examples:
 *   0 → "0:00"
 *   65 → "1:05"
 *   3661 → "1:01:01"
 *   599 → "9:59"
 *   NaN / negative / Infinity → "0:00" (defensive)
 */
export function formatLessonDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const s = Math.floor(totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Sum a list of durations, returning the total in seconds.
 * Pure. Defensive: skips non-finite / negative values.
 */
export function sumDurations(durations: ReadonlyArray<number>): number {
  let sum = 0
  for (const d of durations) {
    if (Number.isFinite(d) && d >= 0) sum += Math.floor(d)
  }
  return sum
}

/**
 * Detect "completion" — true when the watched position is within
 * 5 seconds of the lesson duration. Matches the spec at
 * `01-specs/pages/library-watch.md` §Completion.
 *
 * If duration is 0 (non-video lesson or not yet encoded), the spec
 * falls back to "user clicked Mark complete" — so this returns false.
 */
export function isCompleteAtPosition(positionSeconds: number, durationSeconds: number): boolean {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return false
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false
  return positionSeconds >= durationSeconds - 5
}

/**
 * Clamp a position to the lesson duration (rounded to whole seconds).
 * Returns 0 if duration is 0 / NaN / negative.
 */
export function clampPosition(positionSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return 0
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return Math.floor(positionSeconds)
  return Math.min(Math.floor(positionSeconds), Math.floor(durationSeconds))
}
