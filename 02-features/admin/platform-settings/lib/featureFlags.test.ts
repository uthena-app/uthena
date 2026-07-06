// featureFlags.test.ts — unit tests for the pure feature-flag helpers.
// Same pattern as the other pure-helper test files in this codebase:
// no fixtures, no DB, no async — runs in milliseconds.

import { describe, it, expect } from 'vitest'
import {
  FeatureFlagSchema,
  FeatureFlagsSchema,
  AddFeatureFlagInputSchema,
  UpdateFeatureFlagInputSchema,
  coerceFeatureFlag,
  coerceFeatureFlags,
  sortFlags,
  findFlag,
  hasFlag,
  diffFlags,
  applyAddFlag,
  applyRemoveFlag,
  applyUpdateFlag,
  formatRolloutPct,
  type FeatureFlag,
  type FeatureFlags,
} from './featureFlags'

const SAMPLE_FLAG: FeatureFlag = {
  key: 'new_checkout_flow',
  enabled: true,
  description: 'Test the redesigned checkout',
  rollout_pct: 25,
}

const SAMPLE_FLAG_2: FeatureFlag = {
  key: 'gift_subscriptions',
  enabled: false,
  description: 'Allow buying subscriptions as gifts',
  rollout_pct: null,
}

describe('FeatureFlagSchema', () => {
  it('accepts a well-formed flag', () => {
    const r = FeatureFlagSchema.safeParse(SAMPLE_FLAG)
    expect(r.success).toBe(true)
  })

  it('accepts a flag with empty description + null rollout', () => {
    const r = FeatureFlagSchema.safeParse({
      key: 'foo',
      enabled: true,
      description: '',
      rollout_pct: null,
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty key', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, key: '' })
    expect(r.success).toBe(false)
  })

  it('rejects key over 60 chars', () => {
    const r = FeatureFlagSchema.safeParse({
      ...SAMPLE_FLAG,
      key: 'a'.repeat(61),
    })
    expect(r.success).toBe(false)
  })

  it('rejects uppercase key', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, key: 'NewCheckout' })
    expect(r.success).toBe(false)
  })

  it('rejects key with hyphens', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, key: 'new-checkout' })
    expect(r.success).toBe(false)
  })

  it('rejects key with spaces', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, key: 'new checkout' })
    expect(r.success).toBe(false)
  })

  it('rejects key with leading digit is OK (digits allowed)', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, key: '2x_speed' })
    expect(r.success).toBe(true)
  })

  it('rejects non-boolean enabled', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, enabled: 'true' })
    expect(r.success).toBe(false)
  })

  it('rejects description over 500 chars', () => {
    const r = FeatureFlagSchema.safeParse({
      ...SAMPLE_FLAG,
      description: 'a'.repeat(501),
    })
    expect(r.success).toBe(false)
  })

  it('rejects rollout_pct below 0', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, rollout_pct: -1 })
    expect(r.success).toBe(false)
  })

  it('rejects rollout_pct above 100', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, rollout_pct: 101 })
    expect(r.success).toBe(false)
  })

  it('rejects fractional rollout_pct', () => {
    const r = FeatureFlagSchema.safeParse({ ...SAMPLE_FLAG, rollout_pct: 25.5 })
    expect(r.success).toBe(false)
  })

  it('rejects unknown extra fields (strict mode)', () => {
    const r = FeatureFlagSchema.safeParse({
      ...SAMPLE_FLAG,
      evil: 'should not pass',
    })
    expect(r.success).toBe(false)
  })
})

describe('FeatureFlagsSchema', () => {
  it('accepts an array of valid flags', () => {
    const r = FeatureFlagsSchema.safeParse([SAMPLE_FLAG, SAMPLE_FLAG_2])
    expect(r.success).toBe(true)
  })

  it('accepts an empty array', () => {
    const r = FeatureFlagsSchema.safeParse([])
    expect(r.success).toBe(true)
  })

  it('rejects arrays over 100 flags', () => {
    const flags = Array.from({ length: 101 }, (_, i) => ({
      key: `flag_${i}`,
      enabled: false,
      description: '',
      rollout_pct: null,
    }))
    const r = FeatureFlagsSchema.safeParse(flags)
    expect(r.success).toBe(false)
  })

  it('rejects when one element is malformed', () => {
    const r = FeatureFlagsSchema.safeParse([SAMPLE_FLAG, { ...SAMPLE_FLAG_2, key: '' }])
    expect(r.success).toBe(false)
  })
})

describe('AddFeatureFlagInputSchema', () => {
  it('accepts a minimal input (key only)', () => {
    const r = AddFeatureFlagInputSchema.safeParse({ key: 'new_flag' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.enabled).toBe(false)
      expect(r.data.description).toBe('')
      expect(r.data.rollout_pct).toBe(null)
    }
  })

  it('accepts a full input', () => {
    const r = AddFeatureFlagInputSchema.safeParse({
      key: 'new_flag',
      enabled: true,
      description: 'Hello world',
      rollout_pct: 50,
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown extra fields', () => {
    const r = AddFeatureFlagInputSchema.safeParse({
      key: 'new_flag',
      evil: 'should not pass',
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid key', () => {
    const r = AddFeatureFlagInputSchema.safeParse({ key: 'Invalid-Key' })
    expect(r.success).toBe(false)
  })
})

describe('UpdateFeatureFlagInputSchema', () => {
  it('accepts a single-field patch', () => {
    const r = UpdateFeatureFlagInputSchema.safeParse({
      key: 'foo',
      enabled: true,
    })
    expect(r.success).toBe(true)
  })

  it('accepts a multi-field patch', () => {
    const r = UpdateFeatureFlagInputSchema.safeParse({
      key: 'foo',
      enabled: true,
      description: 'new desc',
      rollout_pct: 50,
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty patch (no fields besides key)', () => {
    const r = UpdateFeatureFlagInputSchema.safeParse({ key: 'foo' })
    expect(r.success).toBe(false)
  })

  it('accepts a patch that explicitly sets rollout_pct to null', () => {
    const r = UpdateFeatureFlagInputSchema.safeParse({
      key: 'foo',
      rollout_pct: null,
    })
    expect(r.success).toBe(true)
  })
})

describe('coerceFeatureFlag', () => {
  it('accepts a well-formed object', () => {
    expect(coerceFeatureFlag(SAMPLE_FLAG)).toEqual(SAMPLE_FLAG)
  })

  it('returns null on null input', () => {
    expect(coerceFeatureFlag(null)).toBe(null)
  })

  it('returns null on non-object input', () => {
    expect(coerceFeatureFlag('string')).toBe(null)
    expect(coerceFeatureFlag(42)).toBe(null)
    expect(coerceFeatureFlag(true)).toBe(null)
  })

  it('returns null when key is missing', () => {
    expect(coerceFeatureFlag({ enabled: true })).toBe(null)
  })

  it('returns null when key is not a string', () => {
    expect(coerceFeatureFlag({ key: 123, enabled: true })).toBe(null)
  })

  it('returns null when enabled is not boolean', () => {
    expect(coerceFeatureFlag({ key: 'foo', enabled: 'true' })).toBe(null)
  })

  it('returns null when description is too long', () => {
    expect(
      coerceFeatureFlag({ key: 'foo', enabled: true, description: 'a'.repeat(501) }),
    ).toBe(null)
  })

  it('defaults missing description to empty string', () => {
    const r = coerceFeatureFlag({ key: 'foo', enabled: true })
    expect(r).toEqual({ key: 'foo', enabled: true, description: '', rollout_pct: null })
  })

  it('defaults missing rollout_pct to null', () => {
    const r = coerceFeatureFlag({ key: 'foo', enabled: true, description: 'desc' })
    expect(r?.rollout_pct).toBe(null)
  })

  it('returns null when rollout_pct is out of range', () => {
    expect(coerceFeatureFlag({ ...SAMPLE_FLAG, rollout_pct: -1 })).toBe(null)
    expect(coerceFeatureFlag({ ...SAMPLE_FLAG, rollout_pct: 101 })).toBe(null)
  })

  it('returns null when rollout_pct is fractional', () => {
    expect(coerceFeatureFlag({ ...SAMPLE_FLAG, rollout_pct: 25.5 })).toBe(null)
  })

  it('returns null when key fails the regex', () => {
    expect(coerceFeatureFlag({ ...SAMPLE_FLAG, key: 'Invalid-Key' })).toBe(null)
    expect(coerceFeatureFlag({ ...SAMPLE_FLAG, key: 'with space' })).toBe(null)
  })
})

describe('coerceFeatureFlags', () => {
  it('accepts an array of valid flags', () => {
    expect(coerceFeatureFlags([SAMPLE_FLAG, SAMPLE_FLAG_2])).toEqual([
      SAMPLE_FLAG,
      SAMPLE_FLAG_2,
    ])
  })

  it('returns empty array when input is not an array', () => {
    expect(coerceFeatureFlags(null)).toEqual([])
    expect(coerceFeatureFlags({})).toEqual([])
    expect(coerceFeatureFlags('string')).toEqual([])
  })

  it('drops malformed entries silently', () => {
    const input = [
      SAMPLE_FLAG,
      { key: '', enabled: true },
      SAMPLE_FLAG_2,
      { garbage: true },
    ]
    expect(coerceFeatureFlags(input)).toEqual([SAMPLE_FLAG, SAMPLE_FLAG_2])
  })

  it('returns empty array on completely malformed input', () => {
    expect(coerceFeatureFlags([null, 42, 'string', {}])).toEqual([])
  })
})

describe('sortFlags', () => {
  it('sorts alphabetically by key', () => {
    const input: FeatureFlags = [SAMPLE_FLAG, SAMPLE_FLAG_2]
    const sorted = sortFlags(input)
    expect(sorted.map((f) => f.key)).toEqual(['gift_subscriptions', 'new_checkout_flow'])
  })

  it('does not mutate the input', () => {
    const input: FeatureFlags = [SAMPLE_FLAG, SAMPLE_FLAG_2]
    const inputCopy = [...input]
    sortFlags(input)
    expect(input).toEqual(inputCopy)
  })

  it('handles an empty array', () => {
    expect(sortFlags([])).toEqual([])
  })

  it('handles a single-element array', () => {
    expect(sortFlags([SAMPLE_FLAG])).toEqual([SAMPLE_FLAG])
  })
})

describe('findFlag + hasFlag', () => {
  const flags: FeatureFlags = [SAMPLE_FLAG, SAMPLE_FLAG_2]

  it('findFlag returns the flag when key matches', () => {
    expect(findFlag(flags, 'new_checkout_flow')).toEqual(SAMPLE_FLAG)
  })

  it('findFlag returns undefined when key does not match', () => {
    expect(findFlag(flags, 'nope')).toBeUndefined()
  })

  it('hasFlag returns true when key exists', () => {
    expect(hasFlag(flags, 'new_checkout_flow')).toBe(true)
  })

  it('hasFlag returns false when key does not exist', () => {
    expect(hasFlag(flags, 'nope')).toBe(false)
  })
})

describe('diffFlags', () => {
  it('detects added flags', () => {
    const result = diffFlags([], [SAMPLE_FLAG])
    expect(result.added).toEqual(['new_checkout_flow'])
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([])
  })

  it('detects removed flags', () => {
    const result = diffFlags([SAMPLE_FLAG], [])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual(['new_checkout_flow'])
    expect(result.changed).toEqual([])
  })

  it('detects changed flags (enabled flip)', () => {
    const result = diffFlags([SAMPLE_FLAG], [{ ...SAMPLE_FLAG, enabled: false }])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.changed).toHaveLength(1)
    expect(result.changed[0]).toEqual({
      key: 'new_checkout_flow',
      before: { enabled: true },
      after: { enabled: false },
    })
  })

  it('detects changed flags (rollout_pct update)', () => {
    const result = diffFlags([SAMPLE_FLAG], [{ ...SAMPLE_FLAG, rollout_pct: 75 }])
    expect(result.changed).toEqual([
      {
        key: 'new_checkout_flow',
        before: { rollout_pct: 25 },
        after: { rollout_pct: 75 },
      },
    ])
  })

  it('detects no changes when arrays are identical', () => {
    const result = diffFlags([SAMPLE_FLAG], [SAMPLE_FLAG])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([])
  })

  it('handles a complex 3-way diff', () => {
    const a: FeatureFlags = [SAMPLE_FLAG, SAMPLE_FLAG_2]
    const b: FeatureFlags = [
      { ...SAMPLE_FLAG, enabled: false }, // changed
      SAMPLE_FLAG_2, // unchanged
      // a new flag "third_flag" added
      { key: 'third_flag', enabled: true, description: 'third', rollout_pct: null },
    ]
    const result = diffFlags(a, b)
    expect(result.added).toEqual(['third_flag'])
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([
      {
        key: 'new_checkout_flow',
        before: { enabled: true },
        after: { enabled: false },
      },
    ])
  })

  it('sorts output keys for determinism', () => {
    const a: FeatureFlags = [
      { ...SAMPLE_FLAG, key: 'zeta' },
      { ...SAMPLE_FLAG, key: 'alpha' },
    ]
    const b: FeatureFlags = [
      { ...SAMPLE_FLAG, key: 'zeta' },
      { ...SAMPLE_FLAG, key: 'alpha' },
      { ...SAMPLE_FLAG, key: 'mike' },
    ]
    const result = diffFlags(a, b)
    expect(result.added).toEqual(['mike'])
  })
})

describe('applyAddFlag', () => {
  it('adds a new flag and sorts', () => {
    const result = applyAddFlag([SAMPLE_FLAG], SAMPLE_FLAG_2)
    expect(result.map((f) => f.key)).toEqual([
      'gift_subscriptions',
      'new_checkout_flow',
    ])
  })

  it('throws on duplicate key', () => {
    expect(() => applyAddFlag([SAMPLE_FLAG], SAMPLE_FLAG)).toThrow(/already exists/)
  })

  it('does not mutate the input', () => {
    const input: FeatureFlags = [SAMPLE_FLAG]
    const inputCopy = [...input]
    applyAddFlag(input, SAMPLE_FLAG_2)
    expect(input).toEqual(inputCopy)
  })
})

describe('applyRemoveFlag', () => {
  it('removes a flag by key', () => {
    const result = applyRemoveFlag([SAMPLE_FLAG, SAMPLE_FLAG_2], 'new_checkout_flow')
    expect(result).toEqual([SAMPLE_FLAG_2])
  })

  it('is a no-op when key does not exist', () => {
    const result = applyRemoveFlag([SAMPLE_FLAG], 'nonexistent')
    expect(result).toEqual([SAMPLE_FLAG])
  })

  it('handles empty input', () => {
    expect(applyRemoveFlag([], 'any_key')).toEqual([])
  })
})

describe('applyUpdateFlag', () => {
  it('updates a single field via PATCH', () => {
    const result = applyUpdateFlag([SAMPLE_FLAG], {
      key: 'new_checkout_flow',
      enabled: false,
    })
    expect(result[0]).toEqual({ ...SAMPLE_FLAG, enabled: false })
  })

  it('updates multiple fields via PATCH', () => {
    const result = applyUpdateFlag([SAMPLE_FLAG], {
      key: 'new_checkout_flow',
      enabled: false,
      description: 'New desc',
      rollout_pct: 100,
    })
    expect(result[0]).toEqual({
      key: 'new_checkout_flow',
      enabled: false,
      description: 'New desc',
      rollout_pct: 100,
    })
  })

  it('can set rollout_pct to null (full rollout)', () => {
    const result = applyUpdateFlag([SAMPLE_FLAG], {
      key: 'new_checkout_flow',
      rollout_pct: null,
    })
    expect(result[0]?.rollout_pct).toBe(null)
  })

  it('throws when key does not exist', () => {
    expect(() =>
      applyUpdateFlag([SAMPLE_FLAG], { key: 'nonexistent', enabled: true }),
    ).toThrow(/does not exist/)
  })

  it('does not mutate the input', () => {
    const input: FeatureFlags = [SAMPLE_FLAG]
    const inputCopy = JSON.parse(JSON.stringify(input))
    applyUpdateFlag(input, { key: 'new_checkout_flow', enabled: false })
    expect(input).toEqual(inputCopy)
  })
})

describe('formatRolloutPct', () => {
  it('formats a number as "N%"', () => {
    expect(formatRolloutPct(25)).toBe('25%')
    expect(formatRolloutPct(100)).toBe('100%')
    expect(formatRolloutPct(0)).toBe('0%')
  })

  it('renders null as "100%" (full rollout)', () => {
    expect(formatRolloutPct(null)).toBe('100%')
  })
})