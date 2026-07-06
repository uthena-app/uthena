import { describe, expect, it } from 'vitest'
import {
  ERR_ID_ALPHABET,
  ERR_ID_LENGTH,
  generateErrorId,
  makeErrorReference,
} from './generate-error-id'

describe('generateErrorId', () => {
  it('returns a string of ERR_ID_LENGTH chars', () => {
    const id = generateErrorId()
    expect(typeof id).toBe('string')
    expect(id).toHaveLength(ERR_ID_LENGTH)
  })

  it('uses only characters from the ERR_ID_ALPHABET', () => {
    // Run many iterations to cover all positions of the alphabet
    // (each char is a uniform random selection, so 10k iterations
    // exercise each position hundreds of times).
    for (let i = 0; i < 1000; i++) {
      const id = generateErrorId()
      for (const ch of id) {
        expect(ERR_ID_ALPHABET).toContain(ch)
      }
    }
  })

  it('excludes the ambiguous chars 0, 1, I, O', () => {
    // The alphabet must not contain these — if it ever does, the
    // phone-quotability promise in error-500.md §Security breaks.
    expect(ERR_ID_ALPHABET).not.toMatch(/[01IO]/)
    // And the output must never contain them.
    for (let i = 0; i < 500; i++) {
      const id = generateErrorId()
      expect(id).not.toMatch(/[01IO]/)
    }
  })

  it('does not collide in 10k iterations (birthday paradox sanity)', () => {
    // 10k IDs from a 1.1e15-key space → expected collisions ≈ 0.
    // The test is a regression guard, not a probability proof. If this
    // ever fires, either (a) the random source broke, or (b) the
    // alphabet shrank, or (c) the length dropped — all worth catching.
    const seen = new Set<string>()
    for (let i = 0; i < 10000; i++) {
      const id = generateErrorId()
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
    expect(seen.size).toBe(10000)
  })

  it('character distribution is roughly uniform (no broken sampler)', () => {
    // 5000 chars × 32 alphabet = 156250 expected per char.
    // Tolerate ±20% to catch a sampler that biases one position
    // (e.g. using Math.random without crypto fallback correctly).
    const counts: Record<string, number> = {}
    for (const ch of ERR_ID_ALPHABET) counts[ch] = 0
    const total = 5000 * ERR_ID_LENGTH
    for (let i = 0; i < 5000; i++) {
      for (const ch of generateErrorId()) counts[ch] = (counts[ch] ?? 0) + 1
    }
    const expected = total / ERR_ID_ALPHABET.length
    const tolerance = expected * 0.2
    for (const ch of ERR_ID_ALPHABET) {
      const c = counts[ch] ?? 0
      expect(c).toBeGreaterThan(expected - tolerance)
      expect(c).toBeLessThan(expected + tolerance)
    }
  })

  it('makeErrorReference returns ERR-{10char-id} shape', () => {
    const ref = makeErrorReference()
    expect(ref).toMatch(/^ERR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/)
  })

  it('ERR_ID_LENGTH is 10 (matches the spec — error-500.md)', () => {
    // Hard-coded regression: if the spec ever changes the length,
    // this test forces an explicit update (so audit-log + support
    // doc shape stay in sync).
    expect(ERR_ID_LENGTH).toBe(10)
  })

  it('ERR_ID_ALPHABET has exactly 32 chars', () => {
    expect(ERR_ID_ALPHABET).toHaveLength(32)
  })
})