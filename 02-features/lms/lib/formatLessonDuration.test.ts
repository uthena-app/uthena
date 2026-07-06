// formatLessonDuration.test.ts — pure unit tests. No DOM, no network.
// 12 tests cover the canonical shapes + every defensive branch.

import { describe, expect, it } from 'vitest'
import {
  formatLessonDuration,
  sumDurations,
  isCompleteAtPosition,
  clampPosition,
} from './formatLessonDuration'

describe('formatLessonDuration', () => {
  it('formats under-an-hour durations as M:SS', () => {
    expect(formatLessonDuration(0)).toBe('0:00')
    expect(formatLessonDuration(5)).toBe('0:05')
    expect(formatLessonDuration(65)).toBe('1:05')
    expect(formatLessonDuration(599)).toBe('9:59')
    expect(formatLessonDuration(3600 - 1)).toBe('59:59')
  })

  it('formats hour-or-more durations as H:MM:SS with leading zero on min/sec', () => {
    expect(formatLessonDuration(3600)).toBe('1:00:00')
    expect(formatLessonDuration(3661)).toBe('1:01:01')
    expect(formatLessonDuration(7325)).toBe('2:02:05')
  })

  it('floors fractional seconds', () => {
    expect(formatLessonDuration(65.7)).toBe('1:05')
    expect(formatLessonDuration(0.999)).toBe('0:00')
  })

  it('returns "0:00" on every defensive branch', () => {
    expect(formatLessonDuration(NaN)).toBe('0:00')
    expect(formatLessonDuration(Infinity)).toBe('0:00')
    expect(formatLessonDuration(-Infinity)).toBe('0:00')
    expect(formatLessonDuration(-1)).toBe('0:00')
  })
})

describe('sumDurations', () => {
  it('sums valid durations + ignores invalid', () => {
    expect(sumDurations([60, 65, 70])).toBe(195)
    expect(sumDurations([60, NaN, 70])).toBe(130)
    expect(sumDurations([60, -5, 70])).toBe(130)
    expect(sumDurations([])).toBe(0)
    expect(sumDurations([60.7, 70.9])).toBe(130) // floors each
  })
})

describe('isCompleteAtPosition', () => {
  it('triggers within 5s of duration', () => {
    expect(isCompleteAtPosition(60, 65)).toBe(true)
    expect(isCompleteAtPosition(64, 65)).toBe(true)
    expect(isCompleteAtPosition(60, 60)).toBe(true) // exactly at duration
  })

  it('does not trigger when there is a > 5s gap', () => {
    expect(isCompleteAtPosition(50, 65)).toBe(false)
    expect(isCompleteAtPosition(59, 65)).toBe(false)
  })

  it('returns false for invalid inputs', () => {
    expect(isCompleteAtPosition(NaN, 60)).toBe(false)
    expect(isCompleteAtPosition(60, 0)).toBe(false)
    expect(isCompleteAtPosition(60, NaN)).toBe(false)
    expect(isCompleteAtPosition(-1, 60)).toBe(false)
  })
})

describe('clampPosition', () => {
  it('clamps to duration (whole seconds)', () => {
    expect(clampPosition(70, 65)).toBe(65)
    expect(clampPosition(60.7, 65)).toBe(60)
    expect(clampPosition(60, 65)).toBe(60)
  })

  it('returns 0 for invalid inputs', () => {
    expect(clampPosition(-1, 65)).toBe(0)
    expect(clampPosition(NaN, 65)).toBe(0)
    expect(clampPosition(60, 0)).toBe(60) // no duration → just floor
    expect(clampPosition(60, NaN)).toBe(60)
  })
})
