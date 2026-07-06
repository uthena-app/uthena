// VideoPlayer.types.test.ts — unit tests for the pure helpers exported
// from VideoPlayer.types. No DOM / React / hls.js imports — pure
// function coverage. Runs in <10ms.

import { describe, it, expect } from 'vitest'
import {
  isHlsSrc,
  formatTime,
  PLAYBACK_RATES,
  DEFAULT_QUALITIES,
  nativeHlsSupport,
  buildQualityPresets,
  keyToAction,
  parseResumeSeconds,
  RESUME_SECONDS_MAX,
} from './VideoPlayer.types'

describe('isHlsSrc', () => {
  it('returns true for .m3u8 URLs (case-insensitive)', () => {
    expect(isHlsSrc('https://cdn.example.com/foo.m3u8')).toBe(true)
    expect(isHlsSrc('https://cdn.example.com/foo.M3U8')).toBe(true)
  })

  it('returns true for .m3u8 URLs with query strings', () => {
    expect(isHlsSrc('https://cdn.example.com/foo.m3u8?token=abc&expires=123')).toBe(true)
  })

  it('returns false for MP4 URLs', () => {
    expect(isHlsSrc('https://cdn.example.com/foo.mp4')).toBe(false)
  })

  it('returns false for non-video URLs', () => {
    expect(isHlsSrc('https://example.com/')).toBe(false)
    expect(isHlsSrc('')).toBe(false)
    expect(isHlsSrc('not a url')).toBe(false)
  })

  it('returns false for .m3u8-like extensions that are not the end', () => {
    expect(isHlsSrc('https://cdn.example.com/foo.m3u8.mp4')).toBe(false)
    expect(isHlsSrc('https://cdn.example.com/foo.m3u8something')).toBe(false)
  })
})

describe('formatTime', () => {
  it('formats 0 as "0:00"', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats seconds < 1 minute as "M:SS"', () => {
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(45)).toBe('0:45')
  })

  it('formats seconds < 1 hour with M:SS (no leading zero on minutes)', () => {
    expect(formatTime(60)).toBe('1:00')
    expect(formatTime(125)).toBe('2:05')
    expect(formatTime(599)).toBe('9:59')
  })

  it('formats seconds >= 1 hour as "H:MM:SS"', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(3661)).toBe('1:01:01')
    expect(formatTime(36000)).toBe('10:00:00')
  })

  it('handles fractional seconds by flooring', () => {
    expect(formatTime(5.9)).toBe('0:05')
    expect(formatTime(59.99)).toBe('0:59')
  })

  it('returns "0:00" for bad input', () => {
    expect(formatTime(NaN)).toBe('0:00')
    expect(formatTime(Infinity)).toBe('0:00')
    expect(formatTime(-Infinity)).toBe('0:00')
    expect(formatTime(-1)).toBe('0:00')
    // @ts-expect-error — nullish is intentionally allowed via the bad-input branch
    expect(formatTime(null)).toBe('0:00')
    // @ts-expect-error — nullish is intentionally allowed via the bad-input branch
    expect(formatTime(undefined)).toBe('0:00')
  })
})

describe('PLAYBACK_RATES', () => {
  it('contains the standard preset set', () => {
    expect(PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2])
  })

  it('includes 1x (the default)', () => {
    expect(PLAYBACK_RATES).toContain(1)
  })

  it('is read-only (frozen)', () => {
    expect(Object.isFrozen(PLAYBACK_RATES)).toBe(true)
  })
})

describe('DEFAULT_QUALITIES', () => {
  it('starts with the Auto sentinel', () => {
    expect(DEFAULT_QUALITIES[0]).toEqual({ id: 'auto', label: 'Auto' })
  })

  it('has the standard HLS tiers', () => {
    const ids = DEFAULT_QUALITIES.map((q) => q.id)
    expect(ids).toContain('1080p')
    expect(ids).toContain('720p')
    expect(ids).toContain('480p')
    expect(ids).toContain('360p')
  })
})

describe('nativeHlsSupport', () => {
  it('returns a boolean (no throw in either DOM or non-DOM env)', () => {
    // Either branch is valid depending on jsdom vs node env — we just
    // assert it returns a boolean and never throws.
    const result = nativeHlsSupport()
    expect(typeof result).toBe('boolean')
  })
})

describe('buildQualityPresets', () => {
  it('always prepends the Auto sentinel', () => {
    expect(buildQualityPresets([])[0]).toEqual({ id: 'auto', label: 'Auto' })
    expect(buildQualityPresets([{ height: 720 }])[0]).toEqual({ id: 'auto', label: 'Auto' })
  })

  it('maps each HLS level to a {id, label, height} preset', () => {
    const result = buildQualityPresets([{ height: 480 }, { height: 720 }, { height: 1080 }])
    // Auto + 1080 + 720 + 480, sorted by height descending
    expect(result.map((q) => q.id)).toEqual(['auto', '1080p', '720p', '480p'])
  })

  it('skips levels with height 0 (audio-only / unknown)', () => {
    const result = buildQualityPresets([{ height: 0 }, { height: 720 }])
    expect(result.map((q) => q.id)).toEqual(['auto', '720p'])
  })

  it('dedupes levels with the same height', () => {
    const result = buildQualityPresets([{ height: 720, bitrate: 1 }, { height: 720, bitrate: 2 }])
    expect(result.map((q) => q.id)).toEqual(['auto', '720p'])
  })

  it('preserves a single level (no extras)', () => {
    const result = buildQualityPresets([{ height: 480 }])
    expect(result.map((q) => q.id)).toEqual(['auto', '480p'])
  })
})

describe('keyToAction', () => {
  it('ArrowLeft → -5s', () => {
    expect(keyToAction('ArrowLeft')).toBe(-5)
  })

  it('ArrowRight → +5s', () => {
    expect(keyToAction('ArrowRight')).toBe(5)
  })

  it('j / l → ±10s (YouTube-style)', () => {
    expect(keyToAction('j')).toBe(-10)
    expect(keyToAction('l')).toBe(10)
    expect(keyToAction('J')).toBe(-10)
    expect(keyToAction('L')).toBe(10)
  })

  it('Space + k → play toggle', () => {
    expect(keyToAction(' ')).toBe('play')
    expect(keyToAction('k')).toBe('play')
    expect(keyToAction('K')).toBe('play')
  })

  it('m → mute toggle (case-insensitive)', () => {
    expect(keyToAction('m')).toBe('mute')
    expect(keyToAction('M')).toBe('mute')
  })

  it('f → fullscreen toggle', () => {
    expect(keyToAction('f')).toBe('fullscreen')
    expect(keyToAction('F')).toBe('fullscreen')
  })

  it('c → captions toggle', () => {
    expect(keyToAction('c')).toBe('captions')
    expect(keyToAction('C')).toBe('captions')
  })

  it('number keys 1..9 → jump to N*10%', () => {
    expect(keyToAction('1')).toBe(0.1)
    expect(keyToAction('5')).toBe(0.5)
    expect(keyToAction('9')).toBe(0.9)
  })

  it('number key 0 → jump to 0%', () => {
    expect(keyToAction('0')).toBe(0)
  })

  it('returns null for unhandled keys', () => {
    expect(keyToAction('a')).toBeNull()
    expect(keyToAction('z')).toBeNull()
    expect(keyToAction('Enter')).toBeNull()
    expect(keyToAction('Escape')).toBeNull()
    expect(keyToAction('Tab')).toBeNull()
    expect(keyToAction('')).toBeNull()
  })
})

describe('RESUME_SECONDS_MAX', () => {
  it('is 12 hours (43,200 seconds)', () => {
    expect(RESUME_SECONDS_MAX).toBe(12 * 60 * 60)
  })
})

describe('parseResumeSeconds', () => {
  // Happy path — what the URL-param parser should accept
  it("returns whole seconds for valid integer strings ('0', '30', '512')", () => {
    expect(parseResumeSeconds('0')).toBe(0)
    expect(parseResumeSeconds('30')).toBe(30)
    expect(parseResumeSeconds('512')).toBe(512)
    expect(parseResumeSeconds('3600')).toBe(3600)
  })

  it('floors fractional seconds to a whole number', () => {
    expect(parseResumeSeconds('5.9')).toBe(5)
    expect(parseResumeSeconds('512.99')).toBe(512)
    expect(parseResumeSeconds('0.999')).toBe(0)
  })

  it('trims surrounding whitespace', () => {
    expect(parseResumeSeconds('  30  ')).toBe(30)
    expect(parseResumeSeconds('\t512\n')).toBe(512)
  })

  it('accepts values up to the 12-hour cap', () => {
    expect(parseResumeSeconds('43200')).toBe(43200)
    expect(parseResumeSeconds('43199.5')).toBe(43199)
  })

  // Defensive — what the parser must reject
  it('returns null for null / undefined / empty input', () => {
    expect(parseResumeSeconds(null)).toBeNull()
    expect(parseResumeSeconds(undefined)).toBeNull()
    expect(parseResumeSeconds('')).toBeNull()
    expect(parseResumeSeconds('   ')).toBeNull()
  })

  it('returns null for negative numbers (regex excludes the leading minus)', () => {
    expect(parseResumeSeconds('-1')).toBeNull()
    expect(parseResumeSeconds('-30')).toBeNull()
    expect(parseResumeSeconds('-0.5')).toBeNull()
  })

  it('returns null for signed / explicit-plus notation', () => {
    // '+5' is not in the regex allowlist (only `^\d+(\.\d+)?$`).
    // YouTube / Vimeo follow the same convention — explicit `+` is
    // unusual and easy to mistype; require unprefixed digits.
    expect(parseResumeSeconds('+5')).toBeNull()
  })

  it('returns null for non-numeric strings', () => {
    expect(parseResumeSeconds('abc')).toBeNull()
    expect(parseResumeSeconds('5min')).toBeNull()
    expect(parseResumeSeconds('8m32s')).toBeNull()
    expect(parseResumeSeconds('NaN')).toBeNull()
    expect(parseResumeSeconds('Infinity')).toBeNull()
    expect(parseResumeSeconds('undefined')).toBeNull()
  })

  it('returns null for scientific notation (regex excludes the `e`)', () => {
    expect(parseResumeSeconds('1e5')).toBeNull()
    expect(parseResumeSeconds('5E2')).toBeNull()
    expect(parseResumeSeconds('1.5e10')).toBeNull()
  })

  it('returns null for hex / binary / octal notation', () => {
    expect(parseResumeSeconds('0x10')).toBeNull()
    expect(parseResumeSeconds('0b1010')).toBeNull()
    expect(parseResumeSeconds('0o17')).toBeNull()
  })

  it('returns null for values above the 12-hour cap (defends the player from huge seeks)', () => {
    expect(parseResumeSeconds('43201')).toBeNull()
    expect(parseResumeSeconds('999999999')).toBeNull()
    expect(parseResumeSeconds('10000000000')).toBeNull()
  })

  it('returns null for fractions that round up past the cap', () => {
    expect(parseResumeSeconds('43200.5')).toBeNull()
  })

  it('returns null for inputs that contain non-numeric characters (with one exception)', () => {
    // Leading/trailing spaces are stripped before the regex runs;
    // everything else inside the string is rejected wholesale.
    expect(parseResumeSeconds('30s')).toBeNull()
    expect(parseResumeSeconds('30 seconds')).toBeNull()
    expect(parseResumeSeconds('30.5.5')).toBeNull()
    expect(parseResumeSeconds('30.')).toBeNull()
    expect(parseResumeSeconds('.5')).toBeNull() // regex requires a leading digit
  })

  it('returns null for SQL-injection / shell-injection style inputs (regex is numeric-only)', () => {
    expect(parseResumeSeconds("30'; DROP TABLE products;--")).toBeNull()
    expect(parseResumeSeconds('$(rm -rf /)')).toBeNull()
    expect(parseResumeSeconds('30<script>')).toBeNull()
    expect(parseResumeSeconds('%20')).toBeNull() // URL-encoded space alone
  })

  it('returns null for newlines / control characters inside the value', () => {
    expect(parseResumeSeconds('30\n0')).toBeNull()
    expect(parseResumeSeconds('30\r\n0')).toBeNull()
    expect(parseResumeSeconds('30\u0000')).toBeNull()
  })

  it('returns null for zero-width / non-ASCII digits', () => {
    // Defence in depth against URL-encoded unicode tricks. The
    // parser intentionally trims ASCII + Unicode whitespace
    // (ECMAScript 2019+ adds NBSP / ZWSP / line / paragraph
    // separators to `String.prototype.trim`), so trailing `\u00A0`
    // is treated as padding — that's the user-friendly behavior and
    // matches what every other URL param in this codebase does
    // (`parseOrderId`, `parseRefundId`). The defense-in-depth
    // guarantee we DO need is: non-whitespace unicode chars that
    // bypass `trim()` are rejected by the regex.
    expect(parseResumeSeconds('\u200B30')).toBeNull() // zero-width space (not trimmed by trim())
    expect(parseResumeSeconds('30\u200B')).toBeNull() // zero-width space suffix
    expect(parseResumeSeconds('３０')).toBeNull() // full-width digits (not matched by regex)
    expect(parseResumeSeconds('\u202E30')).toBeNull() // RTL override (not whitespace, not digit)
    expect(parseResumeSeconds('3\u0660')).toBeNull() // Arabic-Indic digit mixed with ASCII digit
  })
})