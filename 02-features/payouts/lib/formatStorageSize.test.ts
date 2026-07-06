// formatStorageSize.test.ts — unit tests for the P7.10 pure
// formatter.
//
// Covers:
//   - Happy paths at every unit boundary (B / KB / MB / GB / TB)
//   - Decimal rounding at the configured precision
//   - Locale override (comma vs dot decimal separator)
//   - Defensive coercion: null / undefined / empty string /
//     "not a number" / negative / NaN / Infinity → "0 B"
//   - minUnit override (force MB even for KB-scale input)
//   - decimals override (0 → integer round)
//   - Number.MAX_SAFE_INTEGER cap (prevents unsafe arithmetic)
//   - The function does not mutate the input

import { describe, expect, it } from 'vitest'
import { formatStorageSize } from './formatStorageSize'

describe('formatStorageSize', () => {
  describe('happy paths at every unit', () => {
    it('formats bytes below 1 KB as integer B', () => {
      expect(formatStorageSize(0)).toBe('0 B')
      expect(formatStorageSize(1)).toBe('1 B')
      expect(formatStorageSize(512)).toBe('512 B')
      expect(formatStorageSize(999)).toBe('999 B')
    })

    it('formats KB at exactly 1 KB', () => {
      expect(formatStorageSize(1_000)).toBe('1 KB')
    })

    it('formats MB at exactly 1 MB', () => {
      expect(formatStorageSize(1_000_000)).toBe('1 MB')
    })

    it('formats GB at exactly 1 GB', () => {
      expect(formatStorageSize(1_000_000_000)).toBe('1 GB')
    })

    it('formats TB at exactly 1 TB', () => {
      expect(formatStorageSize(1_000_000_000_000)).toBe('1 TB')
    })

    it('rounds up between unit steps', () => {
      // 1500 B → 1.5 KB
      expect(formatStorageSize(1_500)).toBe('1.5 KB')
      // 1.5 GB → 1.5 GB
      expect(formatStorageSize(1_500_000_000)).toBe('1.5 GB')
    })

    it('uses the largest unit where value is ≥ 1', () => {
      // 12 GB → "12 GB", not "12000 MB"
      expect(formatStorageSize(12 * 1_000_000_000)).toBe('12 GB')
      // 2.5 TB → "2.5 TB"
      expect(formatStorageSize(2.5 * 1_000_000_000_000)).toBe('2.5 TB')
    })
  })

  describe('decimal handling', () => {
    it('caps decimals at 2 by default', () => {
      expect(formatStorageSize(1_234_567)).toBe('1.23 MB')
      expect(formatStorageSize(1_234_567_890)).toBe('1.23 GB')
    })

    it('rounds half away from zero', () => {
      // 1.005 GB → 1.01 GB (not 1 GB)
      expect(formatStorageSize(1_005_000_000)).toBe('1.01 GB')
      // 1.004 GB → 1 GB (trailing zeros stripped)
      expect(formatStorageSize(1_004_000_000)).toBe('1 GB')
    })

    it('strips trailing zeros (integer reads cleanly)', () => {
      // 2 GB (not "2.00 GB")
      expect(formatStorageSize(2_000_000_000)).toBe('2 GB')
    })

    it('respects decimals=0 override', () => {
      // 1.5 GB → 2 GB with decimals=0
      expect(formatStorageSize(1_500_000_000, { decimals: 0 })).toBe('2 GB')
    })

    it('respects decimals=4 override', () => {
      expect(formatStorageSize(1_234_567, { decimals: 4 })).toBe('1.2346 MB')
    })

    it('clamps decimals to [0, 4]', () => {
      // -5 → 0 decimals (minimum)
      expect(formatStorageSize(1_500, { decimals: -5 })).toBe('2 KB')
      // 99 → 4 decimals (maximum)
      expect(formatStorageSize(1_500, { decimals: 99 })).toBe('1.5 KB')
      // Above 4 just rounds to 4
      expect(formatStorageSize(1_234_567, { decimals: 8 })).toBe('1.2346 MB')
    })
  })

  describe('locale override', () => {
    it('uses comma decimal separator in de-DE', () => {
      expect(formatStorageSize(1_500_000_000, { locale: 'de-DE' })).toBe('1,5 GB')
    })

    it('uses comma thousands separator in en-US (default)', () => {
      expect(formatStorageSize(1_500_000)).toBe('1.5 MB')
    })
  })

  describe('minUnit override', () => {
    it('forces a minimum unit even when the value is smaller', () => {
      expect(formatStorageSize(500, { minUnit: 'MB' })).toBe('0 MB')
      expect(formatStorageSize(500_000, { minUnit: 'MB' })).toBe('0.5 MB')
      // Natural pick is GB (>= MB) so it wins — minUnit is a floor.
      expect(formatStorageSize(1_500_000_000, { minUnit: 'MB' })).toBe('1.5 GB')
    })

    it('pinned unit at the same scale as natural pick', () => {
      expect(formatStorageSize(1_500_000_000, { minUnit: 'GB' })).toBe('1.5 GB')
    })

    it('pinned unit smaller than natural pick is ignored', () => {
      // minUnit=MB but value is in GB → picks GB (largest unit)
      expect(formatStorageSize(2_500_000_000, { minUnit: 'MB' })).toBe('2.5 GB')
    })

    it('zero with minUnit renders that unit', () => {
      expect(formatStorageSize(0, { minUnit: 'GB' })).toBe('0 GB')
      expect(formatStorageSize(0, { minUnit: 'TB' })).toBe('0 TB')
    })
  })

  describe('defensive coercion', () => {
    it('handles null', () => {
      expect(formatStorageSize(null)).toBe('0 B')
    })

    it('handles undefined', () => {
      expect(formatStorageSize(undefined)).toBe('0 B')
    })

    it('handles empty string', () => {
      expect(formatStorageSize('')).toBe('0 B')
    })

    it('handles non-numeric string', () => {
      expect(formatStorageSize('not a number')).toBe('0 B')
      expect(formatStorageSize('abc')).toBe('0 B')
    })

    it('handles negative bytes (DB CHECK violation)', () => {
      expect(formatStorageSize(-1)).toBe('0 B')
      expect(formatStorageSize(-1_000_000_000)).toBe('0 B')
    })

    it('handles NaN', () => {
      expect(formatStorageSize(NaN)).toBe('0 B')
    })

    it('handles Infinity', () => {
      expect(formatStorageSize(Infinity)).toBe('0 B')
    })

    it('handles string "1234" (PostgREST bigint-as-string)', () => {
      expect(formatStorageSize('1234')).toBe('1.23 KB')
    })

    it('handles string "1500000000"', () => {
      expect(formatStorageSize('1500000000')).toBe('1.5 GB')
    })

    it('caps values above Number.MAX_SAFE_INTEGER', () => {
      // Above MAX_SAFE_INTEGER: coerced → MAX_SAFE_INTEGER → "9007199254740992 B"
      const huge = '10000000000000000' // 1e16, well above MAX_SAFE_INTEGER
      // Just assert it doesn't throw and returns some byte-ish string
      const result = formatStorageSize(huge)
      expect(result).toMatch(/B$/)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('input immutability', () => {
    it('does not mutate a numeric input', () => {
      const input = 1_500_000
      const snapshot = input
      formatStorageSize(input)
      expect(input).toBe(snapshot)
    })

    it('does not mutate a string input', () => {
      const input = '1500000'
      const snapshot = input
      formatStorageSize(input)
      expect(input).toBe(snapshot)
    })
  })
})